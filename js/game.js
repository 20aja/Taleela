import { db } from "./firebase.js";
import { notify } from "./ui.js";

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import { QUESTION_BANK, categoryHasQuestions, getQuestionCount } from "./questions.js";
export { categoryHasQuestions, getQuestionCount } from "./questions.js";

const CORRECT_GUESS_POINTS = 2;
const FOOLED_PLAYER_POINTS = 1;
const ACTIVE_PLAYER_WINDOW_MS = 90_000;

let roomId = null;
let roomCode = null;
let playerId = null;
let currentRoom = null;
let unsubscribeGameRoom = null;
let timerInterval = null;
let activeDeadlineMs = null;
let activeTimerPhase = null;
let transitionInProgress = false;
let unsubscribeChat = null;
let chatRoomId = null;
let chatListenerStartedAt = 0;
let seenChatMessageIds = new Set();
let lastTimeoutNoticeKey = null;
let lastRevealNoticeKey = null;

export const GAME_CATEGORIES = [
  { id: "general", name: "معلومات عامة", icon: "fa-solid fa-globe" },
  { id: "history", name: "التاريخ", icon: "fa-solid fa-landmark" },
  { id: "geography", name: "الجغرافيا", icon: "fa-solid fa-earth-americas" },
  { id: "science", name: "العلوم", icon: "fa-solid fa-flask" },
  { id: "technology", name: "التكنولوجيا", icon: "fa-solid fa-microchip" },
  { id: "sports", name: "الرياضة", icon: "fa-solid fa-medal" },
  { id: "football", name: "كرة القدم", icon: "fa-solid fa-futbol" },
  { id: "player_guess", name: "خمن اللاعب", icon: "fa-solid fa-user-secret" },
  { id: "movies", name: "الأفلام", icon: "fa-solid fa-film" },
  { id: "series", name: "المسلسلات", icon: "fa-solid fa-tv" },
  { id: "bab_al_hara", name: "باب الحارة", icon: "fa-solid fa-door-open" },
  { id: "music", name: "الموسيقى", icon: "fa-solid fa-music" },
  { id: "literature", name: "الأدب", icon: "fa-solid fa-book" },
  { id: "language", name: "اللغة العربية", icon: "fa-solid fa-language" },
  { id: "islamic", name: "الثقافة الإسلامية", icon: "fa-solid fa-mosque" },
  { id: "countries", name: "الدول والعواصم", icon: "fa-solid fa-city" },
  { id: "animals", name: "الحيوانات", icon: "fa-solid fa-paw" },
  { id: "food", name: "الطعام", icon: "fa-solid fa-utensils" },
  { id: "inventions", name: "الاختراعات", icon: "fa-solid fa-lightbulb" },
  { id: "space", name: "الفضاء", icon: "fa-solid fa-rocket" },
  { id: "medicine", name: "الطب", icon: "fa-solid fa-stethoscope" },
  { id: "cars", name: "السيارات", icon: "fa-solid fa-car" },
  { id: "programming", name: "البرمجة", icon: "fa-solid fa-code" },
  { id: "internet", name: "الإنترنت", icon: "fa-solid fa-wifi" },
  { id: "art", name: "الفن", icon: "fa-solid fa-palette" },
  { id: "fashion", name: "الموضة", icon: "fa-solid fa-shirt" },
  { id: "brands", name: "العلامات التجارية", icon: "fa-solid fa-tag" },
  { id: "famous_people", name: "شخصيات مشهورة", icon: "fa-solid fa-user" },
  { id: "riddles", name: "ألغاز", icon: "fa-solid fa-puzzle-piece" },
  { id: "logic", name: "المنطق", icon: "fa-solid fa-brain" },
  { id: "numbers", name: "الأرقام والحساب", icon: "fa-solid fa-calculator" },
  { id: "culture", name: "الثقافة", icon: "fa-solid fa-masks-theater" },
  { id: "iraq", name: "بلاد الرافدين", icon: "fa-solid fa-landmark-dome" },
];

const CATEGORY_NAMES = Object.fromEntries(GAME_CATEGORIES.map((category) => [category.id, category.name]));



function playersMap(room) {
  const raw = room?.players;
  if (raw && !Array.isArray(raw) && typeof raw === "object") return raw;
  return {};
}

function playerList(room) {
  return Object.values(playersMap(room))
    .filter((player) => player?.id)
    .sort((a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)));
}

function valueToMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const DEFAULT_AVATAR = "avatar-01";
const AVATAR_PATTERN = /^avatar-(0[1-9]|1[0-9]|20)$/;

function normalizeAvatarId(value) {
  const avatar = String(value || "");
  return AVATAR_PATTERN.test(avatar) ? avatar : DEFAULT_AVATAR;
}

function avatarSrc(value) {
  return `assets/Users/${normalizeAvatarId(value)}.png`;
}

function avatarHTML(value, className = "avatar-image", alt = "صورة اللاعب") {
  return `<img class="${className}" src="${avatarSrc(value)}" alt="${escapeHTML(alt)}" draggable="false" />`;
}

