import {db, ensureAuth} from "./firebase.js";
import {notify, confirmAction} from "./ui.js";

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {GAME_CATEGORIES, categoryHasQuestions} from "./categories.js";
import {startRoomStore, stopRoomStore, subscribeRoomState} from "./room-store.js";

let gameModulePromise = null;
let loadedGameModule = null;
let gameLifecycleToken = 0;

function loadGameModule() {
  if (!gameModulePromise) {
    gameModulePromise = import("./game.js").then((module) => {
      loadedGameModule = module;
      return module;
    });
  }
  return gameModulePromise;
}

async function initLoadedGameForRoom(options) {
  const token = ++gameLifecycleToken;
  const module = await loadGameModule();
  if (token !== gameLifecycleToken) return;
  module.initGameForRoom(options);
}

function stopLoadedGame() {
  gameLifecycleToken += 1;
  loadedGameModule?.stopGame?.();
}

const ROOM_SCHEMA_VERSION = 7;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HOST_STALE_MS = 90_000;
const MIN_PLAYERS = 2;
const MAX_PLAYER_LIMIT = 8;
const MIN_CATEGORIES = 1;
const DEFAULT_AVATAR = "avatar-01";
const AVATAR_IDS = Array.from({length: 20}, (_, index) => `avatar-${String(index + 1).padStart(2, "0")}`);
const PROFILE_NAME_KEY = "taleela_profile_name";
const PROFILE_AVATAR_KEY = "taleela_profile_avatar";
const PROFILE_AVATAR_IMAGE_KEY = "taleela_profile_avatar_image_v1";
const MAX_AVATAR_DATA_LENGTH = 60_000;
const ACTIVE_SESSION_KEY = "taleela_active_room_v1";

let selectedAvatar = DEFAULT_AVATAR;
let selectedAvatarImage = "";
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
let lastRoomKeepAliveAt = 0;
let lastLobbyRevision = null;

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
const customAvatarInput = document.getElementById("customAvatarInput");
const customAvatarButton = document.getElementById("customAvatarButton");
const customAvatarPreview = document.getElementById("customAvatarPreview");
const removeCustomAvatarButton = document.getElementById("removeCustomAvatarButton");

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function normalizeAvatarId(value) {
  const avatar = String(value || "");
  return AVATAR_IDS.includes(avatar) ? avatar : DEFAULT_AVATAR;
}

function normalizeAvatarImage(value) {
  const image = String(value || "");
  if (!image || image.length > MAX_AVATAR_DATA_LENGTH) return "";
  return /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) ? image : "";
}

function avatarSrc(value, customImage = "") {
  return normalizeAvatarImage(customImage) || `assets/Users/${normalizeAvatarId(value)}.webp`;
}

function avatarHTML(value, className = "avatar-image", alt = "صورة اللاعب", customImage = "") {
  const custom = normalizeAvatarImage(customImage);
  const extraClass = custom ? " custom-avatar-image" : "";
  return `<img class="${className}${extraClass}" src="${custom || avatarSrc(value)}" alt="${escapeHTML(alt)}" draggable="false" />`;
}

function getTakenAvatars(room, exceptPlayerId = null) {
  return new Set(
    Object.values(playersMap(room))
      .filter((player) => player?.id && player.id !== exceptPlayerId && !normalizeAvatarImage(player.avatarImage))
      .map((player) => normalizeAvatarId(player.avatar)),
  );
}

function saveLocalProfile(name, avatar, avatarImage = selectedAvatarImage) {
  const cleanName = String(name || "")
    .trim()
    .slice(0, 20);
  const cleanAvatar = normalizeAvatarId(avatar);
  const cleanAvatarImage = normalizeAvatarImage(avatarImage);
  try {
    localStorage.setItem(PROFILE_NAME_KEY, cleanName);
    localStorage.setItem(PROFILE_AVATAR_KEY, cleanAvatar);
    if (cleanAvatarImage) localStorage.setItem(PROFILE_AVATAR_IMAGE_KEY, cleanAvatarImage);
    else localStorage.removeItem(PROFILE_AVATAR_IMAGE_KEY);
  } catch (error) {
    console.warn("Unable to save local profile:", error);
  }
  selectedAvatar = cleanAvatar;
  selectedAvatarImage = cleanAvatarImage;
  if (nameInput) nameInput.value = cleanName;
  updateHomeProfileSummary();
}

function loadLocalProfile() {
  let name = "";
  let avatar = DEFAULT_AVATAR;
  let avatarImage = "";
  try {
    name = String(localStorage.getItem(PROFILE_NAME_KEY) || "")
      .trim()
      .slice(0, 20);
    avatar = normalizeAvatarId(localStorage.getItem(PROFILE_AVATAR_KEY));
    avatarImage = normalizeAvatarImage(localStorage.getItem(PROFILE_AVATAR_IMAGE_KEY));
  } catch {
    // Keep defaults when storage is blocked.
  }
  selectedAvatar = avatar;
  selectedAvatarImage = avatarImage;
  if (nameInput) nameInput.value = name;
  updateHomeProfileSummary();
}

function updateHomeProfileSummary() {
  const name = nameInput?.value?.trim() || "";
  if (homeProfileName) homeProfileName.textContent = name || "سجّل اسمك وصورتك";
  if (homeProfileAvatar) {
    homeProfileAvatar.src = avatarSrc(selectedAvatar, selectedAvatarImage);
    homeProfileAvatar.classList.toggle("custom-avatar-image", Boolean(selectedAvatarImage));
  }
}

