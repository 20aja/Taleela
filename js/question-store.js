const QUESTION_VERSION = "8.5.0";
const MANIFEST_URL = new URL(`../questions/v${QUESTION_VERSION}/manifest.json`, import.meta.url);
const HISTORY_KEY = `taleela_question_history_v${QUESTION_VERSION}`;

let manifestPromise = null;
const shardCache = new Map();
const activeShardByCategory = new Map();

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function readHistory() {
  try {
    const raw = safeParse(localStorage.getItem(HISTORY_KEY), null);
    if (!raw || raw.version !== QUESTION_VERSION || typeof raw.categories !== "object") {
      return {version: QUESTION_VERSION, categories: {}};
    }
    return raw;
  } catch {
    return {version: QUESTION_VERSION, categories: {}};
  }
}

function writeHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("Question history could not be saved:", error);
  }
}

function randomIndex(length) {
  if (length <= 1) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function randomItem(items) {
  return items.length ? items[randomIndex(items.length)] : null;
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function expandQuestion(raw) {
  return {
    id: raw.i,
    prompt: raw.q,
    answer: raw.a,
    accepted: Array.isArray(raw.x) && raw.x.length ? raw.x : [raw.a],
    decoys: Array.isArray(raw.d) ? raw.d : [],
    factKey: raw.f || raw.i,
    image: raw.m || null,
    imageAlt: raw.m ? raw.t || "صورة السؤال" : "",
  };
}

async function fetchJSON(url) {
  const response = await fetch(url, {cache: "default"});
  if (!response.ok) throw new Error(`QUESTION_HTTP_${response.status}`);
  return response.json();
}

export async function getQuestionManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJSON(MANIFEST_URL).catch((error) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

export function preloadQuestionManifest() {
  return getQuestionManifest();
}

async function loadShard(file) {
  if (shardCache.has(file)) return shardCache.get(file);
  const url = new URL(`../questions/v${QUESTION_VERSION}/${file}`, import.meta.url);
  const promise = fetchJSON(url)
    .then((items) => (Array.isArray(items) ? items.map(expandQuestion) : []))
    .catch((error) => {
      shardCache.delete(file);
      throw error;
    });
  shardCache.set(file, promise);
  return promise;
}

function categoryHistory(history, categoryId) {
  history.categories ||= {};
  const current = history.categories[categoryId];
  if (!current || typeof current !== "object" || typeof current.shards !== "object") {
    history.categories[categoryId] = {shards: {}, facts: []};
  } else if (!Array.isArray(current.facts)) {
    current.facts = [];
  }
  return history.categories[categoryId];
}

function seenIdsForShard(categoryState, file) {
  const ids = categoryState.shards?.[file];
  return Array.isArray(ids) ? ids : [];
}

function setSeenIdsForShard(categoryState, file, ids) {
  categoryState.shards ||= {};
  categoryState.shards[file] = ids;
}

function categoryCycleComplete(categoryInfo, categoryState) {
  // A local cycle is complete only after every concrete question entry has
  // appeared. factKey is used as a preference to postpone alternate wording
  // of the same fact, not as a reason to end the cycle early.
  return (categoryInfo.shards || []).every((shard) => seenIdsForShard(categoryState, shard.file).length >= Number(shard.count || 0));
}

function resetCategoryCycle(history, categoryId) {
  history.categories ||= {};
  history.categories[categoryId] = {shards: {}, facts: []};
  activeShardByCategory.delete(categoryId);
  writeHistory(history);
  return history.categories[categoryId];
}

function orderedShards(categoryId, categoryInfo, categoryState, respectHistory) {
  const all = categoryInfo.shards || [];
  const eligible = respectHistory
    ? all.filter((shard) => seenIdsForShard(categoryState, shard.file).length < Number(shard.count || 0))
    : all;

  const activeFile = activeShardByCategory.get(categoryId);
  const active = eligible.find((shard) => shard.file === activeFile);
  const rest = shuffle(eligible.filter((shard) => shard.file !== activeFile));
  return active ? [active, ...rest] : rest;
}

async function trySelectFromShards({
  categoryId,
  categoryInfo,
  categoryState,
  roomUsed,
  usedFacts,
  respectHistoryIds = true,
  respectHistoryFacts = true,
  respectRoomIds = true,
  respectRoomFacts = true,
}) {
  const shardOrder = orderedShards(categoryId, categoryInfo, categoryState, respectHistoryIds);

  for (const shardMeta of shardOrder) {
    const questions = await loadShard(shardMeta.file);
    const seen = new Set(respectHistoryIds ? seenIdsForShard(categoryState, shardMeta.file) : []);
    const seenFacts = new Set(respectHistoryFacts ? categoryState.facts || [] : []);
    const candidates = questions.filter((question) => {
      const factKey = question.factKey || question.id;
      if (respectHistoryIds && seen.has(question.id)) return false;
      if (respectHistoryFacts && seenFacts.has(factKey)) return false;
      if (respectRoomIds && roomUsed.has(question.id)) return false;
      if (respectRoomFacts && usedFacts.has(factKey)) return false;
      return true;
    });

    if (!candidates.length) continue;
    const question = randomItem(candidates);
    activeShardByCategory.set(categoryId, shardMeta.file);
    return {question, shardFile: shardMeta.file};
  }

  return null;
}

/**
 * Lazy question selection:
 * - Manifest only at game start (~a few KB).
 * - One category shard is fetched when a question is actually needed.
 * - The same shard stays active, so consecutive rounds normally reuse cache.
 * - No question repeats inside a room until that category is exhausted.
 * - On the host device, a question is not repeated across matches until every
 *   question in that category has been seen once.
 */
export async function selectQuestion(categoryId, {usedQuestionIds = [], usedFactKeys = []} = {}) {
  const manifest = await getQuestionManifest();
  const categoryInfo = manifest.categories?.[categoryId];
  if (!categoryInfo?.count || !Array.isArray(categoryInfo.shards) || !categoryInfo.shards.length) return null;

  const roomUsed = new Set((Array.isArray(usedQuestionIds) ? usedQuestionIds : []).filter(Boolean));
  const usedFacts = new Set((Array.isArray(usedFactKeys) ? usedFactKeys : []).filter(Boolean));
  const history = readHistory();
  let state = categoryHistory(history, categoryId);

  if (categoryCycleComplete(categoryInfo, state)) {
    state = resetCategoryCycle(history, categoryId);
  }

  // First preference: a concrete question ID that has never appeared locally
  // and whose underlying fact has not appeared locally or in this room.
  let selected = await trySelectFromShards({
    categoryId,
    categoryInfo,
    categoryState: state,
    roomUsed,
    usedFacts,
  });

  // When all distinct facts have been covered, keep consuming unused question
  // entries (alternate formulations/clues) before allowing an exact repeat.
  if (!selected) {
    selected = await trySelectFromShards({
      categoryId,
      categoryInfo,
      categoryState: state,
      roomUsed,
      usedFacts,
      respectHistoryIds: true,
      respectHistoryFacts: false,
      respectRoomIds: true,
      respectRoomFacts: false,
    });
  }

  // Local history may have exhausted the category across earlier matches. Start
  // a new local cycle while still protecting every concrete ID used in this room.
  if (!selected) {
    state = resetCategoryCycle(history, categoryId);
    selected = await trySelectFromShards({
      categoryId,
      categoryInfo,
      categoryState: state,
      roomUsed,
      usedFacts,
      respectHistoryIds: true,
      respectHistoryFacts: true,
      respectRoomIds: true,
      respectRoomFacts: true,
    });
  }

  if (!selected) {
    selected = await trySelectFromShards({
      categoryId,
      categoryInfo,
      categoryState: state,
      roomUsed,
      usedFacts,
      respectHistoryIds: true,
      respectHistoryFacts: false,
      respectRoomIds: true,
      respectRoomFacts: false,
    });
  }

  // Only after every concrete question ID in the room has been consumed is an
  // exact repeat unavoidable. This matters when one small category is selected
  // for a long (up to 30-round) game.
  if (!selected) {
    selected = await trySelectFromShards({
      categoryId,
      categoryInfo,
      categoryState: state,
      roomUsed,
      usedFacts,
      respectHistoryIds: false,
      respectHistoryFacts: false,
      respectRoomIds: false,
      respectRoomFacts: false,
    });
  }

  if (!selected?.question) return null;

  const currentSeen = seenIdsForShard(state, selected.shardFile);
  if (!currentSeen.includes(selected.question.id)) {
    setSeenIdsForShard(state, selected.shardFile, [...currentSeen, selected.question.id]);
  }
  state.facts ||= [];
  const factKey = selected.question.factKey || selected.question.id;
  if (!state.facts.includes(factKey)) state.facts.push(factKey);
  writeHistory(history);
  return selected.question;
}

export async function warmCategory(categoryId) {
  const manifest = await getQuestionManifest();
  const categoryInfo = manifest.categories?.[categoryId];
  if (!categoryInfo?.shards?.length) return false;
  const history = readHistory();
  const state = categoryHistory(history, categoryId);
  const shard = orderedShards(categoryId, categoryInfo, state, true)[0] || randomItem(categoryInfo.shards);
  if (!shard) return false;
  activeShardByCategory.set(categoryId, shard.file);
  await loadShard(shard.file);
  return true;
}

export async function getQuestionCount(categoryId) {
  const manifest = await getQuestionManifest();
  return Number(manifest.categories?.[categoryId]?.count) || 0;
}

export async function getTotalQuestionCount() {
  const manifest = await getQuestionManifest();
  return Number(manifest.totalQuestions) || 0;
}

export function clearQuestionHistory(categoryId = null) {
  if (!categoryId) {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    activeShardByCategory.clear();
    return;
  }
  const history = readHistory();
  if (history.categories) delete history.categories[categoryId];
  activeShardByCategory.delete(categoryId);
  writeHistory(history);
}

export const QUESTION_STORE_VERSION = QUESTION_VERSION;