function normalizeAnswer(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/[.,،؛;:!?؟()\[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = Math.floor(Math.random() * (index + 1));
    [result[index], result[random]] = [result[random], result[index]];
  }
  return result;
}

function phaseDuration(room, phase) {
  const settings = room?.settings || {};
  if (phase === "category_selection") return Math.max(5, Math.min(20, Number(settings.selectionTime) || 20));
  if (phase === "bluffing" || phase === "guessing") return Math.max(10, Math.min(60, Number(settings.answerTime) || 15));
  if (phase === "reveal") return Math.max(8, Math.min(60, Number(settings.revealTime) || 20));
  if (phase === "results") return Math.max(3, Math.min(15, Number(settings.resultsTime) || 5));
  return 0;
}

function setPhaseVisibility(activeId) {
  [
    "categorySelectionPhase",
    "bluffPhase",
    "guessPhase",
    "revealPhase",
    "roundResultsPhase",
    "finalResultsPhase",
  ].forEach((id) => {
    document.getElementById(id)?.classList.toggle("hidden", id !== activeId);
  });
}

function showGameScreen() {
  document.getElementById("gameScreen")?.classList.remove("hidden");
  document.getElementById("roomScreen")?.classList.add("hidden");
  document.getElementById("homeScreen")?.classList.add("hidden");
}

function showLoading(show, title = "جاري تجهيز الجولة...", text = "يتم مزامنة المرحلة مع جميع اللاعبين.") {
  const loading = document.getElementById("gameLoading");
  loading?.classList.toggle("hidden", !show);
  if (show) {
    const heading = loading?.querySelector("h2");
    const paragraph = loading?.querySelector("p");
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = text;
  }
}

function showGameError(message) {
  const box = document.getElementById("gameError");
  if (!box) return;
  if (!message) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(message)}`;
}

function setRoundLabel(room) {
  const round = room?.round;
  const element = document.getElementById("gameRound");
  if (!element || !round) return;
  element.textContent = `جولة ${Number(round.number) || 1}/${Number(round.total) || Number(room?.settings?.rounds) || 6}`;
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  activeDeadlineMs = null;
  activeTimerPhase = null;
}

function startTimer(room, deadlineValue, phase) {
  const deadline = valueToMillis(deadlineValue);
  const timerElement = document.getElementById("gameTimer");
  const ring = document.getElementById("timerRing");
  const resultCountdown = document.getElementById("resultCountdown");

  if (!deadline) {
    stopTimer();
    if (timerElement) timerElement.textContent = "0";
    if (ring) ring.classList.add("hidden");
    return;
  }

  const duration = Math.max(1, phaseDuration(room, phase));
  if (ring) ring.classList.toggle("hidden", phase === "results");

  if (timerInterval && activeDeadlineMs === deadline && activeTimerPhase === phase) return;
  stopTimer();
  activeDeadlineMs = deadline;
  activeTimerPhase = phase;

  const tick = () => {
    const remainingMs = Math.max(0, deadline - Date.now());
    const remaining = Math.ceil(remainingMs / 1000);
    if (timerElement) timerElement.textContent = String(remaining);
    if (phase === "results" && resultCountdown) resultCountdown.textContent = String(remaining);

    if (ring) {
      const progress = Math.max(0, Math.min(1, remainingMs / (duration * 1000)));
      ring.style.setProperty("--progress", `${progress * 100}%`);
      ring.classList.toggle("timer-danger", remaining <= Math.min(5, Math.ceil(duration / 3)));
    }

    if (remainingMs <= 0) {
      const roundKey = currentRoom?.round?.id || "round";
      const noticeKey = `${roundKey}:${phase}`;
      if (lastTimeoutNoticeKey !== noticeKey && phase !== "results") {
        lastTimeoutNoticeKey = noticeKey;
        const messages = {
          category_selection: "انتهى وقت اختيار الفئة.",
          bluffing: "انتهى وقت كتابة الكذبة.",
          guessing: "انتهى وقت اختيار الإجابة.",
          reveal: "انتهى وقت مراجعة الإجابات.",
        };
        notify(messages[phase] || "انتهى الوقت.", { type: "warning", title: "انتهى الوقت", duration: 3200 });
      }
      stopTimer();
      if (currentRoom?.hostId === playerId) coordinateHost(currentRoom);
    }
  };

  tick();
  timerInterval = setInterval(tick, 250);
}

function buildNewRound(room, number) {
  const players = playerList(room);
  const categories = Array.isArray(room?.categories) ? room.categories.filter(categoryHasQuestions) : [];
  if (players.length < 1 || categories.length < 1) return null;

  const total = Math.max(1, Math.min(50, Number(room?.settings?.rounds) || 6));
  const chooser = players[(number - 1) % players.length];
  const selectionTime = phaseDuration(room, "category_selection");
  const now = Date.now();

  return {
    id: `${number}-${crypto.randomUUID()}`,
    number,
    total,
    chooserId: chooser.id,
    phase: "category_selection",
    categoryOptions: [...categories],
    categoryChoice: null,
    selectionDeadline: Timestamp.fromMillis(now + selectionTime * 1000),
    categoryId: null,
    categoryName: null,
    questionId: null,
    question: null,
    questionImage: null,
    questionImageAlt: null,
    correctAnswer: null,
    acceptedAnswers: [],
    systemDecoys: [],
    questionFactKey: null,
    bluffDeadline: null,
    bluffs: {},
    options: {},
    optionOrder: [],
    guessDeadline: null,
    guesses: {},
    revealDeadline: null,
    revealReady: {},
    results: null,
    resultsDeadline: null,
  };
}

function pickQuestion(room, categoryId) {
  const questions = QUESTION_BANK[categoryId] || [];
  if (!questions.length) return null;
  const usedIds = new Set(Array.isArray(room?.usedQuestionIds) ? room.usedQuestionIds : []);
  const usedFacts = new Set(Array.isArray(room?.usedFactKeys) ? room.usedFactKeys : []);
  const freshFacts = questions.filter((question) => !usedFacts.has(question.factKey || question.id));
  const freshIds = questions.filter((question) => !usedIds.has(question.id));
  const pool = freshFacts.length ? freshFacts : freshIds.length ? freshIds : questions;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function answerSimilarity(a, b) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  if (!x || !y) return 0;
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  let shared = 0;
  xs.forEach((token) => { if (ys.has(token)) shared += 1; });
  const union = new Set([...xs, ...ys]).size || 1;
  const tokenScore = shared / union;
  const lengthScore = 1 - Math.min(1, Math.abs(x.length - y.length) / Math.max(x.length, y.length, 1));
  return tokenScore * 0.7 + lengthScore * 0.3;
}

function generatedCloseDecoys(answer) {
  const raw = String(answer || "").trim();
  const normalized = normalizeAnswer(raw);
  if (!raw) return [];

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const value = Number(normalized);
    const step = Math.max(1, Math.round(Math.abs(value) * 0.03));
    return [value - step, value + step, value - 2 * step, value + 2 * step].map(String);
  }

  const parts = raw.split(/\s*[،|]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const out = [];
    const swapped = [...parts];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    out.push(swapped.join("، "));
    out.push([...parts.slice(1), parts[0]].join("، "));
    out.push([...parts].reverse().join("، "));
    return out;
  }
  return [];
}

function buildSystemDecoys(round, excludedNormalized, needed) {
  if (needed <= 0) return [];
  const preferred = Array.isArray(round.systemDecoys) ? round.systemDecoys : [];
  const sameCategory = (QUESTION_BANK[round.categoryId] || [])
    .filter((question) => question.factKey !== round.questionFactKey)
    .map((question) => question.answer)
    .filter(Boolean)
    .sort((a, b) => answerSimilarity(b, round.correctAnswer) - answerSimilarity(a, round.correctAnswer));
  const candidates = [...preferred, ...generatedCloseDecoys(round.correctAnswer), ...sameCategory];
  const chosen = [];

  for (const text of candidates) {
    const normalized = normalizeAnswer(text);
    if (!normalized || normalized === normalizeAnswer(round.correctAnswer) || excludedNormalized.has(normalized)) continue;
    excludedNormalized.add(normalized);
    chosen.push(text);
    if (chosen.length >= needed) break;
  }
  return chosen;
}

function buildGuessOptions(room) {
  const round = room.round;
  const players = playerList(room);
  const options = {};
  const order = [];
  const excluded = new Set();

  const correctText = round.correctAnswer || "";
  const correctId = `correct_${round.questionId || "answer"}`;
  options[correctId] = { id: correctId, text: correctText, type: "correct", authorId: null };
  order.push(correctId);
  excluded.add(normalizeAnswer(correctText));

  players.forEach((player) => {
    const bluff = round.bluffs?.[player.id];
    const text = bluff?.text?.trim();
    if (!text) return;
    const normalized = normalizeAnswer(text);
    if (!normalized || excluded.has(normalized)) return;
    excluded.add(normalized);
    const id = `bluff_${player.id}`;
    options[id] = { id, text, type: "bluff", authorId: player.id };
    order.push(id);
  });

  const targetSharedOptionCount = Math.max(5, order.length);
  const decoys = buildSystemDecoys(round, excluded, targetSharedOptionCount - order.length);
  decoys.forEach((text, index) => {
    const id = `system_${index + 1}_${round.id}`;
    options[id] = { id, text, type: "system", authorId: null };
    order.push(id);
  });

  return { options, optionOrder: shuffle(order) };
}

function comparePlayersForRanking(a, b) {
  // 1) مجموع النقاط، 2) عدد الإجابات الصحيحة، 3) عدد اللاعبين الذين خُدعوا بالكذبة.
  const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
  if (scoreDiff) return scoreDiff;

  const correctDiff = (Number(b.correctGuesses) || 0) - (Number(a.correctGuesses) || 0);
  if (correctDiff) return correctDiff;

  const fooledDiff = (Number(b.fooledPlayers) || 0) - (Number(a.fooledPlayers) || 0);
  if (fooledDiff) return fooledDiff;

  // كسر تعادل نادر بعد تساوي المؤشرات الثلاثة: الأسبق دخولًا ثم الاسم، لضمان ترتيب ثابت على كل الأجهزة.
  const joinedDiff = valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt);
  if (joinedDiff) return joinedDiff;
  return String(a.name || "").localeCompare(String(b.name || ""), "ar");
}

function rankingFromPlayers(playersObject) {
  return Object.values(playersObject || {})
    .filter((player) => player?.id)
    .sort(comparePlayersForRanking)
    .map((player, index) => ({
      id: player.id,
      name: player.name || "لاعب",
      avatar: normalizeAvatarId(player.avatar),
      score: Number(player.score) || 0,
      correctGuesses: Number(player.correctGuesses) || 0,
      fooledPlayers: Number(player.fooledPlayers) || 0,
      rank: index + 1,
    }));
}

async function createFirstRound() {
  if (!roomId || !playerId || transitionInProgress) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (room.hostId !== playerId || room.status !== "starting" || room.round) return;

      const players = playerList(room);
      if (players.length < 2) {
        transaction.update(roomRef, { status: "waiting", gameError: "يجب أن يبقى لاعبان على الأقل لبدء اللعبة." });
        return;
      }

      const round = buildNewRound(room, 1);
      if (!round) {
        transaction.update(roomRef, { status: "waiting", gameError: "لا توجد فئات صالحة لبدء اللعبة." });
        return;
      }

      transaction.update(roomRef, {
        status: "playing",
        round,
        usedQuestionIds: [],
        usedFactKeys: [],
        finalResults: null,
        gameError: null,
        finishedAt: null,
        replayRequests: {},
        returnRequests: {},
      });
    });
  } catch (error) {
    console.error("createFirstRound failed:", error);
    showGameError("تعذر إنشاء الجولة الأولى.");
  } finally {
    transitionInProgress = false;
  }
}

async function selectCategory(categoryId) {
  if (!roomId || !playerId || !currentRoom?.round) return;
  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      const round = room.round;
      if (room.status !== "playing" || round?.phase !== "category_selection") throw new Error("PHASE_CLOSED");
      if (round.chooserId !== playerId) throw new Error("NOT_CHOOSER");
      if (round.categoryChoice) return;
      if (!Array.isArray(round.categoryOptions) || !round.categoryOptions.includes(categoryId)) throw new Error("INVALID_CATEGORY");
      const deadline = valueToMillis(round.selectionDeadline);
      if (deadline && Date.now() >= deadline) throw new Error("TIME_EXPIRED");

      transaction.update(roomRef, { "round.categoryChoice": categoryId });
    });
  } catch (error) {
    console.error("selectCategory failed:", error);
    if (error?.message === "NOT_CHOOSER") notify("اختيار الفئة متاح للاعب صاحب الدور فقط.", { type: "warning" });
    else if (error?.message === "TIME_EXPIRED") notify("انتهى وقت اختيار الفئة.", { type: "warning" });
  }
}

async function advanceFromCategorySelection(roomSnapshot = currentRoom) {
  if (!roomId || !playerId || transitionInProgress || roomSnapshot?.hostId !== playerId) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const round = room.round;
      if (room.hostId !== playerId || room.status !== "playing" || round?.phase !== "category_selection") return;

      const deadline = valueToMillis(round.selectionDeadline);
      if (!round.categoryChoice && deadline > Date.now()) return;

      const categoryOptions = Array.isArray(round.categoryOptions) ? round.categoryOptions.filter(categoryHasQuestions) : [];
      const categoryId = round.categoryChoice || categoryOptions[Math.floor(Math.random() * categoryOptions.length)];
      if (!categoryId) {
        transaction.update(roomRef, { status: "finished", finalResults: rankingFromPlayers(playersMap(room)), gameError: "لا توجد فئة صالحة." });
        return;
      }

      const question = pickQuestion(room, categoryId);
      if (!question) {
        transaction.update(roomRef, { status: "finished", finalResults: rankingFromPlayers(playersMap(room)), gameError: "لا توجد أسئلة متاحة لهذه الفئة." });
        return;
      }

      const answerTime = phaseDuration(room, "bluffing");
      transaction.update(roomRef, {
        "round.categoryChoice": categoryId,
        "round.categoryId": categoryId,
        "round.categoryName": CATEGORY_NAMES[categoryId] || categoryId,
        "round.questionId": question.id,
        "round.question": question.prompt,
        "round.questionImage": question.image || null,
        "round.questionImageAlt": question.imageAlt || null,
        "round.correctAnswer": question.answer,
        "round.acceptedAnswers": question.accepted,
        "round.systemDecoys": Array.isArray(question.decoys) ? question.decoys.slice(0, 8) : [],
        "round.questionFactKey": question.factKey || question.id,
        "round.phase": "bluffing",
        "round.bluffDeadline": Timestamp.fromMillis(Date.now() + answerTime * 1000),
        "round.bluffs": {},
        usedQuestionIds: [...(Array.isArray(room.usedQuestionIds) ? room.usedQuestionIds : []), question.id],
        usedFactKeys: [...(Array.isArray(room.usedFactKeys) ? room.usedFactKeys : []), question.factKey || question.id],
      });
    });
  } catch (error) {
    console.error("advanceFromCategorySelection failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

async function submitBluff() {
  if (!roomId || !playerId || !currentRoom?.round || currentRoom.round.phase !== "bluffing") return;
  const input = document.getElementById("gameAnswer");
  const button = document.getElementById("confirmAnswer");
  const text = input?.value?.trim() || "";

  if (!text) {
    notify("اكتب كذبة أولًا.", { type: "warning" });
    input?.focus();
    return;
  }

  const accepted = Array.isArray(currentRoom.round.acceptedAnswers) ? currentRoom.round.acceptedAnswers : [currentRoom.round.correctAnswer];
  if (accepted.some((answer) => normalizeAnswer(answer) === normalizeAnswer(text))) {
    notify("هذه هي الإجابة الصحيحة فعلًا. اكتب إجابة خاطئة مقنعة.", { type: "warning", title: "هذه ليست كذبة" });
    input?.focus();
    return;
  }

  if (button) button.disabled = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      const round = room.round;
      if (!playersMap(room)[playerId]) throw new Error("PLAYER_NOT_FOUND");
      if (room.status !== "playing" || round?.phase !== "bluffing") throw new Error("PHASE_CLOSED");
      if (round.bluffs?.[playerId]) throw new Error("ALREADY_SUBMITTED");
      const deadline = valueToMillis(round.bluffDeadline);
      if (deadline && Date.now() >= deadline) throw new Error("TIME_EXPIRED");

      const normalized = normalizeAnswer(text);
      const acceptedAnswers = Array.isArray(round.acceptedAnswers) ? round.acceptedAnswers : [round.correctAnswer];
      if (acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalized)) throw new Error("IS_CORRECT");

      const duplicate = Object.values(round.bluffs || {}).some((bluff) => normalizeAnswer(bluff?.text) === normalized);
      if (duplicate) throw new Error("DUPLICATE_BLUFF");

      transaction.update(roomRef, {
        [`round.bluffs.${playerId}`]: {
          text: text.slice(0, 120),
          submittedAt: serverTimestamp(),
        },
      });
    });
    notify("تم إرسال كذبتك بنجاح.", { type: "success", duration: 2200 });
  } catch (error) {
    console.error("submitBluff failed:", error);
    const messages = {
      IS_CORRECT: "هذه هي الإجابة الصحيحة. اكتب كذبة أخرى.",
      DUPLICATE_BLUFF: "لا يمكن استخدام نفس كذبة لاعب آخر. اكتب كذبة مختلفة.",
      TIME_EXPIRED: "انتهى وقت كتابة الكذبة.",
      ALREADY_SUBMITTED: "أرسلت كذبتك بالفعل.",
    };
    notify(messages[error?.message] || "تعذر إرسال الكذبة.", { type: error?.message === "ALREADY_SUBMITTED" ? "info" : "warning" });
  } finally {
    if (button) button.disabled = false;
  }
}

async function advanceToGuessing(roomSnapshot = currentRoom) {
  if (!roomId || !playerId || transitionInProgress || roomSnapshot?.hostId !== playerId) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const round = room.round;
      if (room.hostId !== playerId || room.status !== "playing" || round?.phase !== "bluffing") return;

      const ids = playerList(room).map((player) => player.id);
      const allSubmitted = ids.length > 0 && ids.every((id) => Boolean(round.bluffs?.[id]?.text));
      const deadline = valueToMillis(round.bluffDeadline);
      if (!allSubmitted && deadline > Date.now()) return;

      const { options, optionOrder } = buildGuessOptions(room);
      const answerTime = phaseDuration(room, "guessing");

      transaction.update(roomRef, {
        "round.phase": "guessing",
        "round.options": options,
        "round.optionOrder": optionOrder,
        "round.guesses": {},
        "round.guessDeadline": Timestamp.fromMillis(Date.now() + answerTime * 1000),
      });
    });
  } catch (error) {
    console.error("advanceToGuessing failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

async function submitGuess(optionId) {
  if (!roomId || !playerId || !optionId) return;
  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      const round = room.round;
      if (!playersMap(room)[playerId]) throw new Error("PLAYER_NOT_FOUND");
      if (room.status !== "playing" || round?.phase !== "guessing") throw new Error("PHASE_CLOSED");
      if (round.guesses?.[playerId]) throw new Error("ALREADY_GUESSED");
      const deadline = valueToMillis(round.guessDeadline);
      if (deadline && Date.now() >= deadline) throw new Error("TIME_EXPIRED");

      const option = round.options?.[optionId];
      if (!option) throw new Error("INVALID_OPTION");
      if (option.type === "bluff" && option.authorId === playerId) throw new Error("OWN_BLUFF");

      transaction.update(roomRef, {
        [`round.guesses.${playerId}`]: {
          optionId,
          submittedAt: serverTimestamp(),
        },
      });
    });
    notify("تم حفظ اختيارك. بانتظار بقية اللاعبين...", { type: "success", duration: 2400 });
  } catch (error) {
    console.error("submitGuess failed:", error);
    const messages = {
      OWN_BLUFF: "لا يمكنك اختيار كذبتك.",
      TIME_EXPIRED: "انتهى وقت الاختيار.",
      ALREADY_GUESSED: "اخترت إجابتك بالفعل.",
    };
    notify(messages[error?.message] || "تعذر حفظ اختيارك.", { type: error?.message === "ALREADY_GUESSED" ? "info" : "warning" });
  }
}

async function advanceToReveal(roomSnapshot = currentRoom) {
  if (!roomId || !playerId || transitionInProgress || roomSnapshot?.hostId !== playerId) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const round = room.round;
      if (room.hostId !== playerId || room.status !== "playing" || round?.phase !== "guessing") return;

      const ids = playerList(room).map((player) => player.id);
      const allGuessed = ids.length > 0 && ids.every((id) => Boolean(round.guesses?.[id]?.optionId));
      const deadline = valueToMillis(round.guessDeadline);
      if (!allGuessed && deadline > Date.now()) return;

      const revealTime = phaseDuration(room, "reveal");
      transaction.update(roomRef, {
        "round.phase": "reveal",
        "round.revealReady": {},
        "round.revealDeadline": Timestamp.fromMillis(Date.now() + revealTime * 1000),
      });
    });
  } catch (error) {
    console.error("advanceToReveal failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

async function markRevealReady() {
  if (!roomId || !playerId) return;
  const button = document.getElementById("revealReadyButton");
  if (button) button.disabled = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      const round = room.round;
      if (!playersMap(room)[playerId]) throw new Error("PLAYER_NOT_FOUND");
      if (room.status !== "playing" || round?.phase !== "reveal") throw new Error("PHASE_CLOSED");
      if (round.revealReady?.[playerId] === true) return;
      transaction.update(roomRef, { [`round.revealReady.${playerId}`]: true });
    });
  } catch (error) {
    console.error("markRevealReady failed:", error);
    if (button) button.disabled = false;
  }
}

async function scoreRound(roomSnapshot = currentRoom) {
  if (!roomId || !playerId || transitionInProgress || roomSnapshot?.hostId !== playerId) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const round = room.round;
      if (room.hostId !== playerId || room.status !== "playing" || round?.phase !== "reveal") return;

      const ids = playerList(room).map((player) => player.id);
      const allReady = ids.length > 0 && ids.every((id) => round.revealReady?.[id] === true);
      const deadline = valueToMillis(round.revealDeadline);
      if (!allReady && deadline > Date.now()) return;

      const updatedPlayers = Object.fromEntries(
        Object.entries(playersMap(room)).map(([id, player]) => [id, { ...player }]),
      );
      const roundPoints = Object.fromEntries(ids.map((id) => [id, 0]));
      const correctThisRound = Object.fromEntries(ids.map((id) => [id, false]));
      const fooledThisRound = Object.fromEntries(ids.map((id) => [id, 0]));

      ids.forEach((guesserId) => {
        const guess = round.guesses?.[guesserId];
        if (!guess?.optionId) return;
        const option = round.options?.[guess.optionId];
        if (!option) return;

        if (option.type === "correct") {
          roundPoints[guesserId] += CORRECT_GUESS_POINTS;
          correctThisRound[guesserId] = true;
          updatedPlayers[guesserId].correctGuesses = (Number(updatedPlayers[guesserId].correctGuesses) || 0) + 1;
        } else if (option.type === "bluff" && option.authorId && option.authorId !== guesserId && updatedPlayers[option.authorId]) {
          roundPoints[option.authorId] += FOOLED_PLAYER_POINTS;
          fooledThisRound[option.authorId] += 1;
          updatedPlayers[option.authorId].fooledPlayers = (Number(updatedPlayers[option.authorId].fooledPlayers) || 0) + 1;
        }
      });

      const results = {};
      ids.forEach((id) => {
        const previous = Number(updatedPlayers[id].score) || 0;
        const gained = Number(roundPoints[id]) || 0;
        updatedPlayers[id].score = previous + gained;
        results[id] = {
          roundPoints: gained,
          totalScore: updatedPlayers[id].score,
          correct: correctThisRound[id] === true,
          fooled: Number(fooledThisRound[id]) || 0,
        };
      });

      const resultsTime = phaseDuration(room, "results");
      transaction.update(roomRef, {
        players: updatedPlayers,
        "round.phase": "results",
        "round.results": results,
        "round.resultsDeadline": Timestamp.fromMillis(Date.now() + resultsTime * 1000),
      });
    });
  } catch (error) {
    console.error("scoreRound failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

async function advanceAfterResults(roomSnapshot = currentRoom) {
  if (!roomId || !playerId || transitionInProgress || roomSnapshot?.hostId !== playerId) return;
  transitionInProgress = true;

  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const round = room.round;
      if (room.hostId !== playerId || room.status !== "playing" || round?.phase !== "results") return;

      const deadline = valueToMillis(round.resultsDeadline);
      if (deadline > Date.now()) return;

      const currentNumber = Number(round.number) || 1;
      const total = Math.max(1, Math.min(50, Number(room?.settings?.rounds) || 6));

      if (currentNumber >= total || playerList(room).length < 2) {
        transaction.update(roomRef, {
          status: "finished",
          finalResults: rankingFromPlayers(playersMap(room)),
          finishedAt: Timestamp.now(),
          replayRequests: {},
          returnRequests: {},
        });
        return;
      }

      const nextRound = buildNewRound(room, currentNumber + 1);
      if (!nextRound) {
        transaction.update(roomRef, {
          status: "finished",
          finalResults: rankingFromPlayers(playersMap(room)),
          finishedAt: Timestamp.now(),
          gameError: "تعذر إنشاء الجولة التالية.",
        });
        return;
      }

      transaction.update(roomRef, { round: nextRound, gameError: null });
    });
  } catch (error) {
    console.error("advanceAfterResults failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

function coordinateHost(room) {
  if (!room || room.hostId !== playerId || transitionInProgress) return;

  if (room.status === "starting" && !room.round) {
    createFirstRound();
    return;
  }

  if (room.status !== "playing" || !room.round) return;
  const round = room.round;

  if (round.phase === "category_selection") {
    const expired = valueToMillis(round.selectionDeadline) <= Date.now();
    if (round.categoryChoice || expired) advanceFromCategorySelection(room);
    return;
  }

  if (round.phase === "bluffing") {
    const ids = playerList(room).map((player) => player.id);
    const allSubmitted = ids.length > 0 && ids.every((id) => Boolean(round.bluffs?.[id]?.text));
    const expired = valueToMillis(round.bluffDeadline) <= Date.now();
    if (allSubmitted || expired) advanceToGuessing(room);
    return;
  }

  if (round.phase === "guessing") {
    const ids = playerList(room).map((player) => player.id);
    const allGuessed = ids.length > 0 && ids.every((id) => Boolean(round.guesses?.[id]?.optionId));
    const expired = valueToMillis(round.guessDeadline) <= Date.now();
    if (allGuessed || expired) advanceToReveal(room);
    return;
  }

  if (round.phase === "reveal") {
    const ids = playerList(room).map((player) => player.id);
    const allReady = ids.length > 0 && ids.every((id) => round.revealReady?.[id] === true);
    const expired = valueToMillis(round.revealDeadline) <= Date.now();
    if (allReady || expired) scoreRound(room);
    return;
  }

  if (round.phase === "results" && valueToMillis(round.resultsDeadline) <= Date.now()) {
    advanceAfterResults(room);
  }
}

function renderCategorySelection(room) {
  setPhaseVisibility("categorySelectionPhase");
  const round = room.round;
  const players = playersMap(room);
  const chooser = players[round.chooserId];
  const isChooser = round.chooserId === playerId;
  const choice = round.categoryChoice;

  const avatar = document.getElementById("turnPlayerAvatar");
  const name = document.getElementById("turnPlayerName");
  const label = document.getElementById("turnLabel");
  const instruction = document.getElementById("categoryInstruction");
  const grid = document.getElementById("roundCategoryChoices");

  if (avatar) avatar.innerHTML = avatarHTML(chooser?.avatar, "turn-avatar-img", `صورة ${chooser?.name || "اللاعب"}`);
  if (name) name.textContent = chooser?.name || "لاعب";
  if (label) label.textContent = isChooser ? "الدور على: (أنت)" : "الدور على:";
  if (instruction) {
    instruction.textContent = choice
      ? "تم اختيار الفئة، جاري تجهيز السؤال..."
      : isChooser
        ? "اختر فئة هذه الجولة قبل انتهاء الوقت."
        : `بانتظار ${chooser?.name || "صاحب الدور"} لاختيار الفئة.`;
  }

  if (grid) {
    grid.innerHTML = (round.categoryOptions || []).map((categoryId) => {
      const category = GAME_CATEGORIES.find((item) => item.id === categoryId);
      const disabled = !isChooser || Boolean(choice);
      return `
        <button type="button" class="round-category-choice" data-round-category="${escapeHTML(categoryId)}" ${disabled ? "disabled" : ""}>
          <i class="${category?.icon || "fa-solid fa-layer-group"}"></i>
          ${escapeHTML(category?.name || categoryId)}
        </button>
      `;
    }).join("");

    grid.querySelectorAll("[data-round-category]").forEach((button) => {
      button.addEventListener("click", () => selectCategory(button.dataset.roundCategory));
    });
  }

  startTimer(room, round.selectionDeadline, round.phase);
}

function renderQuestionMedia(containerId, round) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const src = String(round?.questionImage || "").trim();
  if (!src) {
    container.replaceChildren();
    container.classList.add("hidden");
    return;
  }

  const image = document.createElement("img");
  image.className = "question-media-image";
  image.src = src;
  image.alt = round?.questionImageAlt || "صورة السؤال";
  image.loading = "eager";
  image.decoding = "async";
  image.addEventListener("error", () => {
    container.replaceChildren();
    container.classList.add("hidden");
  }, { once: true });
  container.replaceChildren(image);
  container.classList.remove("hidden");
}

function renderBluffing(room) {
  setPhaseVisibility("bluffPhase");
  const round = room.round;
  const myBluff = round.bluffs?.[playerId];
  const input = document.getElementById("gameAnswer");
  const button = document.getElementById("confirmAnswer");
  const category = document.getElementById("gameCategory");
  const question = document.getElementById("gameQuestion");
  const status = document.getElementById("playersAnswered");
  const ids = playerList(room).map((player) => player.id);
  const submitted = ids.filter((id) => Boolean(round.bluffs?.[id]?.text)).length;

  if (category) category.textContent = round.categoryName || CATEGORY_NAMES[round.categoryId] || "فئة";
  if (question) question.textContent = round.question || "";
  renderQuestionMedia("gameQuestionMedia", round);
  if (status) status.textContent = `${submitted} / ${ids.length} أرسلوا كذبتهم`;

  if (input) {
    input.disabled = Boolean(myBluff);
    if (myBluff) input.value = myBluff.text || "";
    else if (input.dataset.roundId !== round.id) input.value = "";
    input.dataset.roundId = round.id;
  }
  if (button) {
    button.disabled = Boolean(myBluff);
    button.innerHTML = myBluff
      ? '<i class="fa-solid fa-circle-check"></i> تم إرسال كذبتك'
      : '<i class="fa-solid fa-paper-plane"></i> أرسل الكذبة';
  }

  startTimer(room, round.bluffDeadline, round.phase);
}

function renderGuessing(room) {
  setPhaseVisibility("guessPhase");
  const round = room.round;
  const question = document.getElementById("guessQuestion");
  const optionsGrid = document.getElementById("guessOptions");
  const ownBluffCard = document.getElementById("ownBluffCard");
  const waiting = document.getElementById("guessWaiting");
  const playersGuessed = document.getElementById("playersGuessed");
  const myGuessCard = document.getElementById("myGuessCard");
  const playersGrid = document.getElementById("guessPlayersGrid");

  if (question) question.textContent = round.question || "";
  renderQuestionMedia("guessQuestionMedia", round);
  const myBluffId = `bluff_${playerId}`;
  const myBluff = round.options?.[myBluffId] || null;
  const myGuess = round.guesses?.[playerId] || null;
  const ids = playerList(room).map((player) => player.id);
  const guessedCount = ids.filter((id) => Boolean(round.guesses?.[id]?.optionId)).length;

  if (playersGuessed) playersGuessed.textContent = `${guessedCount}/${ids.length} جاهزون`;

  if (myGuess) {
    if (optionsGrid) optionsGrid.classList.add("hidden");
    if (ownBluffCard) ownBluffCard.classList.add("hidden");
    if (waiting) waiting.classList.remove("hidden");

    const chosen = round.options?.[myGuess.optionId];
    if (myGuessCard) {
      myGuessCard.innerHTML = `<small>اختيارك</small><strong>${escapeHTML(chosen?.text || "—")}</strong>`;
    }

    if (playersGrid) {
      playersGrid.innerHTML = playerList(room).map((player) => {
        const done = Boolean(round.guesses?.[player.id]?.optionId);
        return `
          <div class="guess-player-state ${done ? "done" : ""}">
            <div class="avatar-mini">${avatarHTML(player.avatar, "avatar-mini-img", `صورة ${player.name || "لاعب"}`)}</div>
            <strong>${escapeHTML(player.name || "لاعب")}</strong>
            <small>${done ? "✓" : "..."}</small>
          </div>
        `;
      }).join("");
    }
  } else {
    if (waiting) waiting.classList.add("hidden");
    if (optionsGrid) {
      optionsGrid.classList.remove("hidden");
      const visibleIds = (round.optionOrder || []).filter((id) => id !== myBluffId && round.options?.[id]);
      optionsGrid.innerHTML = visibleIds.map((id) => `
        <button type="button" class="guess-option" data-option-id="${escapeHTML(id)}">
          ${escapeHTML(round.options[id].text)}
        </button>
      `).join("");
      optionsGrid.querySelectorAll("[data-option-id]").forEach((button) => {
        button.addEventListener("click", () => submitGuess(button.dataset.optionId));
      });
    }

    if (ownBluffCard) {
      ownBluffCard.classList.toggle("hidden", !myBluff);
      ownBluffCard.innerHTML = myBluff ? `<div>كذبتك</div><strong>${escapeHTML(myBluff.text)}</strong>` : "";
    }
  }

  startTimer(room, round.guessDeadline, round.phase);
}

function renderReveal(room) {
  setPhaseVisibility("revealPhase");
  const round = room.round;
  const revealNoticeKey = `${round?.id || "round"}:reveal:${playerId || "player"}`;
  if (lastRevealNoticeKey !== revealNoticeKey) {
    lastRevealNoticeKey = revealNoticeKey;
    const myGuess = round?.guesses?.[playerId];
    const chosen = myGuess ? round?.options?.[myGuess.optionId] : null;
    if (!myGuess) {
      notify("لم تسجل اختيارًا قبل انتهاء الوقت.", { type: "warning", title: "انتهى الوقت" });
    } else if (chosen?.type === "correct") {
      notify("إجابتك صحيحة!", { type: "success", title: "أحسنت", duration: 3500 });
    } else {
      notify("اختيارك لم يكن الإجابة الصحيحة.", { type: "error", title: "إجابة غير صحيحة", duration: 3500 });
    }
  }
  const question = document.getElementById("revealQuestion");
  const grid = document.getElementById("revealOptions");
  const button = document.getElementById("revealReadyButton");
  const count = document.getElementById("revealReadyCount");
  const players = playersMap(room);
  const ids = playerList(room).map((player) => player.id);
  const readyCount = ids.filter((id) => round.revealReady?.[id] === true).length;
  const myReady = round.revealReady?.[playerId] === true;

  if (question) question.textContent = round.question || "";
  renderQuestionMedia("revealQuestionMedia", round);
  if (count) count.textContent = `${readyCount} / ${ids.length}`;
  if (button) {
    button.disabled = myReady;
    button.innerHTML = myReady
      ? '<i class="fa-solid fa-circle-check"></i> جاهز ✓'
      : '<i class="fa-solid fa-check"></i> جاهز';
  }

  if (grid) {
    grid.innerHTML = (round.optionOrder || []).map((id) => {
      const option = round.options?.[id];
      if (!option) return "";
      const author = option.authorId ? players[option.authorId] : null;
      const voters = ids
        .filter((pid) => round.guesses?.[pid]?.optionId === id)
        .map((pid) => players[pid])
        .filter(Boolean);
      const ownerText = option.type === "correct"
        ? "الإجابة الصح!"
        : option.type === "bluff"
          ? `إجابة: ${author?.id === playerId ? "أنت" : author?.name || "لاعب"}`
          : "إجابة إضافية";

      return `
        <div class="reveal-option ${option.type === "correct" ? "correct-option" : ""}">
          <div class="reveal-option-title">${escapeHTML(option.text)}</div>
          <div class="reveal-option-owner">${escapeHTML(ownerText)}</div>
          <div class="reveal-voters">
            ${voters.length
              ? voters.map((voter) => `<span class="reveal-voter">${avatarHTML(voter.avatar, "reveal-voter-avatar", `صورة ${voter.name || "لاعب"}`)} <span>${escapeHTML(voter.name || "لاعب")}</span></span>`).join("")
              : '<span class="reveal-voter">لم يخترها أحد</span>'}
          </div>
        </div>
      `;
    }).join("");
  }

  startTimer(room, round.revealDeadline, round.phase);
}

function theoreticalFinalMaxScore(room) {
  const totalRounds = Math.max(1, Number(room?.settings?.rounds) || Number(room?.round?.total) || 1);
  const gamePlayers = Math.max(2, Number(room?.gamePlayerCount) || playerList(room).length || 2);
  const maxPerRound = CORRECT_GUESS_POINTS + Math.max(0, gamePlayers - 1) * FOOLED_PLAYER_POINTS;
  return Math.max(1, totalRounds * maxPerRound);
}

function scoreWidthPercent(room, score) {
  return Math.max(0, Math.min(100, (Number(score) || 0) / theoreticalFinalMaxScore(room) * 100));
}

function renderRoundResults(room) {
  setPhaseVisibility("roundResultsPhase");
  const round = room.round;
  const label = document.getElementById("roundResultLabel");
  const board = document.getElementById("roundLeaderboard");
  if (label) label.textContent = `جولة ${round.number}/${round.total}`;

  const ranking = rankingFromPlayers(playersMap(room));
  if (board) {
    // لا نعيد بناء لوحة النتائج عند heartbeat أو أي snapshot لا يغيّر النتيجة.
    // هذا يمنع شريط النقاط من العودة إلى الصفر وإعادة الأنيميشن مرارًا على الجوال.
    const renderKey = JSON.stringify(ranking.map((entry) => {
      const player = playersMap(room)[entry.id];
      const result = round.results?.[entry.id] || {};
      return [
        entry.id, entry.rank, Number(entry.score) || 0,
        Number(player?.correctGuesses) || 0,
        Number(player?.fooledPlayers) || 0,
        Number(result.roundPoints) || 0,
        entry.avatar, entry.name, round.number, round.total,
      ];
    }));

    if (board.dataset.renderKey !== renderKey) {
      board.dataset.renderKey = renderKey;
      board.innerHTML = ranking.map((entry) => {
        const player = playersMap(room)[entry.id];
        const result = round.results?.[entry.id] || {};
        return `
          <div class="leaderboard-row rank-${entry.rank} ${entry.id === playerId ? "is-me" : ""}">
            <div class="leaderboard-rank">${entry.rank}</div>
            <div class="leaderboard-avatar">${avatarHTML(entry.avatar, "leaderboard-avatar-img", `صورة ${entry.name || "لاعب"}`)}</div>
            <div class="leaderboard-info">
              <strong>${escapeHTML(entry.name)}</strong>
              <small>أصاب ${Number(player?.correctGuesses) || 0} • خدع ${Number(player?.fooledPlayers) || 0}</small>
              <div class="score-progress" aria-hidden="true"><span style="--score-width:${scoreWidthPercent(room, entry.score).toFixed(2)}%"></span></div>
            </div>
            <div class="leaderboard-score">
              <strong class="round-gain">+${Number(result.roundPoints) || 0}</strong>
              <small>${entry.score} نقطة</small>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  startTimer(room, round.resultsDeadline, round.phase);
}