function updateCustomAvatarUI() {
  const custom = normalizeAvatarImage(selectedAvatarImage);
  customAvatarButton?.classList.toggle("active", Boolean(custom));
  removeCustomAvatarButton?.classList.toggle("hidden", !custom);
  if (customAvatarPreview) {
    customAvatarPreview.src = avatarSrc(selectedAvatar, custom);
    customAvatarPreview.classList.toggle("custom-avatar-image", Boolean(custom));
  }
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
    image.src = url;
  });
}

async function compressAvatarFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("IMAGE_TYPE");
  if (Number(file.size) > 10 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("IMAGE_DECODE_FAILED");
    const side = Math.min(sourceWidth, sourceHeight);
    const sx = Math.max(0, (sourceWidth - side) / 2);
    const sy = Math.max(0, (sourceHeight - side) / 2);
    const sizes = [192, 168, 144];
    const qualities = [0.82, 0.72, 0.62, 0.52];
    for (const size of sizes) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", {alpha: false});
      if (!context) throw new Error("CANVAS_UNAVAILABLE");
      context.fillStyle = "#171827";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
      for (const quality of qualities) {
        let data = canvas.toDataURL("image/webp", quality);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality);
        if (normalizeAvatarImage(data)) return data;
      }
    }
    throw new Error("IMAGE_COMPRESS_FAILED");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function blurActiveTextInput() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], textarea, [contenteditable="true"]')) active.blur();
}

function ensureProfileAvatarImages() {
  document.querySelectorAll("#profileAvatars img[data-src]").forEach((image) => {
    image.src = image.dataset.src;
    image.removeAttribute("data-src");
  });
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
    const isActive = !selectedAvatarImage && avatar === selectedAvatar;
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
    avatarReservationHint.textContent = room ? "الصور الجاهزة التي اختارها لاعبو الغرفة تُحجز، أما صورتك من الجهاز فهي خاصة بك ولا تحتاج إلى حجز." : "يمكنك اختيار صورة جاهزة أو إضافة صورة من جهازك.";
  }
  updateCustomAvatarUI();
}

function openProfileEditor(context = "home", room = currentRoom) {
  if (!profileModal) return;
  ensureProfileAvatarImages();
  if (context === "room" && room?.status !== "waiting") {
    notify("يمكن تعديل الاسم والصورة من غرفة الانتظار فقط.", {type: "warning"});
    return;
  }
  profileModalContext = context;
  profileReservationRoom = room || null;
  const roomPlayer = context === "room" && currentPlayerId ? playersMap(room)[currentPlayerId] : null;
  if (roomPlayer) {
    selectedAvatar = normalizeAvatarId(roomPlayer.avatar);
    selectedAvatarImage = normalizeAvatarImage(roomPlayer.avatarImage);
    if (profileNameInput) profileNameInput.value = roomPlayer.name || "";
  } else if (profileNameInput) {
    profileNameInput.value = nameInput?.value || "";
  }
  setProfileMessage();
  renderProfileAvatars(room || null);
  blurActiveTextInput();
  profileModal.classList.remove("hidden");
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
  return Number(room?.schemaVersion || 1) < ROOM_SCHEMA_VERSION;
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
  return Array.from({length: 6}, () => characters[Math.floor(Math.random() * characters.length)]).join("");
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
  const players = playerList(room).sort((a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)));
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
      <div class="player-avatar">${avatarHTML(player.avatar, "player-avatar-img", `صورة ${player.name || "لاعب"}`, player.avatarImage)}</div>
      <div class="player-info">
        <div class="player-name">${escapeHTML(player.name || "لاعب")}${player.id === currentPlayerId ? ' <span class="you-label">أنت</span>' : ""}</div>
        ${isHost ? '<div class="player-host"><i class="fa-solid fa-crown"></i> المضيف</div>' : ""}
      </div>
      <span class="${ready ? "player-ready" : "player-waiting"}">
        ${ready ? '<i class="fa-solid fa-check"></i> جاهز' : "في الانتظار"}
      </span>
      ${
        room.hostId === currentPlayerId && player.id !== currentPlayerId && room.status === "waiting"
          ? `
        <button class="remove-player-button" type="button" data-remove-player="${escapeHTML(player.id)}" title="إزالة ${escapeHTML(player.name || "اللاعب")}" aria-label="إزالة ${escapeHTML(player.name || "اللاعب")}">
          <i class="fa-solid fa-user-minus"></i>
        </button>
      `
          : ""
      }
    `;
    const removeButton = card.querySelector("[data-remove-player]");
    removeButton?.addEventListener("click", () => removePlayerFromRoom(player.id));
    playersList.appendChild(card);
  });
}

function renderSettings(room) {
  const settings = room?.settings || {};
  const canEdit = isCurrentPlayerHost(room) && room?.status === "waiting";
  const rounds = Math.max(3, Math.min(30, Number(settings.rounds) || 6));
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
      <div class="category-icon">
        <img class="category-icon-image" src="${escapeHTML(category.image || "")}" alt="" loading="lazy" decoding="async" />
      </div>
      <div class="category-name">${escapeHTML(category.name)}</div>
      <div class="category-check"><i class="fa-solid fa-check"></i></div>
    `;

    if (canEdit && categoryHasQuestions(category.id)) {
      card.addEventListener("click", () => toggleCategory(category.id));
    }

    categoriesGrid.appendChild(card);
  });

  if (selectedCategoriesCount) {
    const availableCategoryCount = GAME_CATEGORIES.filter((item) => categoryHasQuestions(item.id)).length;
    const validSelectedCount = selected.filter((id) => categoryHasQuestions(id)).length;
    selectedCategoriesCount.textContent = `${validSelectedCount} / ${availableCategoryCount}`;
    selectedCategoriesCount.classList.toggle("minimum-met", validSelectedCount >= MIN_CATEGORIES);
    selectedCategoriesCount.setAttribute("aria-label", validSelectedCount >= MIN_CATEGORIES ? `تم اختيار الحد الأدنى: ${validSelectedCount} ${validSelectedCount === 1 ? "فئة" : "فئات"}` : `تم اختيار ${validSelectedCount} من أصل فئة واحدة مطلوبة على الأقل`);
  }
  if (categoriesMessage) {
    categoriesMessage.classList.toggle("hidden", canEdit);
    if (!canEdit) categoriesMessage.textContent = room?.status === "waiting" ? "المضيف فقط يستطيع تغيير الفئات." : "لا يمكن تغيير الفئات أثناء المباراة.";
  }
}

