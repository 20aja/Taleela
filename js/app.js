import { db, ensureAuth } from "./firebase.js";
import { notify, confirmAction } from "./ui.js";

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
  GAME_CATEGORIES,
  categoryHasQuestions,
  initGameForRoom,
  stopGame,
} from "./game.js";

const ROOM_SCHEMA_VERSION = 5;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HOST_STALE_MS = 45_000;
const MIN_PLAYERS = 2;
const MAX_PLAYER_LIMIT = 8;
const MIN_CATEGORIES = 5;
const DEFAULT_AVATAR = "avatar-01";
const AVATAR_IDS = Array.from({ length: 20 }, (_, index) => `avatar-${String(index + 1).padStart(2, "0")}`);
const PROFILE_NAME_KEY = "taleela_profile_name";
const PROFILE_AVATAR_KEY = "taleela_profile_avatar";
const ACTIVE_SESSION_KEY = "taleela_active_room_v1";

let selectedAvatar = DEFAULT_AVATAR;
let currentRoomCode = null;
let currentPlayerId = null;
let currentRoomId = null;
let currentRoom = null;
let unsubscribeRoom = null;
let heartbeatInterval = null;
let isLeavingRoom = false;
let takeoverInProgress = false;
let authenticatedUser = null;
let membershipGraceUntil = 0;
let profileModalContext = "home";
let profileReservationRoom = null;
let resumeInProgress = false;
let bootstrapComplete = false;

const homeScreen = document.getElementById("homeScreen");
const roomScreen = document.getElementById("roomScreen");
const gameScreen = document.getElementById("gameScreen");
const nameInput = document.getElementById("playerName");
const avatarButtons = document.querySelectorAll("#profileAvatars .avatar");
const createRoomButton = document.getElementById("createRoom");
const joinRoomButton = document.getElementById("joinRoom");
const publicRoomsButton = document.getElementById("publicRoomsButton");
const publicRoomToggle = document.getElementById("publicRoomToggle");
const homeRoomCodeInput = document.getElementById("homeRoomCodeInput");
const roomCodeElement = document.getElementById("roomCode");
const copyRoomCodeButton = document.getElementById("copyRoomCode");
const leaveRoomButton = document.getElementById("leaveRoom");
const playersList = document.getElementById("playersList");
const playerCount = document.getElementById("playerCount");
const readyButton = document.getElementById("readyButton");
const startGameButton = document.getElementById("startGameButton");
const categoriesGrid = document.getElementById("categoriesGrid");
const selectedCategoriesCount = document.getElementById("selectedCategoriesCount");
const categoriesMessage = document.getElementById("categoriesMessage");
const settingsMessage = document.getElementById("settingsMessage");
const roomStatusElement = document.querySelector(".room-status");

const roundsMinus = document.getElementById("roundsMinus");
const roundsPlus = document.getElementById("roundsPlus");
const timerMinus = document.getElementById("timerMinus");
const timerPlus = document.getElementById("timerPlus");
const playersMinus = document.getElementById("playersMinus");
const playersPlus = document.getElementById("playersPlus");
const roundsValue = document.getElementById("roundsValue");
const timerValue = document.getElementById("timerValue");
const playersValue = document.getElementById("playersValue");

const joinModal = document.getElementById("joinModal");
const closeJoinModal = document.getElementById("closeJoinModal");
const roomCodeInput = document.getElementById("roomCodeInput");
const confirmJoin = document.getElementById("confirmJoin");

const publicRoomsModal = document.getElementById("publicRoomsModal");
const closePublicRoomsModal = document.getElementById("closePublicRoomsModal");
const publicRoomsList = document.getElementById("publicRoomsList");
const refreshPublicRooms = document.getElementById("refreshPublicRooms");

const editProfileButton = document.getElementById("editProfileButton");
const roomProfileButton = document.getElementById("roomProfileButton");
const profileModal = document.getElementById("profileModal");
const closeProfileModal = document.getElementById("closeProfileModal");
const profileNameInput = document.getElementById("profileNameInput");
const saveProfileButton = document.getElementById("saveProfileButton");
const profileMessage = document.getElementById("profileMessage");
const avatarReservationHint = document.getElementById("avatarReservationHint");
const homeProfileAvatar = document.getElementById("homeProfileAvatar");
const homeProfileName = document.getElementById("homeProfileName");

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function normalizeAvatarId(value) {
  const avatar = String(value || "");
  return AVATAR_IDS.includes(avatar) ? avatar : DEFAULT_AVATAR;
}

function avatarSrc(value) {
  return `assets/Users/${normalizeAvatarId(value)}.png`;
}

function avatarHTML(value, className = "avatar-image", alt = "صورة اللاعب") {
  return `<img class="${className}" src="${avatarSrc(value)}" alt="${escapeHTML(alt)}" draggable="false" />`;
}

function getTakenAvatars(room, exceptPlayerId = null) {
  return new Set(
    Object.values(playersMap(room))
      .filter((player) => player?.id && player.id !== exceptPlayerId)
      .map((player) => normalizeAvatarId(player.avatar)),
  );
}

function saveLocalProfile(name, avatar) {
  const cleanName = String(name || "").trim().slice(0, 20);
  const cleanAvatar = normalizeAvatarId(avatar);
  try {
    localStorage.setItem(PROFILE_NAME_KEY, cleanName);
    localStorage.setItem(PROFILE_AVATAR_KEY, cleanAvatar);
  } catch (error) {
    console.warn("Unable to save local profile:", error);
  }
  selectedAvatar = cleanAvatar;
  if (nameInput) nameInput.value = cleanName;
  updateHomeProfileSummary();
}

function loadLocalProfile() {
  let name = "";
  let avatar = DEFAULT_AVATAR;
  try {
    name = String(localStorage.getItem(PROFILE_NAME_KEY) || "").trim().slice(0, 20);
    avatar = normalizeAvatarId(localStorage.getItem(PROFILE_AVATAR_KEY));
  } catch {
    // Keep defaults when storage is blocked.
  }
  selectedAvatar = avatar;
  if (nameInput) nameInput.value = name;
  updateHomeProfileSummary();
}