function activePlayerIds(room, now = Date.now()) {
  const ids = playerList(room)
    .filter((player) => {
      const lastSeen = valueToMillis(player.lastSeen);
      return !lastSeen || now - lastSeen <= ACTIVE_PLAYER_WINDOW_MS;
    })
    .map((player) => player.id);
  return ids.length ? ids : playerList(room).map((player) => player.id);
}


function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function setChatOpen(open) {
  const panel = document.getElementById("gameChatPanel");
  const button = document.getElementById("gameChatButton");
  panel?.classList.toggle("hidden", !open);
  button?.classList.toggle("chat-open", open);
  if (open) document.getElementById("gameChatInput")?.focus();
}

function showChatToast(message) {
  const container = document.getElementById("chatToastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "chat-toast";
  toast.innerHTML = `
    <div class="chat-toast-avatar">${avatarHTML(message.avatar, "chat-toast-avatar-img", `صورة ${message.name || "لاعب"}`)}</div>
    <div class="chat-toast-content">
      <strong>${escapeHTML(message.name || "لاعب")}</strong>
      <span>${escapeHTML(message.text || "")}</span>
    </div>
  `;
  container.appendChild(toast);
  while (container.children.length > 3) container.firstElementChild?.remove();
  const remove = () => {
    toast.classList.add("chat-toast-leaving");
    window.setTimeout(() => toast.remove(), 260);
  };
  window.setTimeout(remove, 8000);
}

function renderChatMessages(snapshot) {
  const list = document.getElementById("gameChatMessages");
  if (!list) return;
  const docs = [...snapshot.docs].reverse();
  list.innerHTML = docs.length ? docs.map((item) => {
    const message = item.data();
    const mine = message.authorId === playerId;
    return `<div class="chat-message ${mine ? "mine" : ""}">
      <div class="chat-message-head"><span>${avatarHTML(message.avatar, "chat-message-avatar-img", `صورة ${message.name || "لاعب"}`)}</span><strong>${escapeHTML(message.name || "لاعب")}</strong></div>
      <p>${escapeHTML(message.text || "")}</p>
    </div>`;
  }).join("") : '<div class="chat-empty">لا توجد رسائل بعد.</div>';
  list.scrollTop = list.scrollHeight;

  snapshot.docChanges().forEach((change) => {
    if (change.type !== "added") return;
    const id = change.doc.id;
    if (seenChatMessageIds.has(id)) return;
    seenChatMessageIds.add(id);
    const message = change.doc.data();
    const createdAt = valueToMillis(message.createdAt);
    if (createdAt && createdAt + 2500 < chatListenerStartedAt) return;
    showChatToast(message);
  });
}

function startChatListener() {
  if (!roomId || chatRoomId === roomId) return;
  if (unsubscribeChat) unsubscribeChat();
  chatRoomId = roomId;
  chatListenerStartedAt = Date.now();
  seenChatMessageIds = new Set();
  const messagesRef = collection(db, "rooms", roomId, "messages");
  const messagesQuery = query(messagesRef, orderBy("createdAt", "desc"), limit(50));
  unsubscribeChat = onSnapshot(messagesQuery, renderChatMessages, (error) => {
    console.error("Chat listener failed:", error);
  });
}

async function sendChatMessage() {
  if (!roomId || !playerId || !currentRoom || !playersMap(currentRoom)[playerId]) return;
  const input = document.getElementById("gameChatInput");
  const button = document.getElementById("gameChatSend");
  const counter = document.getElementById("chatWordCount");
  const text = String(input?.value || "").trim().replace(/\s+/g, " ");
  const words = countWords(text);
  if (!text) return;
  if (words > 10) {
    notify("الرسالة لا يمكن أن تتجاوز 10 كلمات.", { type: "warning" });
    return;
  }
  const me = playersMap(currentRoom)[playerId];
  if (button) button.disabled = true;
  try {
    await addDoc(collection(db, "rooms", roomId, "messages"), {
      authorId: playerId,
      name: String(me?.name || "لاعب").slice(0, 20),
      avatar: normalizeAvatarId(me?.avatar),
      text: text.slice(0, 140),
      createdAt: serverTimestamp(),
    });
    if (input) input.value = "";
    if (counter) counter.textContent = "0/10";
    // بعد الإرسال نغلق لوحة الدردشة، بينما يبقى الإشعار الصغير ظاهرًا للجميع.
    setChatOpen(false);
  } catch (error) {
    console.error("sendChatMessage failed:", error);
    notify("تعذر إرسال الرسالة.", { type: "error" });
  } finally {
    if (button) button.disabled = false;
  }
}

function bindChatControls() {
  const button = document.getElementById("gameChatButton");
  const close = document.getElementById("closeGameChat");
  const send = document.getElementById("gameChatSend");
  const input = document.getElementById("gameChatInput");
  if (button && !button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      const panel = document.getElementById("gameChatPanel");
      setChatOpen(panel?.classList.contains("hidden"));
    });
  }
  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", () => setChatOpen(false));
  }
  if (send && !send.dataset.bound) {
    send.dataset.bound = "1";
    send.addEventListener("click", sendChatMessage);
  }
  if (input && !input.dataset.bound) {
    input.dataset.bound = "1";
    input.addEventListener("input", () => {
      const counter = document.getElementById("chatWordCount");
      const words = countWords(input.value);
      if (counter) {
        counter.textContent = `${words}/10`;
        counter.classList.toggle("over-limit", words > 10);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    });
  }
}