function canStartGame(room) {
  if (!room || room.status !== "waiting") return false;
  const players = playerList(room);
  const validCategories = Array.isArray(room.categories) ? room.categories.filter(categoryHasQuestions) : [];
  return players.length >= MIN_PLAYERS && players.length <= roomMaxPlayers(room) && players.every((player) => player.ready === true) && validCategories.length >= MIN_CATEGORIES;
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
  readyButton.innerHTML = player.ready ? '<i class="fa-solid fa-circle-check"></i> جاهز ✓' : '<i class="fa-solid fa-check"></i> جاهز';
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
    startGameButton.innerHTML = `<i class="fa-solid fa-layer-group"></i> اختر فئة واحدة على الأقل (${selected.length}/1)`;
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
    const migrated = {roomId, roomCode, playerId, savedAt: Date.now()};
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
  lastLobbyRevision = null;
  stopRoomStore();
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

async function sendHeartbeat() {
  if (!currentRoomId || !currentPlayerId || isLeavingRoom) return;
  try {
    await setDoc(
      doc(db, "rooms", currentRoomId, "presence", currentPlayerId),
      {id: currentPlayerId, lastSeen: serverTimestamp()},
      {merge: true},
    );

    // Temporary Stage-1 expiry refresh for public waiting rooms. Presence will
    // move to Realtime Database in Stage 2, but this already prevents abandoned
    // public rooms from remaining visible forever.
    const now = Date.now();
    if (currentRoom?.hostId === currentPlayerId && currentRoom?.isPublic && currentRoom?.status === "waiting" && now - lastRoomKeepAliveAt >= 60_000) {
      lastRoomKeepAliveAt = now;
      await updateDoc(doc(db, "rooms", currentRoomId), {
        lastActivityAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + 5 * 60_000),
      });
    }
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
  return !lastSeen || Date.now() - lastSeen > HOST_STALE_MS;
}

function chooseTakeoverCandidate(room) {
  const now = Date.now();
  return (
    playerList(room)
      .filter((player) => player.id !== room?.hostId)
      .filter((player) => {
        const lastSeen = valueToMillis(player.lastSeen);
        return !lastSeen || now - lastSeen <= HOST_STALE_MS;
      })
      .sort((a, b) => valueToMillis(a.joinedAt) - valueToMillis(b.joinedAt) || String(a.id).localeCompare(String(b.id)))[0] || null
  );
}

async function attemptHostTakeover(room) {
  if (!currentRoomId || !currentPlayerId || takeoverInProgress || !isHostStale(room)) return;
  const candidate = chooseTakeoverCandidate(room);
  if (!candidate || candidate.id !== currentPlayerId) return;

  takeoverInProgress = true;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) return;
      const latest = roomSnapshot.data();
      if (latest.hostId === currentPlayerId) return;

      const hostPresenceRef = latest.hostId ? doc(db, "rooms", currentRoomId, "presence", latest.hostId) : null;
      const hostPresenceSnapshot = hostPresenceRef ? await transaction.get(hostPresenceRef) : null;
      const hostLastSeen = hostPresenceSnapshot?.exists() ? valueToMillis(hostPresenceSnapshot.data().lastSeen) : 0;
      if (hostLastSeen && Date.now() - hostLastSeen <= HOST_STALE_MS) return;

      transaction.update(roomRef, {
        hostId: currentPlayerId,
        hostName: candidate.name || "لاعب",
        hostAvatar: normalizeAvatarId(candidate.avatar),
        hostAvatarImage: normalizeAvatarImage(candidate.avatarImage) || null,
        lastActivityAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn("host takeover failed:", error);
  } finally {
    takeoverInProgress = false;
  }
}

function listenToRoom(id) {
  stopRoomListener();
  startRoomStore({roomId: id, playerId: currentPlayerId});

  unsubscribeRoom = subscribeRoomState((snapshot) => {
    if (snapshot.error) {
      console.error("Room store error:", snapshot.error);
      showRoomError("انقطع الاتصال بالغرفة. سيتم الاستمرار في محاولة الاتصال تلقائيًا.");
      return;
    }

    if (snapshot.roomLoaded && !snapshot.roomExists) {
      if (!isLeavingRoom) {
        notify("الغرفة لم تعد موجودة.", {type: "warning", title: "تم إغلاق الغرفة"});
        resetApplicationToHome();
      }
      return;
    }

    const room = snapshot.room;
    if (!room) return;
    if (isLegacyRoom(room)) {
      showRoomError("هذه الغرفة أُنشئت بإصدار قديم. أنشئ غرفة جديدة باستخدام النسخة الحالية.");
      return;
    }

    if (snapshot.playersLoaded && !playersMap(room)[currentPlayerId]) {
      if (!isLeavingRoom) {
        notify("لم تعد عضوًا في هذه الغرفة. قد يكون المضيف قد أزالك.", {type: "warning", title: "تمت مغادرة الغرفة"});
        resetApplicationToHome();
      }
      return;
    }

    if (!snapshot.playersLoaded) return;
    currentRoom = room;
    currentRoomCode = room.code || currentRoomCode;
    saveSession();

    // Presence heartbeats update frequently. They are kept in currentRoom for
    // takeover checks, but they must not rebuild the entire lobby/game DOM.
    const needsLobbyRender = snapshot.lobbyRevision !== lastLobbyRevision;
    if (needsLobbyRender) {
      lastLobbyRevision = snapshot.lobbyRevision;
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
      if (["starting", "playing", "finished"].includes(room.status)) showGameScreen();
      else showRoomScreen(currentRoomCode);
    }

    if (room.hostId !== currentPlayerId && isHostStale(room)) attemptHostTakeover(room);
  });
}

async function toggleCategory(categoryId) {
  if (!currentRoomId || !currentPlayerId || !currentRoom) return;
  try {
    if (currentRoom.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
    if (currentRoom.status !== "waiting") return;
    const categories = new Set(Array.isArray(currentRoom.categories) ? currentRoom.categories : []);
    if (categories.has(categoryId)) categories.delete(categoryId);
    else categories.add(categoryId);
    await updateDoc(doc(db, "rooms", currentRoomId), {
      categories: [...categories],
      gameError: null,
      lastActivityAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("toggleCategory failed:", error);
    notify(error?.message === "HOST_ONLY" ? "فقط المضيف يستطيع اختيار الفئات." : "تعذر حفظ الفئات.", {type: "error"});
  }
}

async function adjustSetting(key, delta) {
  if (!currentRoomId || !currentPlayerId || !currentRoom) return;
  try {
    if (currentRoom.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
    if (currentRoom.status !== "waiting") return;
    const current = currentRoom.settings || {};
    const updates = {lastActivityAt: serverTimestamp()};
    if (key === "rounds") updates["settings.rounds"] = Math.max(3, Math.min(30, (Number(current.rounds) || 6) + delta));
    else if (key === "answerTime") updates["settings.answerTime"] = Math.max(10, Math.min(60, (Number(current.answerTime) || 15) + delta * 5));
    else if (key === "maxPlayers") {
      const count = playerList(currentRoom).length;
      const next = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYER_LIMIT, (Number(current.maxPlayers) || 4) + delta));
      if (next < count) throw new Error("PLAYERS_PRESENT");
      updates["settings.maxPlayers"] = next;
    }
    await updateDoc(doc(db, "rooms", currentRoomId), updates);
  } catch (error) {
    console.error("adjustSetting failed:", error);
    if (error?.message === "PLAYERS_PRESENT") notify("لا يمكن جعل الحد الأقصى أقل من عدد اللاعبين الموجودين حاليًا.", {type: "warning"});
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
    const isPublic = publicRoomToggle?.checked === true;
    let roomCode = null;

    for (let attempt = 0; attempt < 20 && !roomCode; attempt += 1) {
      const candidate = generateRoomCode();
      const roomRef = doc(db, "rooms", candidate);
      try {
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(roomRef);
          if (existing.exists()) throw new Error("CODE_COLLISION");
          const now = Timestamp.now();
          transaction.set(roomRef, {
            schemaVersion: ROOM_SCHEMA_VERSION,
            code: candidate,
            hostId: playerId,
            hostName: name.slice(0, 20),
            hostAvatar: selectedAvatar,
            hostAvatarImage: selectedAvatarImage || null,
            status: "waiting",
            isPublic,
            createdAt: now,
            lastActivityAt: now,
            expiresAt: Timestamp.fromMillis(Date.now() + (isPublic ? 5 * 60_000 : 24 * 60 * 60_000)),
            playerCount: 1,
            settings: {rounds: 6, answerTime: 15, selectionTime: 20, revealTime: 20, resultsTime: 5, maxPlayers: 4},
            categories: [],
            usedQuestionIds: [],
            usedFactKeys: [],
            currentRoundId: null,
            currentRoundNumber: 0,
            finalResults: null,
            gameError: null,
            finishedAt: null,
            gamePlayerCount: 0,
          });
          transaction.set(doc(db, "rooms", candidate, "players", playerId), {
            id: playerId,
            name: name.slice(0, 20),
            avatar: selectedAvatar,
            avatarImage: selectedAvatarImage || null,
            ready: true,
            score: 0,
            correctGuesses: 0,
            fooledPlayers: 0,
            replayRequested: false,
            returnRequested: false,
            joinedAt: now,
          });
          if (!selectedAvatarImage) transaction.set(doc(db, "rooms", candidate, "avatars", selectedAvatar), {playerId, reservedAt: now});
          transaction.set(doc(db, "rooms", candidate, "presence", playerId), {id: playerId, lastSeen: now});
        });
        roomCode = candidate;
      } catch (error) {
        if (error?.message !== "CODE_COLLISION") throw error;
      }
    }
    if (!roomCode) throw new Error("CODE_GENERATION_FAILED");

    currentRoomCode = roomCode;
    currentPlayerId = playerId;
    currentRoomId = roomCode;
    saveSession();
    showRoomScreen(roomCode);
    listenToRoom(roomCode);
    startHeartbeat();
    void initLoadedGameForRoom({roomId: roomCode, roomCode, playerId}).catch((error) => console.error("Game module load failed:", error));
  } catch (error) {
    console.error("createRoom failed:", error);
    notify(`تعذر إنشاء الغرفة. ${error.message || "خطأ غير معروف"}`, {type: "error", title: "تعذر إنشاء الغرفة", duration: 6000});
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
    notify("رمز الغرفة يجب أن يتكون من 6 أحرف وأرقام.", {type: "warning"});
    return;
  }

  if (confirmJoin) confirmJoin.disabled = true;
  if (joinRoomButton) joinRoomButton.disabled = true;

  try {
    authenticatedUser = authenticatedUser || (await ensureAuth());
    const playerId = authenticatedUser.uid;
    const roomRef = doc(db, "rooms", code);
    const playerRef = doc(db, "rooms", code, "players", playerId);
    const avatarRef = doc(db, "rooms", code, "avatars", selectedAvatar);
    const presenceRef = doc(db, "rooms", code, "presence", playerId);

    // One transaction is sufficient. The old implementation performed a
    // preview read, the transaction, then two confirmation reads, which added
    // several network round trips before the lobby could open.
    const joined = await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = roomSnapshot.data();
      if (isLegacyRoom(room)) throw new Error("LEGACY_ROOM");

      const existingPlayer = await transaction.get(playerRef);
      if (existingPlayer.exists()) {
        transaction.set(presenceRef, {id: playerId, lastSeen: serverTimestamp()}, {merge: true});
        return {room, player: existingPlayer.data()};
      }

      if (room.status !== "waiting") throw new Error("GAME_STARTED");
      if ((Number(room.playerCount) || 0) >= roomMaxPlayers(room)) throw new Error("ROOM_FULL");

      if (!selectedAvatarImage) {
        const avatarSnapshot = await transaction.get(avatarRef);
        if (avatarSnapshot.exists()) throw new Error("AVATAR_TAKEN");
      }

      const now = Timestamp.now();
      const playerData = {
        id: playerId,
        name: name.slice(0, 20),
        avatar: selectedAvatar,
        avatarImage: selectedAvatarImage || null,
        ready: false,
        score: 0,
        correctGuesses: 0,
        fooledPlayers: 0,
        replayRequested: false,
        returnRequested: false,
        joinedAt: now,
      };
      const nextCount = (Number(room.playerCount) || 0) + 1;
      const expiresAt = Timestamp.fromMillis(Date.now() + (room.isPublic ? 5 * 60_000 : 24 * 60 * 60_000));

      transaction.set(playerRef, playerData);
      if (!selectedAvatarImage) transaction.set(avatarRef, {playerId, reservedAt: now});
      transaction.set(presenceRef, {id: playerId, lastSeen: now});
      transaction.update(roomRef, {
        playerCount: nextCount,
        lastActivityAt: now,
        expiresAt,
      });

      return {room: {...room, playerCount: nextCount, lastActivityAt: now, expiresAt}, player: playerData};
    });

    if (!joined?.player || !joined?.room) throw new Error("JOIN_NOT_CONFIRMED");
    selectedAvatar = normalizeAvatarId(joined.player.avatar);
    selectedAvatarImage = normalizeAvatarImage(joined.player.avatarImage);
    saveLocalProfile(joined.player.name, joined.player.avatar, joined.player.avatarImage);

    currentRoomCode = code;
    currentPlayerId = playerId;
    currentRoomId = code;
    currentRoom = {...joined.room, players: {[playerId]: joined.player}};
    saveSession();
    joinModal?.classList.add("hidden");
    publicRoomsModal?.classList.add("hidden");
    if (roomCodeInput) roomCodeInput.value = "";
    if (homeRoomCodeInput) homeRoomCodeInput.value = "";
    showRoomScreen(code);
    listenToRoom(code);
    startHeartbeat();
    void initLoadedGameForRoom({roomId: code, roomCode: code, playerId}).catch((error) => console.error("Game module load failed:", error));
  } catch (error) {
    console.error("joinRoom failed:", error);
    const messages = {
      ROOM_NOT_FOUND: "لم يتم العثور على غرفة بهذا الرمز.",
      LEGACY_ROOM: "هذه الغرفة تعمل بإصدار قديم. اطلب من المضيف إنشاء غرفة جديدة.",
      GAME_STARTED: "بدأت اللعبة بالفعل ولا يمكن الانضمام الآن.",
      ROOM_FULL: "الغرفة ممتلئة.",
      AVATAR_TAKEN: "الصورة التي اخترتها محجوزة في هذه الغرفة. اختر صورة مختلفة.",
      JOIN_NOT_CONFIRMED: "تعذر تأكيد عضويتك في الغرفة. حاول مرة أخرى.",
    };
    notify(messages[error?.message] || `تعذر الانضمام إلى الغرفة. ${error?.message || ""}`, {type: "error", title: "تعذر الانضمام", duration: 6500});
    if (error?.message === "AVATAR_TAKEN") openProfileEditor("home", null);
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
    const nowTimestamp = Timestamp.now();
    let result;
    try {
      // The expiry predicate keeps abandoned public rooms out of the result on
      // the server instead of downloading and filtering them on every phone.
      result = await getDocs(
        query(
          collection(db, "rooms"),
          where("isPublic", "==", true),
          where("status", "==", "waiting"),
          where("expiresAt", ">", nowTimestamp),
          orderBy("expiresAt", "asc"),
          limit(40),
        ),
      );
    } catch (error) {
      // Until the included composite index is deployed, keep the public-room
      // list functional with the legacy equality-only query.
      if (error?.code !== "failed-precondition") throw error;
      console.warn("Public-room expiry index is not deployed yet; using fallback query.");
      result = await getDocs(query(collection(db, "rooms"), where("isPublic", "==", true), where("status", "==", "waiting"), limit(40)));
    }
    const now = Date.now();
    const rooms = result.docs
      .map((item) => ({id: item.id, ...item.data()}))
      .filter((room) => !isLegacyRoom(room) && valueToMillis(room.expiresAt) > now && (Number(room.playerCount) || 0) < roomMaxPlayers(room))
      .sort((a, b) => valueToMillis(b.createdAt) - valueToMillis(a.createdAt))
      .slice(0, 20);

    if (!rooms.length) {
      publicRoomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-door-closed"></i><p>لا توجد غرف عامة متاحة الآن.</p></div>';
      return;
    }

    publicRoomsList.innerHTML = rooms
      .map((room) => `
        <div class="public-room-item">
          <div class="public-room-info">
            <strong>${avatarHTML(room.hostAvatar, "public-room-avatar-img", `صورة ${room.hostName || "لاعب"}`, room.hostAvatarImage)} <span>غرفة ${escapeHTML(room.hostName || "لاعب")}</span></strong>
            <small>${Number(room.playerCount) || 0}/${roomMaxPlayers(room)} لاعبين • ${escapeHTML(room.code || room.id)}</small>
          </div>
          <button type="button" data-public-code="${escapeHTML(room.code || room.id)}">انضم</button>
        </div>`)
      .join("");
    publicRoomsList.querySelectorAll("[data-public-code]").forEach((button) => button.addEventListener("click", () => joinRoom(button.dataset.publicCode)));
  } catch (error) {
    console.error("loadPublicRooms failed:", error);
    publicRoomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>تعذر تحميل الغرف العامة.</p></div>';
  }
}