function updateHomeProfileSummary() {
  const name = nameInput?.value?.trim() || "";
  if (homeProfileName) homeProfileName.textContent = name || "سجّل اسمك وصورتك";
  if (homeProfileAvatar) homeProfileAvatar.src = avatarSrc(selectedAvatar);
}

function setProfileMessage(message = "", type = "info") {
  if (!profileMessage) return;
  profileMessage.textContent = message;
  profileMessage.classList.toggle("hidden", !message);
  profileMessage.dataset.type = type;
}

function renderProfileAvatars(room = profileReservationRoom) {
  const exceptId = currentPlayerId && room && playersMap(room)[currentPlayerId] ? currentPlayerId : null;
  const taken = room ? getTakenAvatars(room, exceptId) : new Set();
  avatarButtons.forEach((button) => {
    const avatar = normalizeAvatarId(button.dataset.avatar);
    const isTaken = taken.has(avatar);
    const isActive = avatar === selectedAvatar;
    button.classList.toggle("active", isActive);
    button.classList.toggle("reserved", isTaken);
    button.disabled = isTaken;
    button.setAttribute("aria-disabled", String(isTaken));
    button.title = isTaken ? "هذه الصورة محجوزة من لاعب آخر" : `اختيار ${avatar}`;
    let badge = button.querySelector(".avatar-reserved-badge");
    if (isTaken && !badge) {
      badge = document.createElement("span");
      badge.className = "avatar-reserved-badge";
      badge.innerHTML = '<i class="fa-solid fa-lock"></i><small>محجوزة</small>';
      button.appendChild(badge);
    } else if (!isTaken && badge) {
      badge.remove();
    }
  });
  if (avatarReservationHint) {
    avatarReservationHint.textContent = room
      ? "الصور التي اختارها لاعبو الغرفة تظهر مقفلة ومحجوزة فورًا."
      : "اختر أي صورة؛ داخل الغرفة لا يمكن للاعبين استخدام الصورة نفسها.";
  }
}

function openProfileEditor(context = "home", room = currentRoom) {
  if (!profileModal) return;
  if (context === "room" && room?.status !== "waiting") {
    notify("يمكن تعديل الاسم والصورة من غرفة الانتظار فقط.", { type: "warning" });
    return;
  }
  profileModalContext = context;
  profileReservationRoom = room || null;
  const roomPlayer = context === "room" && currentPlayerId ? playersMap(room)[currentPlayerId] : null;
  if (roomPlayer) {
    selectedAvatar = normalizeAvatarId(roomPlayer.avatar);
    if (profileNameInput) profileNameInput.value = roomPlayer.name || "";
  } else if (profileNameInput) {
    profileNameInput.value = nameInput?.value || "";
  }
  setProfileMessage();
  renderProfileAvatars(room || null);
  profileModal.classList.remove("hidden");
  setTimeout(() => profileNameInput?.focus(), 80);
}

function closeProfileEditor() {
  profileModal?.classList.add("hidden");
  profileReservationRoom = null;
  setProfileMessage();
}

function requireRegisteredProfile() {
  if (nameInput?.value?.trim() && AVATAR_IDS.includes(selectedAvatar)) return true;
  openProfileEditor("home", null);
  setProfileMessage("سجّل اسمك واختر صورتك أولًا.", "warning");
  return false;
}

function playersMap(room) {
  const raw = room?.players;
  if (raw && !Array.isArray(raw) && typeof raw === "object") return raw;
  return {};
}

function playerList(room) {
  return Object.values(playersMap(room)).filter((player) => player?.id);
}

function isLegacyRoom(room) {
  return Array.isArray(room?.players) || Number(room?.schemaVersion || 1) < ROOM_SCHEMA_VERSION;
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

function generateRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
}

function getCurrentPlayer(room) {
  return currentPlayerId ? playersMap(room)[currentPlayerId] || null : null;
}

function isCurrentPlayerHost(room) {
  return Boolean(currentPlayerId && room?.hostId === currentPlayerId);
}

function roomMaxPlayers(room) {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYER_LIMIT, Number(room?.settings?.maxPlayers) || 4));
}

function normalizeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function showHomeScreen() {
  homeScreen?.classList.remove("hidden");
  roomScreen?.classList.add("hidden");
  gameScreen?.classList.add("hidden");
}

function showRoomScreen(code) {
  homeScreen?.classList.add("hidden");
  gameScreen?.classList.add("hidden");
  roomScreen?.classList.remove("hidden");
  if (roomCodeElement) roomCodeElement.textContent = code || "------";
}

function showGameScreen() {
  homeScreen?.classList.add("hidden");
  roomScreen?.classList.add("hidden");
  gameScreen?.classList.remove("hidden");
}

function removeRoomError() {
  document.getElementById("roomError")?.remove();
}