function renderFinal(room) {
  setPhaseVisibility("finalResultsPhase");
  stopTimer();
  document.getElementById("timerRing")?.classList.add("hidden");
  const ranking = Array.isArray(room.finalResults) && room.finalResults.length
    ? room.finalResults
    : rankingFromPlayers(playersMap(room));
  const winner = ranking[0];
  const winnerCard = document.getElementById("winnerCard");
  const board = document.getElementById("finalLeaderboard");
  const status = document.getElementById("finalRequestsStatus");
  const replayButton = document.getElementById("playAgainButton");
  const returnButton = document.getElementById("returnToRoomButton");

  if (winnerCard) {
    winnerCard.innerHTML = winner
      ? `
        <div class="winner-avatar">${avatarHTML(winner.avatar, "winner-avatar-img", `صورة ${winner.name || "الفائز"}`)}</div>
        <h2>${escapeHTML(winner.name || "لاعب")}</h2>
        <p>الفائز</p>
        <strong>${Number(winner.score) || 0} نقطة</strong>
      `
      : "<h2>انتهت اللعبة</h2>";
  }

  if (board) {
    const renderKey = JSON.stringify(ranking.map((entry) => [
      entry.id, entry.rank, Number(entry.score) || 0,
      Number(entry.correctGuesses) || 0, Number(entry.fooledPlayers) || 0,
      entry.avatar, entry.name,
    ]));
    if (board.dataset.renderKey !== renderKey) {
      board.dataset.renderKey = renderKey;
      board.innerHTML = ranking.map((entry) => `
        <div class="leaderboard-row rank-${entry.rank} ${entry.id === playerId ? "is-me" : ""}">
          <div class="leaderboard-rank">${entry.rank}</div>
          <div class="leaderboard-avatar">${avatarHTML(entry.avatar, "leaderboard-avatar-img", `صورة ${entry.name || "لاعب"}`)}</div>
          <div class="leaderboard-info">
            <strong>${escapeHTML(entry.name || "لاعب")}</strong>
            <small>أصاب ${Number(entry.correctGuesses) || 0} • خدع ${Number(entry.fooledPlayers) || 0}</small>
            <div class="score-progress" aria-hidden="true"><span style="--score-width:${scoreWidthPercent(room, entry.score).toFixed(2)}%"></span></div>
          </div>
          <div class="leaderboard-score">
            <strong>${Number(entry.score) || 0}</strong>
            <small>نقطة</small>
          </div>
        </div>
      `).join("");
    }
  }

  const activeIds = activePlayerIds(room);
  const replayCount = activeIds.filter((id) => room.replayRequests?.[id] === true).length;
  const returnCount = activeIds.filter((id) => room.returnRequests?.[id] === true).length;
  if (status) status.textContent = `إعادة اللعب ${replayCount}/${activeIds.length} • العودة للغرفة ${returnCount}/${activeIds.length}`;

  const replayRequested = room.replayRequests?.[playerId] === true;
  const returnRequested = room.returnRequests?.[playerId] === true;
  if (replayButton) {
    replayButton.disabled = replayRequested;
    replayButton.innerHTML = replayRequested
      ? '<i class="fa-solid fa-circle-check"></i> تم طلب إعادة اللعب'
      : '<i class="fa-solid fa-rotate-right"></i> لعب مرة أخرى';
  }
  if (returnButton) {
    returnButton.disabled = returnRequested;
    returnButton.innerHTML = returnRequested
      ? '<i class="fa-solid fa-circle-check"></i> تم طلب العودة'
      : '<i class="fa-solid fa-door-open"></i> العودة إلى الغرفة';
  }
}

