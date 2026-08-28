const QUESTION_PATH_VERSION = "1";
const QUESTION_BANK_VERSION = "1.0.0";
const QUESTION_ROOT_URL = new URL(`../questions/v${QUESTION_PATH_VERSION}/`, import.meta.url);
const MANIFEST_URL = new URL("manifest.json", QUESTION_ROOT_URL);
const HISTORY_SCHEMA_VERSION = 2;
const HISTORY_KEY = `taleela_question_history_bank_v${QUESTION_PATH_VERSION}_schema_${HISTORY_SCHEMA_VERSION}`;
const QUESTION_ID_PREFIX = `qb-v${QUESTION_PATH_VERSION}`;

let manifestPromise = null;
let flagIndexPromise = null;
const shardCache = new Map();
const categoryCache = new Map();

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function emptyHistory() {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    bankVersion: QUESTION_BANK_VERSION,
    categories: {},
  };
}

function readHistory() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return emptyHistory();
    const raw = safeParse(storage.getItem(HISTORY_KEY), null);
    if (
      !raw
      || raw.schemaVersion !== HISTORY_SCHEMA_VERSION
      || raw.bankVersion !== QUESTION_BANK_VERSION
      || !raw.categories
      || typeof raw.categories !== "object"
    ) {
      return emptyHistory();
    }
    return raw;
  } catch {
    return emptyHistory();
  }
}

function writeHistory(history) {
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("Question history could not be saved:", error);
  }
}