async function removePlayerFromRoom(targetPlayerId) {
  if (!currentRoomId || !currentPlayerId || !targetPlayerId || targetPlayerId === currentPlayerId) return;
  const target = playersMap(currentRoom)[targetPlayerId];
  if (!target) return;
  const confirmed = await confirmAction({title: "إزالة لاعب", message: `هل تريد إزالة ${target.name || "هذا اللاعب"} من الغرفة؟`, confirmText: "إزالة", cancelText: "إلغاء", danger: true});
  if (!confirmed) return;

  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = roomSnapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (room.status !== "waiting") throw new Error("WAITING_ONLY");
      const targetRef = doc(db, "rooms", currentRoomId, "players", targetPlayerId);
      const targetSnapshot = await transaction.get(targetRef);
      if (!targetSnapshot.exists()) return;
      const targetData = targetSnapshot.data();
      transaction.delete(targetRef);
      transaction.delete(doc(db, "rooms", currentRoomId, "presence", targetPlayerId));
      if (!normalizeAvatarImage(targetData.avatarImage)) transaction.delete(doc(db, "rooms", currentRoomId, "avatars", normalizeAvatarId(targetData.avatar)));
      transaction.update(roomRef, {
        playerCount: Math.max(0, (Number(room.playerCount) || 1) - 1),
        lastActivityAt: serverTimestamp(),
      });
    });
    notify(`تمت إزالة ${target.name || "اللاعب"} من الغرفة.`, {type: "success"});
  } catch (error) {
    console.error("removePlayerFromRoom failed:", error);
    const messages = {HOST_ONLY: "فقط المضيف يستطيع إزالة اللاعبين.", WAITING_ONLY: "يمكن إزالة اللاعبين من غرفة الانتظار فقط.", ROOM_NOT_FOUND: "الغرفة لم تعد موجودة."};
    notify(messages[error?.message] || "تعذر إزالة اللاعب.", {type: "error"});
  }
}