function showRoomError(message) {
  let errorBox = document.getElementById("roomError");
  if (!errorBox) {
    errorBox = document.createElement("div");
    errorBox.id = "roomError";
    errorBox.className = "room-error";
    roomScreen?.prepend(errorBox);
  }
  errorBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${escapeHTML(message)}</span>`;
}

function setRoomStatus(room) {
  if (!roomStatusElement) return;
  const statusText = {
    waiting: room?.isPublic ? "غرفة عامة — بانتظار اللاعبين" : "بانتظار اللاعبين",
    starting: "جاري بدء اللعبة",
    playing: "المباراة جارية",
    finished: "انتهت المباراة",
  };
  roomStatusElement.textContent = statusText[room?.status] || "متصل بالغرفة";
}

function renderPlayers(room) {
  if (!playersList) return;
  const players = playerList(room).sort(
    (a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)),
  );
  const maxPlayers = roomMaxPlayers(room);

  playersList.innerHTML = "";
  if (playerCount) playerCount.textContent = `${players.length} / ${maxPlayers}`;

  if (!players.length) {
    playersList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users"></i><p>لا يوجد لاعبون في الغرفة.</p></div>';
    return;
  }

  players.forEach((player) => {
    const card = document.createElement("div");
    card.className = `player-card ${player.id === currentPlayerId ? "is-me" : ""}`;
    const isHost = player.id === room.hostId;
    const ready = player.ready === true;

    card.innerHTML = `
      <div class="player-avatar">${avatarHTML(player.avatar, "player-avatar-img", `صورة ${player.name || "لاعب"}`)}</div>
      <div class="player-info">
        <div class="player-name">${escapeHTML(player.name || "لاعب")}${player.id === currentPlayerId ? ' <span class="you-label">أنت</span>' : ""}</div>
        ${isHost ? '<div class="player-host"><i class="fa-solid fa-crown"></i> المضيف</div>' : ""}
      </div>
      <span class="${ready ? "player-ready" : "player-waiting"}">
        ${ready ? '<i class="fa-solid fa-check"></i> جاهز' : "في الانتظار"}
      </span>
      ${room.hostId === currentPlayerId && player.id !== currentPlayerId && room.status === "waiting" ? `
        <button class="remove-player-button" type="button" data-remove-player="${escapeHTML(player.id)}" title="إزالة ${escapeHTML(player.name || "اللاعب")}" aria-label="إزالة ${escapeHTML(player.name || "اللاعب")}">
          <i class="fa-solid fa-user-minus"></i>
        </button>
      ` : ""}
    `;
    const removeButton = card.querySelector("[data-remove-player]");
    removeButton?.addEventListener("click", () => removePlayerFromRoom(player.id));
    playersList.appendChild(card);
  });
}

function renderSettings(room) {
  const settings = room?.settings || {};
  const canEdit = isCurrentPlayerHost(room) && room?.status === "waiting";
  const rounds = Math.max(3, Math.min(12, Number(settings.rounds) || 6));
  const answerTime = Math.max(10, Math.min(60, Number(settings.answerTime) || 15));
  const maxPlayers = roomMaxPlayers(room);

  if (roundsValue) roundsValue.textContent = String(rounds);
  if (timerValue) timerValue.textContent = String(answerTime);
  if (playersValue) playersValue.textContent = String(maxPlayers);

  [roundsMinus, roundsPlus, timerMinus, timerPlus, playersMinus, playersPlus].forEach((button) => {
    if (button) button.disabled = !canEdit;
  });

  if (settingsMessage) {
    settingsMessage.classList.toggle("hidden", canEdit);
    if (!canEdit) settingsMessage.textContent = room?.status === "waiting" ? "المضيف فقط يستطيع تعديل الإعدادات." : "لا يمكن تعديل الإعدادات أثناء المباراة.";
  }
}

function renderCategories(room) {
  if (!categoriesGrid) return;
  const selected = Array.isArray(room?.categories) ? room.categories : [];
  const canEdit = isCurrentPlayerHost(room) && room?.status === "waiting";
  categoriesGrid.innerHTML = "";

  GAME_CATEGORIES.forEach((category) => {
    const card = document.createElement("button");
    card.type = "button";
    const isSelected = selected.includes(category.id);
    card.className = "category-card";
    card.setAttribute("aria-pressed", String(isSelected));
    if (isSelected) card.classList.add("selected");
    if (!canEdit) card.classList.add("disabled");
    if (!categoryHasQuestions(category.id)) card.classList.add("unavailable");
    
    card.innerHTML = `
      <div class="category-icon"><i class="${category.icon}"></i></div>
      <div class="category-name">${escapeHTML(category.name)}</div>
      <div class="category-check"><i class="fa-solid fa-check"></i></div>
    `;

    if (canEdit && categoryHasQuestions(category.id)) {
      card.addEventListener("click", () => toggleCategory(category.id));
    }

    categoriesGrid.appendChild(card);
  });

  if (selectedCategoriesCount) selectedCategoriesCount.textContent = `${selected.length} / ${GAME_CATEGORIES.filter((item) => categoryHasQuestions(item.id)).length}`;
  if (categoriesMessage) {
    categoriesMessage.classList.toggle("hidden", canEdit);
    if (!canEdit) categoriesMessage.textContent = room?.status === "waiting" ? "المضيف فقط يستطيع تغيير الفئات." : "لا يمكن تغيير الفئات أثناء المباراة.";
  }
}

function canStartGame(room) {
  if (!room || room.status !== "waiting") return false;
  const players = playerList(room);
  const validCategories = Array.isArray(room.categories) ? room.categories.filter(categoryHasQuestions) : [];
  return players.length >= MIN_PLAYERS
    && players.length <= roomMaxPlayers(room)
    && players.every((player) => player.ready === true)
    && validCategories.length >= MIN_CATEGORIES;
}

function updateReadyButton(room) {
  if (!readyButton) return;
  const player = getCurrentPlayer(room);
  if (!player) {
    readyButton.disabled = true;
    return;
  }

  readyButton.disabled = room.status !== "waiting";
  readyButton.classList.toggle("ready-active", player.ready === true);
  readyButton.innerHTML = player.ready
    ? '<i class="fa-solid fa-circle-check"></i> جاهز ✓'
    : '<i class="fa-solid fa-check"></i> جاهز';
}

function updateStartButton(room) {
  if (!startGameButton) return;
  if (!isCurrentPlayerHost(room)) {
    startGameButton.classList.add("hidden");
    return;
  }

  startGameButton.classList.remove("hidden");
  const players = playerList(room);
  const selected = Array.isArray(room.categories) ? room.categories.filter(categoryHasQuestions) : [];
  const enoughPlayers = players.length >= MIN_PLAYERS;
  const everyoneReady = players.length > 0 && players.every((player) => player.ready === true);
  const categoriesReady = selected.length >= MIN_CATEGORIES;
  const canStart = canStartGame(room);

  startGameButton.disabled = !canStart;
  if (room.status !== "waiting") {
    startGameButton.innerHTML = '<i class="fa-solid fa-gamepad"></i> اللعبة جارية';
  } else if (!categoriesReady) {
    startGameButton.innerHTML = `<i class="fa-solid fa-layer-group"></i> اختر 5 فئات على الأقل (${selected.length}/5)`;
  } else if (!enoughPlayers) {
    startGameButton.innerHTML = '<i class="fa-solid fa-users"></i> نحتاج لاعبين على الأقل';
  } else if (!everyoneReady) {
    startGameButton.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> في انتظار الجاهزية';
  } else {
    startGameButton.innerHTML = '<i class="fa-solid fa-play"></i> بدء اللعبة';
  }
}

function saveSession() {
  if (!currentRoomId || !currentRoomCode || !currentPlayerId) return;
  const payload = {
    roomId: currentRoomId,
    roomCode: currentRoomCode,
    playerId: currentPlayerId,
    savedAt: Date.now(),
  };
  try {
    // localStorage is intentional: sessionStorage can disappear when an
    // installed PWA is suspended/killed by the mobile OS. The active room is
    // cleared only on explicit leave, kick, deleted room, or invalid identity.
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
    // Keep legacy keys for a seamless migration from older versions.
    sessionStorage.setItem("taleela_room_id", currentRoomId);
    sessionStorage.setItem("taleela_room_code", currentRoomCode);
    sessionStorage.setItem("taleela_player_id", currentPlayerId);
  } catch (error) {
    console.warn("Unable to save active room session:", error);
  }
}

function readSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.roomId && parsed?.roomCode && parsed?.playerId) return parsed;
    }

    // One-time migration from v7.2.x sessionStorage.
    const roomId = sessionStorage.getItem("taleela_room_id");
    const roomCode = sessionStorage.getItem("taleela_room_code");
    const playerId = sessionStorage.getItem("taleela_player_id");
    if (!roomId || !roomCode || !playerId) return null;
    const migrated = { roomId, roomCode, playerId, savedAt: Date.now() };
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(migrated));
    return migrated;
  } catch (error) {
    console.warn("Unable to read active room session:", error);
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    sessionStorage.removeItem("taleela_room_id");
    sessionStorage.removeItem("taleela_room_code");
    sessionStorage.removeItem("taleela_player_id");
  } catch {
    // Ignore storage errors.
  }
}

function stopRoomListener() {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = null;
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

async function sendHeartbeat() {
  if (!currentRoomId || !currentPlayerId || isLeavingRoom) return;
  try {
    await updateDoc(doc(db, "rooms", currentRoomId), {
      [`players.${currentPlayerId}.lastSeen`]: serverTimestamp(),
    });
  } catch (error) {
    console.warn("heartbeat failed:", error);
  }
}

function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function isHostStale(room) {
  const map = playersMap(room);
  const host = map[room?.hostId];
  if (!host) return true;
  const lastSeen = valueToMillis(host.lastSeen);
  return lastSeen > 0 && Date.now() - lastSeen > HOST_STALE_MS;
}

function chooseTakeoverCandidate(room) {
  return playerList(room)
    .sort((a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

async function attemptHostTakeover(room) {
  if (!currentRoomId || !currentPlayerId || takeoverInProgress || !isHostStale(room)) return;
  const candidate = chooseTakeoverCandidate(room);
  if (!candidate || candidate.id !== currentPlayerId) return;

  takeoverInProgress = true;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const latest = snapshot.data();
      if (!playersMap(latest)[currentPlayerId] || latest.hostId === currentPlayerId || !isHostStale(latest)) return;
      transaction.update(roomRef, { hostId: currentPlayerId });
    });
  } catch (error) {
    console.warn("host takeover failed:", error);
  } finally {
    takeoverInProgress = false;
  }
}

function listenToRoom(id) {
  stopRoomListener();
  const roomRef = doc(db, "rooms", id);

  unsubscribeRoom = onSnapshot(
    roomRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        if (!isLeavingRoom) {
          notify("الغرفة لم تعد موجودة.", { type: "warning", title: "تم إغلاق الغرفة" });
          resetApplicationToHome();
        }
        return;
      }

      const room = snapshot.data();
      if (isLegacyRoom(room)) {
        showRoomError("هذه الغرفة أُنشئت بإصدار قديم. أنشئ غرفة جديدة باستخدام النسخة الحالية.");
        return;
      }

      if (!playersMap(room)[currentPlayerId]) {
        // Firestore can briefly deliver a cached pre-join snapshot when the
        // document listener starts. During the short join grace period we
        // ignore that stale snapshot instead of ejecting the player.
        if (Date.now() < membershipGraceUntil) {
          console.debug("Ignoring stale pre-join room snapshot.");
          return;
        }
        if (!isLeavingRoom) {
          notify("لم تعد عضوًا في هذه الغرفة. قد يكون المضيف قد أزالك.", { type: "warning", title: "تمت مغادرة الغرفة" });
          resetApplicationToHome();
        }
        return;
      }

      membershipGraceUntil = 0;

      currentRoom = room;
      currentRoomCode = room.code || currentRoomCode;
      saveSession();
      removeRoomError();
      setRoomStatus(room);
      renderPlayers(room);
      renderSettings(room);
      renderCategories(room);
      if (profileModal && !profileModal.classList.contains("hidden")) {
        profileReservationRoom = room;
        renderProfileAvatars(room);
      }
      updateReadyButton(room);
      updateStartButton(room);

      if (room.gameError) showRoomError(room.gameError);

      if (["starting", "playing", "finished"].includes(room.status)) {
        showGameScreen();
      } else {
        showRoomScreen(currentRoomCode);
      }

      if (room.hostId !== currentPlayerId && isHostStale(room)) {
        attemptHostTakeover(room);
      }
    },
    (error) => {
      console.error("Room listener failed:", error);
      showRoomError("انقطع الاتصال بالغرفة. سيتم الاستمرار في محاولة الاتصال تلقائيًا.");
    },
  );
}

async function toggleCategory(categoryId) {
  if (!currentRoomId || !currentPlayerId) return;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (room.status !== "waiting") return;

      const categories = new Set(Array.isArray(room.categories) ? room.categories : []);
      if (categories.has(categoryId)) {
        categories.delete(categoryId);
      } else {
        categories.add(categoryId);
      }

      transaction.update(roomRef, { categories: [...categories], gameError: null });
    });
  } catch (error) {
    console.error("toggleCategory failed:", error);
    const messages = {
      HOST_ONLY: "فقط المضيف يستطيع اختيار الفئات.",
    };
    notify(messages[error?.message] || "تعذر حفظ الفئات.", { type: "error" });
  }
}

async function adjustSetting(key, delta) {
  if (!currentRoomId || !currentPlayerId) return;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (room.status !== "waiting") return;

      const current = room.settings || {};
      const updates = {};

      if (key === "rounds") {
        updates["settings.rounds"] = Math.max(3, Math.min(12, (Number(current.rounds) || 6) + delta));
      } else if (key === "answerTime") {
        updates["settings.answerTime"] = Math.max(10, Math.min(60, (Number(current.answerTime) || 15) + delta * 5));
      } else if (key === "maxPlayers") {
        const count = playerList(room).length;
        const next = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYER_LIMIT, (Number(current.maxPlayers) || 4) + delta));
        if (next < count) throw new Error("PLAYERS_PRESENT");
        updates["settings.maxPlayers"] = next;
      }

      transaction.update(roomRef, updates);
    });
  } catch (error) {
    console.error("adjustSetting failed:", error);
    if (error?.message === "PLAYERS_PRESENT") notify("لا يمكن جعل الحد الأقصى أقل من عدد اللاعبين الموجودين حاليًا.", { type: "warning" });
  }
}

async function createRoom() {
  const name = nameInput?.value?.trim();
  if (!requireRegisteredProfile()) return;

  createRoomButton.disabled = true;
  createRoomButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء الغرفة...';

  try {
    authenticatedUser = authenticatedUser || (await ensureAuth());
    const playerId = authenticatedUser.uid;

    let roomCode = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateRoomCode();
      const existing = await getDocs(query(collection(db, "rooms"), where("code", "==", candidate)));
      if (existing.empty) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) throw new Error("CODE_GENERATION_FAILED");

    const now = Timestamp.now();
    const roomRef = await addDoc(collection(db, "rooms"), {
      schemaVersion: ROOM_SCHEMA_VERSION,
      code: roomCode,
      hostId: playerId,
      status: "waiting",
      isPublic: publicRoomToggle?.checked === true,
      createdAt: now,
      settings: {
        rounds: 6,
        answerTime: 15,
        selectionTime: 20,
        revealTime: 20,
        resultsTime: 5,
        maxPlayers: 4,
      },
      categories: [],
      usedQuestionIds: [],
      usedFactKeys: [],
      round: null,
      finalResults: null,
      replayRequests: {},
      returnRequests: {},
      gameError: null,
      finishedAt: null,
      gamePlayerCount: 0,
      players: {
        [playerId]: {
          id: playerId,
          name: name.slice(0, 20),
          avatar: selectedAvatar,
          ready: true,
          score: 0,
          correctGuesses: 0,
          fooledPlayers: 0,
          joinedAt: now,
          lastSeen: now,
        },
      },
    });

    currentRoomCode = roomCode;
    currentPlayerId = playerId;
    currentRoomId = roomRef.id;
    saveSession();
    showRoomScreen(roomCode);
    listenToRoom(roomRef.id);
    startHeartbeat();
    initGameForRoom({ roomId: roomRef.id, roomCode, playerId });
  } catch (error) {
    console.error("createRoom failed:", error);
    notify(`تعذر إنشاء الغرفة. ${error.message || "خطأ غير معروف"}`, { type: "error", title: "تعذر إنشاء الغرفة", duration: 6000 });
  } finally {
    createRoomButton.disabled = false;
    createRoomButton.innerHTML = '<i class="fa-solid fa-plus"></i> إنشاء غرفة';
  }
}

async function joinRoom(codeOverride = null) {
  const name = nameInput?.value?.trim();
  const rawCode = codeOverride || homeRoomCodeInput?.value || roomCodeInput?.value || "";
  const code = normalizeCode(rawCode);

  if (!requireRegisteredProfile()) return;
  if (code.length !== 6) {
    notify("رمز الغرفة يجب أن يتكون من 6 أحرف وأرقام.", { type: "warning" });
    return;
  }

  if (confirmJoin) confirmJoin.disabled = true;
  if (joinRoomButton) joinRoomButton.disabled = true;
  let joinRoomPreview = null;

  try {
    authenticatedUser = authenticatedUser || (await ensureAuth());
    const playerId = authenticatedUser.uid;
    const result = await getDocs(query(collection(db, "rooms"), where("code", "==", code)));
    if (result.empty) throw new Error("ROOM_NOT_FOUND");

    const roomDoc = result.docs[0];
    joinRoomPreview = roomDoc.data();
    const roomRef = doc(db, "rooms", roomDoc.id);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      if (isLegacyRoom(room)) throw new Error("LEGACY_ROOM");
      if (room.status !== "waiting") throw new Error("GAME_STARTED");

      const map = playersMap(room);
      if (map[playerId]) return;
      if (Object.keys(map).length >= roomMaxPlayers(room)) throw new Error("ROOM_FULL");
      if (Object.values(map).some((player) => normalizeAvatarId(player.avatar) === selectedAvatar)) {
        throw new Error("AVATAR_TAKEN");
      }

      const now = Timestamp.now();
      transaction.update(roomRef, {
        [`players.${playerId}`]: {
          id: playerId,
          name: name.slice(0, 20),
          avatar: selectedAvatar,
          ready: false,
          score: 0,
          correctGuesses: 0,
          fooledPlayers: 0,
          joinedAt: now,
          lastSeen: now,
        },
      });
    });

    // Confirm the committed membership from the server before subscribing.
    // This prevents the first listener callback from seeing the cached room
    // state that existed before this player was added.
    const confirmedSnapshot = await getDocFromServer(roomRef);
    if (!confirmedSnapshot.exists() || !playersMap(confirmedSnapshot.data())[playerId]) {
      throw new Error("JOIN_NOT_CONFIRMED");
    }

    currentRoomCode = code;
    currentPlayerId = playerId;
    currentRoomId = roomDoc.id;
    currentRoom = confirmedSnapshot.data();
    membershipGraceUntil = Date.now() + 6_000;
    saveSession();
    joinModal?.classList.add("hidden");
    publicRoomsModal?.classList.add("hidden");
    if (roomCodeInput) roomCodeInput.value = "";
    if (homeRoomCodeInput) homeRoomCodeInput.value = "";
    showRoomScreen(code);
    listenToRoom(roomDoc.id);
    startHeartbeat();
    initGameForRoom({ roomId: roomDoc.id, roomCode: code, playerId });
  } catch (error) {
    console.error("joinRoom failed:", error);
    const messages = {
      ROOM_NOT_FOUND: "لم يتم العثور على غرفة بهذا الرمز.",
      LEGACY_ROOM: "هذه الغرفة من إصدار قديم. أنشئ غرفة جديدة بعد تحديث جميع الأجهزة.",
      GAME_STARTED: "بدأت هذه الغرفة اللعب بالفعل.",
      ROOM_FULL: "الغرفة ممتلئة.",
      AVATAR_TAKEN: "الصورة التي اخترتها محجوزة من لاعب آخر. اختر صورة مختلفة.",
      JOIN_NOT_CONFIRMED: "تعذر تأكيد انضمامك إلى الغرفة. حاول مرة أخرى.",
    };
    notify(messages[error?.message] || "تعذر الانضمام إلى الغرفة.", { type: "error" });
    if (error?.message === "AVATAR_TAKEN") {
      openProfileEditor("home", joinRoomPreview);
      setProfileMessage("هذه الصورة محجوزة في الغرفة. اختر صورة غير محجوزة ثم اضغط تسجيل.", "warning");
    }
  } finally {
    if (confirmJoin) confirmJoin.disabled = false;
    if (joinRoomButton) joinRoomButton.disabled = false;
  }
}

async function loadPublicRooms() {
  if (!publicRoomsList) return;
  publicRoomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>جاري تحميل الغرف...</p></div>';

  try {
    authenticatedUser = authenticatedUser || (await ensureAuth());
    const result = await getDocs(query(collection(db, "rooms"), where("isPublic", "==", true)));
    const rooms = result.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((room) => !isLegacyRoom(room) && room.status === "waiting" && playerList(room).length < roomMaxPlayers(room))
      .sort((a, b) => valueToMillis(b.createdAt) - valueToMillis(a.createdAt))
      .slice(0, 20);

    if (!rooms.length) {
      publicRoomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-door-closed"></i><p>لا توجد غرف عامة متاحة الآن.</p></div>';
      return;
    }

    publicRoomsList.innerHTML = rooms.map((room) => {
      const host = playersMap(room)[room.hostId];
      const count = playerList(room).length;
      return `
        <div class="public-room-item">
          <div class="public-room-info">
            <strong>${avatarHTML(host?.avatar, "public-room-avatar-img", `صورة ${host?.name || "لاعب"}`)} <span>غرفة ${escapeHTML(host?.name || "لاعب")}</span></strong>
            <small>${count}/${roomMaxPlayers(room)} لاعبين • ${escapeHTML(room.code || "------")}</small>
          </div>
          <button type="button" data-public-code="${escapeHTML(room.code || "")}">انضم</button>
        </div>
      `;
    }).join("");

    publicRoomsList.querySelectorAll("[data-public-code]").forEach((button) => {
      button.addEventListener("click", () => joinRoom(button.dataset.publicCode));
    });
  } catch (error) {
    console.error("loadPublicRooms failed:", error);
    publicRoomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>تعذر تحميل الغرف العامة.</p></div>';
  }
}

async function removePlayerFromRoom(targetPlayerId) {
  if (!currentRoomId || !currentPlayerId || !targetPlayerId || targetPlayerId === currentPlayerId) return;
  const target = playersMap(currentRoom)[targetPlayerId];
  if (!target) return;

  const confirmed = await confirmAction({
    title: "إزالة لاعب",
    message: `هل تريد إزالة ${target.name || "هذا اللاعب"} من الغرفة؟`,
    confirmText: "إزالة",
    cancelText: "إلغاء",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (room.status !== "waiting") throw new Error("WAITING_ONLY");
      if (targetPlayerId === room.hostId) throw new Error("CANNOT_REMOVE_HOST");

      const updatedPlayers = { ...playersMap(room) };
      if (!updatedPlayers[targetPlayerId]) return;
      delete updatedPlayers[targetPlayerId];

      const replayRequests = { ...(room.replayRequests || {}) };
      const returnRequests = { ...(room.returnRequests || {}) };
      delete replayRequests[targetPlayerId];
      delete returnRequests[targetPlayerId];

      transaction.update(roomRef, {
        players: updatedPlayers,
        replayRequests,
        returnRequests,
      });
    });
    notify(`تمت إزالة ${target.name || "اللاعب"} من الغرفة.`, { type: "success" });
  } catch (error) {
    console.error("removePlayerFromRoom failed:", error);
    const messages = {
      HOST_ONLY: "فقط المضيف يستطيع إزالة اللاعبين.",
      WAITING_ONLY: "يمكن إزالة اللاعبين من غرفة الانتظار فقط.",
      CANNOT_REMOVE_HOST: "لا يمكن للمضيف إزالة نفسه بهذه الطريقة.",
      ROOM_NOT_FOUND: "الغرفة لم تعد موجودة.",
    };
    notify(messages[error?.message] || "تعذر إزالة اللاعب.", { type: "error" });
  }
}

async function toggleReady() {
  if (!currentRoomId || !currentPlayerId) return;
  readyButton.disabled = true;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      const player = playersMap(room)[currentPlayerId];
      if (!player) throw new Error("PLAYER_NOT_FOUND");
      if (room.status !== "waiting") return;
      transaction.update(roomRef, { [`players.${currentPlayerId}.ready`]: player.ready !== true });
    });
  } catch (error) {
    console.error("toggleReady failed:", error);
    notify("تعذر تغيير حالة الجاهزية.", { type: "error" });
  } finally {
    readyButton.disabled = false;
  }
}

async function startGame() {
  if (!currentRoomId || !currentPlayerId) return;
  startGameButton.disabled = true;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = snapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (!canStartGame(room)) throw new Error("NOT_READY");

      const resetPlayers = Object.fromEntries(
        Object.entries(playersMap(room)).map(([id, player]) => [id, {
          ...player,
          score: 0,
          correctGuesses: 0,
          fooledPlayers: 0,
        }]),
      );

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
    console.error("startGame failed:", error);
    const message = error?.message === "HOST_ONLY"
      ? "فقط المضيف يستطيع بدء اللعبة."
      : error?.message === "NOT_READY"
        ? "اختر 5 فئات على الأقل، وتأكد من وجود لاعبين على الأقل وجاهزية الجميع."
        : "تعذر بدء اللعبة.";
    notify(message, { type: "warning" });
  } finally {
    startGameButton.disabled = false;
  }
}

async function leaveRoom() {
  if (!currentRoomId || !currentPlayerId) return;
  if (!(await confirmAction({ title: "مغادرة الغرفة", message: "هل تريد مغادرة الغرفة؟", confirmText: "مغادرة", cancelText: "البقاء", danger: true }))) return;

  isLeavingRoom = true;
  if (leaveRoomButton) leaveRoomButton.disabled = true;

  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) return;
      const room = snapshot.data();
      const map = playersMap(room);
      if (!map[currentPlayerId]) return;

      const ids = Object.keys(map);
      if (ids.length === 1) {
        transaction.delete(roomRef);
        return;
      }

      const updated = { ...map };
      delete updated[currentPlayerId];

      if (room.hostId === currentPlayerId) {
        const nextHost = Object.values(updated)
          .sort((a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)))[0];
        transaction.update(roomRef, { players: updated, hostId: nextHost.id });
      } else {
        transaction.update(roomRef, { players: updated });
      }
    });
  } catch (error) {
    console.error("leaveRoom failed:", error);
  } finally {
    resetApplicationToHome();
  }
}

function resetApplicationToHome() {
  stopRoomListener();
  stopHeartbeat();
  stopGame();
  clearSession();
  currentRoomCode = null;
  currentPlayerId = null;
  currentRoomId = null;
  currentRoom = null;
  membershipGraceUntil = 0;
  isLeavingRoom = false;
  takeoverInProgress = false;
  if (leaveRoomButton) leaveRoomButton.disabled = false;
  removeRoomError();
  showHomeScreen();
}

function showRestoringSession() {
  homeScreen?.classList.add("hidden");
  roomScreen?.classList.add("hidden");
  gameScreen?.classList.remove("hidden");
  const loading = document.getElementById("gameLoading");
  loading?.classList.remove("hidden");
  const title = loading?.querySelector("h2");
  const text = loading?.querySelector("p");
  if (title) title.textContent = "جاري استعادة جلستك...";
  if (text) text.textContent = "سيتم إعادتك إلى نفس الغرفة والجولة تلقائيًا.";
}

async function resumeActiveSession() {
  if (!bootstrapComplete || resumeInProgress || isLeavingRoom || document.visibilityState === "hidden") return;
  if (currentRoomId && currentPlayerId) {
    await sendHeartbeat();
    return;
  }
  if (!readSession()) return;

  resumeInProgress = true;
  try {
    authenticatedUser = authenticatedUser || (await ensureAuth());
    await recoverRoom();
  } catch (error) {
    console.warn("Session resume deferred:", error);
    // Keep the persistent session. A temporary network failure must not eject
    // the player; the online/visibility handlers will retry.
    showRestoringSession();
  } finally {
    resumeInProgress = false;
  }
}

async function recoverRoom() {
  const session = readSession();
  if (!session) return false;

  authenticatedUser = authenticatedUser || (await ensureAuth());
  if (session.playerId !== authenticatedUser.uid) {
    clearSession();
    return false;
  }

  const roomRef = doc(db, "rooms", session.roomId);
  const snapshot = await getDoc(roomRef);
  if (!snapshot.exists()) {
    clearSession();
    return false;
  }

  const room = snapshot.data();
  if (isLegacyRoom(room) || !playersMap(room)[authenticatedUser.uid]) {
    clearSession();
    return false;
  }

  currentRoomId = session.roomId;
  currentRoomCode = room.code || session.roomCode;
  currentPlayerId = authenticatedUser.uid;
  currentRoom = room;
  const recoveredPlayer = playersMap(room)[authenticatedUser.uid];
  if (recoveredPlayer) saveLocalProfile(recoveredPlayer.name, recoveredPlayer.avatar);
  listenToRoom(currentRoomId);
  startHeartbeat();
  initGameForRoom({ roomId: currentRoomId, roomCode: currentRoomCode, playerId: currentPlayerId });

  if (["starting", "playing", "finished"].includes(room.status)) showGameScreen();
  else showRoomScreen(currentRoomCode);
  return true;
}


const helpButton = document.getElementById("helpButton");
const exitGameButton = document.getElementById("exitGameButton");
const helpModal = document.getElementById("helpModal");
const closeHelpButton = document.getElementById("closeHelpButton");

helpButton?.addEventListener("click", () => helpModal?.classList.remove("hidden"));
closeHelpButton?.addEventListener("click", () => helpModal?.classList.add("hidden"));
helpModal?.addEventListener("click", (event) => {
  if (event.target === helpModal) helpModal.classList.add("hidden");
});

document.querySelectorAll(".social-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href")?.trim();
    if (!href) {
      event.preventDefault();
      notify("أضف رابط هذا الحساب داخل index.html أولًا.", { type: "info" });
    }
  });
});

exitGameButton?.addEventListener("click", async () => {
  if (!(await confirmAction({ title: "الخروج من تعليلة", message: "هل أنت متأكد أنك تريد الخروج من اللعبة؟", confirmText: "خروج", cancelText: "إلغاء", danger: true }))) return;
  try { window.close(); } catch {}
  setTimeout(() => {
    try { window.location.replace("about:blank"); } catch {}
  }, 80);
});


avatarButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled || button.classList.contains("reserved")) return;
    selectedAvatar = normalizeAvatarId(button.dataset.avatar);
    renderProfileAvatars(profileReservationRoom);
  });
});

editProfileButton?.addEventListener("click", () => openProfileEditor("home", null));
roomProfileButton?.addEventListener("click", () => openProfileEditor("room", currentRoom));
closeProfileModal?.addEventListener("click", closeProfileEditor);
profileModal?.addEventListener("click", (event) => {
  if (event.target === profileModal) closeProfileEditor();
});

saveProfileButton?.addEventListener("click", async () => {
  const name = profileNameInput?.value?.trim().slice(0, 20) || "";
  if (!name) {
    setProfileMessage("اكتب اسم اللاعب أولًا.", "warning");
    profileNameInput?.focus();
    return;
  }
  if (!AVATAR_IDS.includes(selectedAvatar)) {
    setProfileMessage("اختر صورة للاعب.", "warning");
    return;
  }

  saveProfileButton.disabled = true;
  saveProfileButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
  try {
    if (profileModalContext === "room" && currentRoomId && currentPlayerId) {
      const roomRef = doc(db, "rooms", currentRoomId);
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(roomRef);
        if (!snapshot.exists()) throw new Error("ROOM_NOT_FOUND");
        const room = snapshot.data();
        if (room.status !== "waiting") throw new Error("GAME_STARTED");
        const map = playersMap(room);
        if (!map[currentPlayerId]) throw new Error("PLAYER_NOT_FOUND");
        const taken = Object.values(map).some((player) =>
          player?.id !== currentPlayerId && normalizeAvatarId(player.avatar) === selectedAvatar
        );
        if (taken) throw new Error("AVATAR_TAKEN");
        transaction.update(roomRef, {
          [`players.${currentPlayerId}.name`]: name,
          [`players.${currentPlayerId}.avatar`]: selectedAvatar,
        });
      });
    } else if (profileReservationRoom) {
      const taken = Object.values(playersMap(profileReservationRoom)).some((player) =>
        normalizeAvatarId(player.avatar) === selectedAvatar
      );
      if (taken) throw new Error("AVATAR_TAKEN");
    }

    saveLocalProfile(name, selectedAvatar);
    closeProfileEditor();
  } catch (error) {
    console.error("saveProfile failed:", error);
    const message = error?.message === "AVATAR_TAKEN"
      ? "هذه الصورة حُجزت للتو من لاعب آخر. اختر صورة مختلفة."
      : error?.message === "GAME_STARTED"
        ? "لا يمكن تعديل الملف الشخصي بعد بدء المباراة."
        : "تعذر حفظ الملف الشخصي.";
    setProfileMessage(message, "error");
    if (currentRoom) renderProfileAvatars(currentRoom);
  } finally {
    saveProfileButton.disabled = false;
    saveProfileButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> تسجيل';
  }
});

[homeRoomCodeInput, roomCodeInput].forEach((input) => {
  input?.addEventListener("input", () => {
    input.value = normalizeCode(input.value);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      joinRoom(input.value);
    }
  });
});

createRoomButton?.addEventListener("click", createRoom);
readyButton?.addEventListener("click", toggleReady);
startGameButton?.addEventListener("click", startGame);
leaveRoomButton?.addEventListener("click", leaveRoom);

joinRoomButton?.addEventListener("click", () => {
  if (!requireRegisteredProfile()) return;
  const inlineCode = normalizeCode(homeRoomCodeInput?.value);
  if (inlineCode.length === 6) {
    joinRoom(inlineCode);
  } else {
    joinModal?.classList.remove("hidden");
    roomCodeInput?.focus();
  }
});

confirmJoin?.addEventListener("click", () => joinRoom(roomCodeInput?.value));
closeJoinModal?.addEventListener("click", () => joinModal?.classList.add("hidden"));
joinModal?.addEventListener("click", (event) => {
  if (event.target === joinModal) joinModal.classList.add("hidden");
});

publicRoomsButton?.addEventListener("click", async () => {
  if (!requireRegisteredProfile()) return;
  publicRoomsModal?.classList.remove("hidden");
  await loadPublicRooms();
});
closePublicRoomsModal?.addEventListener("click", () => publicRoomsModal?.classList.add("hidden"));
publicRoomsModal?.addEventListener("click", (event) => {
  if (event.target === publicRoomsModal) publicRoomsModal.classList.add("hidden");
});
refreshPublicRooms?.addEventListener("click", loadPublicRooms);

roundsMinus?.addEventListener("click", () => adjustSetting("rounds", -1));
roundsPlus?.addEventListener("click", () => adjustSetting("rounds", 1));
timerMinus?.addEventListener("click", () => adjustSetting("answerTime", -1));
timerPlus?.addEventListener("click", () => adjustSetting("answerTime", 1));
playersMinus?.addEventListener("click", () => adjustSetting("maxPlayers", -1));
playersPlus?.addEventListener("click", () => adjustSetting("maxPlayers", 1));

copyRoomCodeButton?.addEventListener("click", async () => {
  if (!currentRoomCode) return;
  try {
    await navigator.clipboard.writeText(currentRoomCode);
    copyRoomCodeButton.innerHTML = '<i class="fa-solid fa-check"></i> تم النسخ';
    setTimeout(() => {
      copyRoomCodeButton.innerHTML = '<i class="fa-solid fa-copy"></i> نسخ الرمز';
    }, 1500);
  } catch {
    notify(`رمز الغرفة: ${currentRoomCode}`, { type: "info", title: "تعذر النسخ تلقائيًا", duration: 7000 });
  }
});

window.addEventListener("taleela:leave-room", leaveRoom);
window.addEventListener("online", () => {
  if (currentRoomId) sendHeartbeat();
  else resumeActiveSession();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeActiveSession();
});
window.addEventListener("pageshow", () => resumeActiveSession());
window.addEventListener("focus", () => resumeActiveSession());

async function bootstrap() {
  loadLocalProfile();
  renderProfileAvatars(null);
  if (createRoomButton) createRoomButton.disabled = true;
  if (joinRoomButton) joinRoomButton.disabled = true;
  if (publicRoomsButton) publicRoomsButton.disabled = true;

  try {
    authenticatedUser = await ensureAuth();
    await recoverRoom();
  } catch (error) {
    console.error("Application bootstrap failed:", error);
    const hasActiveSession = Boolean(readSession());
    if (hasActiveSession) showRestoringSession();
    else showHomeScreen();

    const code = error?.code || "";
    if (code === "auth/operation-not-allowed") {
      notify("Anonymous Authentication غير مفعّل في Firebase.", { type: "error", duration: 7000 });
    } else if (code === "auth/admin-restricted-operation") {
      notify("Firebase يمنع إنشاء المستخدم المجهول. فعّل Anonymous Authentication والسماح بإنشاء الحسابات.", { type: "error", duration: 8000 });
    } else if (code === "auth/network-request-failed") {
      notify("تعذر الاتصال بـ Firebase بسبب الشبكة.", { type: "error", duration: 7000 });
    } else {
      notify(`تعذر الاتصال بخدمات Firebase. ${error?.message || ""}`, { type: "error", duration: 8000 });
    }
  } finally {
    bootstrapComplete = true;
    if (createRoomButton) createRoomButton.disabled = false;
    if (joinRoomButton) joinRoomButton.disabled = false;
    if (publicRoomsButton) publicRoomsButton.disabled = false;
  }
}

bootstrap();
console.log("Taleela App v7.3.0 loaded");