function renderRound(room) {
  const round = room.round;
  if (!round) return;
  setRoundLabel(room);
  showGameError(room.gameError || "");

  switch (round.phase) {
    case "category_selection":
      renderCategorySelection(room);
      break;
    case "bluffing":
      renderBluffing(room);
      break;
    case "guessing":
      renderGuessing(room);
      break;
    case "reveal":
      renderReveal(room);
      break;
    case "results":
      renderRoundResults(room);
      break;
    default:
      showGameError("حالة الجولة غير معروفة.");
  }
}

async function requestReplay() {
  if (!roomId || !playerId) return;
  try {
    await runTransaction(db, async (transaction) => {
      const roomRef = doc(db, "rooms", roomId);
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (room.status !== "finished" || !playersMap(room)[playerId]) return;
      transaction.update(roomRef, { [`replayRequests.${playerId}`]: true });
    });
  } catch (error) {
    console.error("requestReplay failed:", error);
  }
}

async function requestReturnToRoom() {
  if (!roomId || !playerId) return;
  try {
    await runTransaction(db, async (transaction) => {
      const roomRef = doc(db, "rooms", roomId);
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (room.status !== "finished" || !playersMap(room)[playerId]) return;
      transaction.update(roomRef, { [`returnRequests.${playerId}`]: true });
    });
  } catch (error) {
    console.error("requestReturnToRoom failed:", error);
  }
}