async function toggleReady() {
  if (!currentRoomId || !currentPlayerId || !currentRoom) return;
  readyButton.disabled = true;
  try {
    const player = playersMap(currentRoom)[currentPlayerId];
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    if (currentRoom.status !== "waiting") return;
    await updateDoc(doc(db, "rooms", currentRoomId, "players", currentPlayerId), {ready: player.ready !== true});
  } catch (error) {
    console.error("toggleReady failed:", error);
    notify("تعذر تغيير حالة الجاهزية.", {type: "error"});
  } finally {
    readyButton.disabled = false;
  }
}

async function startGame() {
  if (!currentRoomId || !currentPlayerId || !currentRoom) return;
  startGameButton.disabled = true;
  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    const ids = playerList(currentRoom).map((player) => player.id);
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const room = roomSnapshot.data();
      if (room.hostId !== currentPlayerId) throw new Error("HOST_ONLY");
      if (room.status !== "waiting") throw new Error("NOT_READY");
      const playerSnapshots = [];
      for (const id of ids) playerSnapshots.push(await transaction.get(doc(db, "rooms", currentRoomId, "players", id)));
      const players = Object.fromEntries(playerSnapshots.filter((item) => item.exists()).map((item) => [item.id, {id: item.id, ...item.data()}]));
      const merged = {...room, players};
      if (!canStartGame(merged) || Object.keys(players).length !== Number(room.playerCount)) throw new Error("NOT_READY");
      playerSnapshots.forEach((item) => {
        if (!item.exists()) return;
        transaction.update(item.ref, {score: 0, correctGuesses: 0, fooledPlayers: 0, replayRequested: false, returnRequested: false});
      });
      transaction.update(roomRef, {
        status: "starting",
        currentRoundId: null,
        currentRoundNumber: 0,
        finalResults: null,
        gameError: null,
        finishedAt: null,
        gamePlayerCount: Object.keys(players).length,
        lastActivityAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.error("startGame failed:", error);
    const message = error?.message === "HOST_ONLY" ? "فقط المضيف يستطيع بدء اللعبة." : error?.message === "NOT_READY" ? "اختر فئة واحدة على الأقل، وتأكد من وجود لاعبين على الأقل وجاهزية الجميع." : "تعذر بدء اللعبة.";
    notify(message, {type: "warning"});
  } finally {
    startGameButton.disabled = false;
  }
}

async function leaveRoom() {
  if (!currentRoomId || !currentPlayerId) return;
  if (!(await confirmAction({title: "مغادرة الغرفة", message: "هل تريد مغادرة الغرفة؟", confirmText: "مغادرة", cancelText: "البقاء", danger: true}))) return;
  isLeavingRoom = true;
  if (leaveRoomButton) leaveRoomButton.disabled = true;

  try {
    const roomRef = doc(db, "rooms", currentRoomId);
    const remaining = playerList(currentRoom).filter((player) => player.id !== currentPlayerId);
    const nextHost = remaining[0] || null;
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) return;
      const room = roomSnapshot.data();
      const playerRef = doc(db, "rooms", currentRoomId, "players", currentPlayerId);
      const playerSnapshot = await transaction.get(playerRef);
      if (!playerSnapshot.exists()) return;
      const player = playerSnapshot.data();
      transaction.delete(playerRef);
      transaction.delete(doc(db, "rooms", currentRoomId, "presence", currentPlayerId));
      if (!normalizeAvatarImage(player.avatarImage)) transaction.delete(doc(db, "rooms", currentRoomId, "avatars", normalizeAvatarId(player.avatar)));

      if ((Number(room.playerCount) || 1) <= 1) {
        transaction.delete(roomRef);
        return;
      }
      const updates = {
        playerCount: Math.max(0, (Number(room.playerCount) || 1) - 1),
        lastActivityAt: serverTimestamp(),
      };
      if (room.hostId === currentPlayerId && nextHost) {
        updates.hostId = nextHost.id;
        updates.hostName = nextHost.name || "لاعب";
        updates.hostAvatar = normalizeAvatarId(nextHost.avatar);
        updates.hostAvatarImage = normalizeAvatarImage(nextHost.avatarImage) || null;
      }
      transaction.update(roomRef, updates);
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
  stopLoadedGame();
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
  const playerRef = doc(db, "rooms", session.roomId, "players", authenticatedUser.uid);
  const [roomSnapshot, playerSnapshot] = await Promise.all([getDoc(roomRef), getDoc(playerRef)]);
  if (!roomSnapshot.exists() || !playerSnapshot.exists()) {
    clearSession();
    return false;
  }
  const room = roomSnapshot.data();
  if (isLegacyRoom(room)) {
    clearSession();
    return false;
  }

  currentRoomId = session.roomId;
  currentRoomCode = room.code || session.roomCode;
  currentPlayerId = authenticatedUser.uid;
  currentRoom = {...room, players: {[authenticatedUser.uid]: playerSnapshot.data()}};
  saveLocalProfile(playerSnapshot.data().name, playerSnapshot.data().avatar);
  listenToRoom(currentRoomId);
  startHeartbeat();
  await initLoadedGameForRoom({roomId: currentRoomId, roomCode: currentRoomCode, playerId: currentPlayerId});
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
      notify("أضف رابط هذا الحساب داخل index.html أولًا.", {type: "info"});
    }
  });
});