function randomIndex(length) {
  if (length <= 1) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const range = 0x1_0000_0000;
    const limit = range - (range % length);
    const values = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function randomItem(items) {
  return items.length ? items[randomIndex(items.length)] : null;
}

function normalizedKeyPart(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

const COUNTRY_FLAG_CODES_BY_NORMALIZED_NAME = new Map(
  Object.entries({
    "إيطاليا": "it",
    "المغرب": "ma",
    "اليابان": "jp",
    "كندا": "ca",
    "تركيا": "tr",
    "العراق": "iq",
    "إسبانيا": "es",
    "البرازيل": "br",
    "مصر": "eg",
    "السعودية": "sa",
    "الأردن": "jo",
    "سوريا": "sy",
    "لبنان": "lb",
    "الكويت": "kw",
    "الإمارات": "ae",
    "عُمان": "om",
    "قطر": "qa",
    "البحرين": "bh",
    "الولايات المتحدة": "us",
    "المكسيك": "mx",
    "الأرجنتين": "ar",
    "تشيلي": "cl",
    "بيرو": "pe",
    "كولومبيا": "co",
    "المملكة المتحدة": "gb",
    "ألمانيا": "de",
    "البرتغال": "pt",
    "اليونان": "gr",
  }).map(([name, code]) => [normalizedKeyPart(name), code]),
);

function normalizeShardPath(categoryId, file) {
  const clean = String(file || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return null;
  return clean.includes("/") ? clean : `${categoryId}/${clean}`;
}

function shardCountFromManifest(categoryCount, shardSize, index) {
  const start = index * shardSize;
  return Math.max(0, Math.min(shardSize, categoryCount - start));
}

function normalizeManifest(raw) {
  const shardSize = Math.max(1, Number(raw?.shardSize) || 10);
  const categoryOrder = [];
  const categories = {};

  if (Array.isArray(raw?.categories)) {
    for (const category of raw.categories) {
      const id = String(category?.id || "").trim();
      if (!id || categories[id]) continue;
      const count = Math.max(0, Number(category?.count) || 0);
      const shards = (Array.isArray(category?.shards) ? category.shards : [])
        .map((entry, index) => {
          const sourceFile = typeof entry === "string" ? entry : entry?.file;
          const file = normalizeShardPath(id, sourceFile);
          if (!file) return null;
          const declaredCount = typeof entry === "object" ? Number(entry?.count) : 0;
          return {
            file,
            count: declaredCount > 0 ? declaredCount : shardCountFromManifest(count, shardSize, index),
          };
        })
        .filter(Boolean);

      categoryOrder.push(id);
      categories[id] = {
        id,
        name: String(category?.name || id),
        icon: category?.icon || null,
        count,
        shards,
      };
    }
  } else if (raw?.categories && typeof raw.categories === "object") {
    for (const [id, category] of Object.entries(raw.categories)) {
      const count = Math.max(0, Number(category?.count) || 0);
      const shards = (Array.isArray(category?.shards) ? category.shards : [])
        .map((entry, index) => {
          const sourceFile = typeof entry === "string" ? entry : entry?.file;
          const file = normalizeShardPath(id, sourceFile);
          if (!file) return null;
          const declaredCount = typeof entry === "object" ? Number(entry?.count) : 0;
          return {
            file,
            count: declaredCount > 0 ? declaredCount : shardCountFromManifest(count, shardSize, index),
          };
        })
        .filter(Boolean);
      categoryOrder.push(id);
      categories[id] = {id, name: category?.name || id, icon: category?.icon || null, count, shards};
    }
  }

  const totalQuestions = categoryOrder.reduce((sum, id) => sum + (Number(categories[id]?.count) || 0), 0);
  return {
    version: String(raw?.version || QUESTION_BANK_VERSION),
    shardSize,
    totalQuestions,
    categoryOrder,
    categories,
  };
}

function expandQuestion(raw, {file, index}) {
  // The supplied JSON remains untouched. Runtime-only metadata is derived here.
  const accepted = Array.isArray(raw?.correctAnswers) ? raw.correctAnswers.filter(Boolean) : [];
  const answer = accepted[0] ?? "";
  const decoys = Array.isArray(raw?.wrongAnswers) ? raw.wrongAnswers.filter(Boolean) : [];
  const image = raw?.image ?? null;
  const category = String(file || "").split("/")[0] || null;
  const id = `${QUESTION_ID_PREFIX}:${file}:${index + 1}`;
  const factKey = `${category || "question"}:${normalizedKeyPart(raw?.question)}:${normalizedKeyPart(answer)}`;

  return {
    id,
    prompt: raw?.question ?? "",
    answer,
    accepted,
    decoys,
    factKey,
    image,
    imageAlt: image ? raw?.imageAlt ?? "صورة السؤال" : "",
    answerImage: null,
    answerImageAlt: "",
    type: image ? "image" : "text",
    category,
  };
}

async function fetchJSON(url) {
  const response = await fetch(url, {cache: "default"});
  if (!response.ok) throw new Error(`QUESTION_HTTP_${response.status}`);
  return response.json();
}

export async function getQuestionManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJSON(MANIFEST_URL)
      .then(normalizeManifest)
      .catch((error) => {
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
  const url = new URL(file, QUESTION_ROOT_URL);
  const promise = fetchJSON(url)
    .then((items) => (Array.isArray(items) ? items.map((raw, index) => expandQuestion(raw, {file, index})) : []))
    .catch((error) => {
      shardCache.delete(file);
      throw error;
    });
  shardCache.set(file, promise);
  return promise;
}

async function loadCategoryQuestions(categoryId) {
  if (categoryCache.has(categoryId)) return categoryCache.get(categoryId);
  const promise = (async () => {
    const manifest = await getQuestionManifest();
    const categoryInfo = manifest.categories?.[categoryId];
    if (!categoryInfo?.shards?.length) return [];
    const groups = await Promise.all(categoryInfo.shards.map((shard) => loadShard(shard.file)));
    const questions = groups.flat();
    if (categoryInfo.count && questions.length !== categoryInfo.count) {
      console.warn(`Question count mismatch for ${categoryId}: manifest=${categoryInfo.count}, loaded=${questions.length}`);
    }
    return questions;
  })().catch((error) => {
    categoryCache.delete(categoryId);
    throw error;
  });
  categoryCache.set(categoryId, promise);
  return promise;
}

async function getCountryFlagIndex() {
  if (!flagIndexPromise) {
    flagIndexPromise = loadCategoryQuestions("flags")
      .then((questions) => {
        const index = new Map();
        for (const question of questions) {
          if (!question.image) continue;
          for (const answer of question.accepted) {
            const key = normalizedKeyPart(answer);
            if (key && !index.has(key)) {
              index.set(key, {
                image: question.image,
                imageAlt: question.imageAlt || `علم ${answer}`,
              });
            }
          }
        }
        return index;
      })
      .catch((error) => {
        flagIndexPromise = null;
        throw error;
      });
  }
  return flagIndexPromise;
}

async function addCountryRevealFlag(question) {
  if (question?.category !== "countries") return question;
  const index = await getCountryFlagIndex();
  for (const answer of question.accepted || []) {
    const normalizedAnswer = normalizedKeyPart(answer);
    const flag = index.get(normalizedAnswer);
    if (flag) {
      return {
        ...question,
        answerImage: flag.image,
        answerImageAlt: flag.imageAlt,
      };
    }

    // Some text-country questions (for example Turkey) do not have a matching
    // entry in the supplied flags category. Use the existing SVG asset by ISO
    // code without changing or supplementing the question JSON.
    const code = COUNTRY_FLAG_CODES_BY_NORMALIZED_NAME.get(normalizedAnswer);
    if (code) {
      return {
        ...question,
        answerImage: `/assets/countries/${code}.svg`,
        answerImageAlt: `علم ${answer}`,
      };
    }
  }
  return question;
}

function categoryHistory(history, categoryId, validQuestionIds) {
  history.categories ||= {};
  const validIds = new Set(validQuestionIds);
  const current = history.categories[categoryId];
  const seenIds = Array.isArray(current?.seenIds)
    ? [...new Set(current.seenIds.filter((id) => validIds.has(id)))]
    : [];

  const state = {
    seenIds,
    lastId: validIds.has(current?.lastId) ? current.lastId : null,
    cycle: Math.max(0, Number(current?.cycle) || 0),
  };

  // A new local cycle starts only after every concrete question has appeared.
  if (validQuestionIds.length && state.seenIds.length >= validQuestionIds.length) {
    state.seenIds = [];
    state.cycle += 1;
  }

  history.categories[categoryId] = state;
  return state;
}

function chooseWithoutImmediateBoundaryRepeat(candidates, lastId) {
  if (candidates.length <= 1 || !lastId) return randomItem(candidates);
  const withoutLast = candidates.filter((question) => question.id !== lastId);
  return randomItem(withoutLast.length ? withoutLast : candidates);
}

/**
 * Selects one exact question entry without replacement.
 *
 * Two independent protections are used:
 * 1. usedQuestionIds is the authoritative current-cycle record stored in the
 *    Firestore room, so host takeover and replay do not reintroduce questions.
 * 2. localStorage remembers the host device's cycle across newly created rooms.
 *
 * A category is reset only when all of its concrete question IDs have been used.
 * Question JSON files are never rewritten or supplemented.
 */
export async function selectQuestion(categoryId, {usedQuestionIds = []} = {}) {
  const questions = await loadCategoryQuestions(categoryId);
  if (!questions.length) return null;

  const categoryQuestionIds = questions.map((question) => question.id);
  const validIds = new Set(categoryQuestionIds);
  const roomUsed = new Set(
    (Array.isArray(usedQuestionIds) ? usedQuestionIds : [])
      .filter((id) => validIds.has(id)),
  );

  const roomCycleComplete = roomUsed.size >= categoryQuestionIds.length;
  const activeRoomUsed = roomCycleComplete ? new Set() : roomUsed;

  const history = readHistory();
  const state = categoryHistory(history, categoryId, categoryQuestionIds);
  const locallySeen = new Set(state.seenIds);
  const available = questions.filter((question) => !activeRoomUsed.has(question.id));
  if (!available.length) return null;

  // Prefer an entry unseen in both the room cycle and the persistent host cycle.
  // If a different host takes over, room safety has priority over that device's
  // private history, so any still-unused room entry remains eligible.
  const locallyUnseen = available.filter((question) => !locallySeen.has(question.id));
  const selected = chooseWithoutImmediateBoundaryRepeat(
    locallyUnseen.length ? locallyUnseen : available,
    state.lastId,
  );
  if (!selected) return null;

  if (!locallySeen.has(selected.id)) state.seenIds.push(selected.id);
  state.lastId = selected.id;
  history.categories[categoryId] = state;
  writeHistory(history);

  const enriched = await addCountryRevealFlag(selected);
  return {
    ...enriched,
    selectionMeta: {
      categoryId,
      categoryQuestionIds,
      categoryQuestionCount: categoryQuestionIds.length,
      roomCycleComplete,
    },
  };
}

export async function warmCategory(categoryId) {
  const questions = await loadCategoryQuestions(categoryId);
  return questions.length > 0;
}

export async function getQuestionCount(categoryId) {
  const questions = await loadCategoryQuestions(categoryId);
  return questions.length;
}

export async function getTotalQuestionCount() {
  const manifest = await getQuestionManifest();
  return Number(manifest.totalQuestions) || 0;
}

export function clearQuestionHistory(categoryId = null) {
  if (!categoryId) {
    try {
      globalThis.localStorage?.removeItem(HISTORY_KEY);
    } catch {}
    return;
  }
  const history = readHistory();
  delete history.categories?.[categoryId];
  writeHistory(history);
}

export const QUESTION_STORE_VERSION = QUESTION_BANK_VERSION;
export const QUESTION_BANK_PATH = `questions/v${QUESTION_PATH_VERSION}/`;