async function coordinateFinishedState(room) {
  if (!roomId || !playerId || room?.hostId !== playerId || room?.status !== "finished" || transitionInProgress) return;
  const ids = activePlayerIds(room);
  if (!ids.length) return;

  const everyoneReplay = ids.every((id) => room.replayRequests?.[id] === true);
  const everyoneReturn = ids.every((id) => room.returnRequests?.[id] === true);

  if (everyoneReplay) await startReplay();
  else if (everyoneReturn) await resetToLobby();
}

async function startReplay() {
  if (transitionInProgress) return;
  transitionInProgress = true;
  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (room.hostId !== playerId || room.status !== "finished") return;

      const resetPlayers = Object.fromEntries(Object.entries(playersMap(room)).map(([id, player]) => [id, {
        ...player,
        score: 0,
        correctGuesses: 0,
        fooledPlayers: 0,
      }]));

      transaction.update(roomRef, {
        status: "starting",
        players: resetPlayers,
        round: null,
        usedQuestionIds: [],
        usedFactKeys: [],
        finalResults: null,
        replayRequests: {},
        returnRequests: {},
        gameError: null,
        finishedAt: null,
        gamePlayerCount: playerList(room).length,
      });
    });
  } catch (error) {
    console.error("startReplay failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

async function resetToLobby() {
  if (transitionInProgress) return;
  transitionInProgress = true;
  try {
    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (room.hostId !== playerId || room.status !== "finished") return;

      const resetPlayers = Object.fromEntries(Object.entries(playersMap(room)).map(([id, player]) => [id, {
        ...player,
        ready: id === room.hostId,
        score: 0,
        correctGuesses: 0,
        fooledPlayers: 0,
      }]));

      transaction.update(roomRef, {
        status: "waiting",
        players: resetPlayers,
        round: null,
        usedQuestionIds: [],
        usedFactKeys: [],
        finalResults: null,
        replayRequests: {},
        returnRequests: {},
        gameError: null,
        finishedAt: null,
        gamePlayerCount: 0,
      });
    });
  } catch (error) {
    console.error("resetToLobby failed:", error);
  } finally {
    transitionInProgress = false;
  }
}