exitGameButton?.addEventListener("click", async () => {
  if (!(await confirmAction({title: "الخروج من تعليلة", message: "هل أنت متأكد أنك تريد الخروج من اللعبة؟", confirmText: "خروج", cancelText: "إلغاء", danger: true}))) return;
  try {
    window.close();
  } catch {}
  setTimeout(() => {
    try {
      window.location.replace("about:blank");
    } catch {}
  }, 80);
});

avatarButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled || button.classList.contains("reserved")) return;
    selectedAvatar = normalizeAvatarId(button.dataset.avatar);
    selectedAvatarImage = "";
    renderProfileAvatars(profileReservationRoom);
  });
});

customAvatarButton?.addEventListener("click", () => customAvatarInput?.click());
customAvatarInput?.addEventListener("change", async () => {
  const file = customAvatarInput.files?.[0];
  if (!file) return;
  customAvatarButton.disabled = true;
  setProfileMessage("جاري تجهيز الصورة...", "info");
  try {
    selectedAvatarImage = await compressAvatarFile(file);
    setProfileMessage("تم تجهيز الصورة الشخصية.", "info");
    renderProfileAvatars(profileReservationRoom);
  } catch (error) {
    console.error("custom avatar failed:", error);
    const message = error?.message === "IMAGE_TOO_LARGE" ? "حجم الصورة كبير جدًا. اختر صورة أصغر من 10 MB." : "تعذر قراءة الصورة أو ضغطها. جرّب صورة JPG أو PNG أو WebP أخرى.";
    setProfileMessage(message, "error");
  } finally {
    customAvatarButton.disabled = false;
    customAvatarInput.value = "";
  }
});
removeCustomAvatarButton?.addEventListener("click", () => {
  selectedAvatarImage = "";
  setProfileMessage();
  renderProfileAvatars(profileReservationRoom);
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
      const playerRef = doc(db, "rooms", currentRoomId, "players", currentPlayerId);
      await runTransaction(db, async (transaction) => {
        const [roomSnapshot, playerSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(playerRef)]);
        if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
        if (!playerSnapshot.exists()) throw new Error("PLAYER_NOT_FOUND");
        const room = roomSnapshot.data();
        const player = playerSnapshot.data();
        if (room.status !== "waiting") throw new Error("GAME_STARTED");
        const oldAvatar = normalizeAvatarId(player.avatar);
        const oldAvatarImage = normalizeAvatarImage(player.avatarImage);
        const newAvatarImage = normalizeAvatarImage(selectedAvatarImage);
        const switchingToBuiltIn = !newAvatarImage && (Boolean(oldAvatarImage) || selectedAvatar !== oldAvatar);
        if (switchingToBuiltIn) {
          const newAvatarRef = doc(db, "rooms", currentRoomId, "avatars", selectedAvatar);
          const newAvatarSnapshot = await transaction.get(newAvatarRef);
          if (newAvatarSnapshot.exists()) throw new Error("AVATAR_TAKEN");
          if (!oldAvatarImage && oldAvatar !== selectedAvatar) transaction.delete(doc(db, "rooms", currentRoomId, "avatars", oldAvatar));
          transaction.set(newAvatarRef, {playerId: currentPlayerId, reservedAt: Timestamp.now()});
        } else if (newAvatarImage && !oldAvatarImage) {
          transaction.delete(doc(db, "rooms", currentRoomId, "avatars", oldAvatar));
        }
        transaction.update(playerRef, {name, avatar: selectedAvatar, avatarImage: newAvatarImage || null});
        if (room.hostId === currentPlayerId) transaction.update(roomRef, {hostName: name, hostAvatar: selectedAvatar, hostAvatarImage: newAvatarImage || null, lastActivityAt: serverTimestamp()});
      });
    }
    saveLocalProfile(name, selectedAvatar, selectedAvatarImage);
    closeProfileEditor();
  } catch (error) {
    console.error("saveProfile failed:", error);
    const message = error?.message === "AVATAR_TAKEN" ? "هذه الصورة حُجزت للتو من لاعب آخر. اختر صورة مختلفة." : error?.message === "GAME_STARTED" ? "لا يمكن تعديل الملف الشخصي بعد بدء المباراة." : "تعذر حفظ الملف الشخصي.";
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
    blurActiveTextInput();
    joinModal?.classList.remove("hidden");
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
    notify(`رمز الغرفة: ${currentRoomCode}`, {type: "info", title: "تعذر النسخ تلقائيًا", duration: 7000});
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
      notify("Anonymous Authentication غير مفعّل في Firebase.", {type: "error", duration: 7000});
    } else if (code === "auth/admin-restricted-operation") {
      notify("Firebase يمنع إنشاء المستخدم المجهول. فعّل Anonymous Authentication والسماح بإنشاء الحسابات.", {type: "error", duration: 8000});
    } else if (code === "auth/network-request-failed") {
      notify("تعذر الاتصال بـ Firebase بسبب الشبكة.", {type: "error", duration: 7000});
    } else {
      notify(`تعذر الاتصال بخدمات Firebase. ${error?.message || ""}`, {type: "error", duration: 8000});
    }
  } finally {
    bootstrapComplete = true;
    if (createRoomButton) createRoomButton.disabled = false;
    if (joinRoomButton) joinRoomButton.disabled = false;
    if (publicRoomsButton) publicRoomsButton.disabled = false;
  }
}

bootstrap();
document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], textarea, [contenteditable="true"]')) return;
    blurActiveTextInput();
  },
  {capture: true},
);

console.log("Taleela App v8.10.0 Question Bank v1 + Persistent No-Repeat Cycles loaded");