function listenToGameRoom() {
  if (!roomId) return;
  if (unsubscribeGameRoom) unsubscribeGameRoom();

  unsubscribeGameRoom = onSnapshot(
    doc(db, "rooms", roomId),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      if (!playersMap(room)[playerId]) return;

      currentRoom = room;

      if (room.status === "waiting") {
        stopTimer();
        showLoading(false);
        setPhaseVisibility(null);
        return;
      }

      showGameScreen();

      if (room.status === "starting") {
        setPhaseVisibility(null);
        showLoading(true, "جاري بدء اللعبة...", "يتم تحديد صاحب الدور الأول.");
        if (room.hostId === playerId) createFirstRound();
        return;
      }

      showLoading(false);

      if (room.status === "playing") {
        renderRound(room);
        if (room.hostId === playerId) coordinateHost(room);
        return;
      }

      if (room.status === "finished") {
        renderFinal(room);
        if (room.hostId === playerId) coordinateFinishedState(room);
      }
    },
    (error) => {
      console.error("game room listener failed:", error);
      showGameError("انقطع الاتصال بمزامنة اللعبة. سيحاول Firebase إعادة الاتصال تلقائيًا.");
    },
  );
}

export function initGameForRoom({ roomId: id, roomCode: code, playerId: pid }) {
  const changed = roomId !== id || playerId !== pid;
  roomId = id;
  roomCode = code;
  playerId = pid;

  if (changed) {
    stopTimer();
    transitionInProgress = false;
    currentRoom = null;
  }

  bindChatControls();
  startChatListener();
  listenToGameRoom();
}

export function stopGame() {
  stopTimer();
  if (unsubscribeChat) unsubscribeChat();
  unsubscribeChat = null;
  chatRoomId = null;
  chatListenerStartedAt = 0;
  seenChatMessageIds = new Set();
  setChatOpen(false);
  if (unsubscribeGameRoom) unsubscribeGameRoom();
  unsubscribeGameRoom = null;
  roomId = null;
  roomCode = null;
  playerId = null;
  currentRoom = null;
  transitionInProgress = false;
  showGameError("");
}

document.getElementById("confirmAnswer")?.addEventListener("click", submitBluff);
document.getElementById("gameAnswer")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitBluff();
  }
});
document.getElementById("revealReadyButton")?.addEventListener("click", markRevealReady);
document.getElementById("playAgainButton")?.addEventListener("click", requestReplay);
document.getElementById("returnToRoomButton")?.addEventListener("click", requestReturnToRoom);
document.getElementById("gameLeaveButton")?.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("taleela:leave-room"));
});

console.log("Taleela Game Engine v7.2 loaded");
