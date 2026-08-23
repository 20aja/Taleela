import {db} from "./firebase.js";
import {collection, doc, onSnapshot} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const subscribers = new Set();

let activeRoomId = null;
let activePlayerId = null;
let roomUnsubscribe = null;
let playersUnsubscribe = null;
let presenceUnsubscribe = null;
let roundUnsubscribe = null;
let bluffUnsubscribe = null;
let guessUnsubscribe = null;
let revealReadyUnsubscribe = null;

const state = {
  roomId: null,
  playerId: null,
  room: null,
  players: {},
  presence: {},
  round: null,
  bluffs: {},
  guesses: {},
  revealReady: {},
  roomLoaded: false,
  playersLoaded: false,
  presenceLoaded: false,
  roundLoaded: true,
  roomExists: true,
  error: null,
  revisions: {room: 0, players: 0, presence: 0, round: 0, bluffs: 0, guesses: 0, revealReady: 0},
};

function docsToMap(snapshot) {
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, {id: item.id, ...item.data()}]));
}

function mergedPlayers() {
  return Object.fromEntries(
    Object.entries(state.players).map(([id, player]) => [
      id,
      {
        ...player,
        lastSeen: state.presence[id]?.lastSeen || player.lastSeen || null,
      },
    ]),
  );
}

function requestMap(field) {
  return Object.fromEntries(Object.entries(state.players).filter(([, player]) => player?.[field] === true).map(([id]) => [id, true]));
}

function buildMergedRoom() {
  if (!state.room) return null;
  const round = state.round
    ? {
        ...state.round,
        bluffs: state.bluffs,
        guesses: state.guesses,
        revealReady: Object.fromEntries(Object.keys(state.revealReady).map((id) => [id, true])),
      }
    : null;

  return {
    ...state.room,
    players: mergedPlayers(),
    round,
    replayRequests: requestMap("replayRequested"),
    returnRequests: requestMap("returnRequested"),
  };
}

function publicState() {
  return {
    roomId: state.roomId,
    playerId: state.playerId,
    room: buildMergedRoom(),
    rawRoom: state.room,
    players: mergedPlayers(),
    presence: {...state.presence},
    round: state.round ? {...state.round, bluffs: state.bluffs, guesses: state.guesses, revealReady: state.revealReady} : null,
    loaded: state.roomLoaded && state.playersLoaded && state.roundLoaded,
    roomLoaded: state.roomLoaded,
    playersLoaded: state.playersLoaded,
    presenceLoaded: state.presenceLoaded,
    roundLoaded: state.roundLoaded,
    roomExists: state.roomExists,
    error: state.error,
    revisions: {...state.revisions},
    renderRevision: `${state.revisions.room}:${state.revisions.players}:${state.revisions.round}:${state.revisions.bluffs}:${state.revisions.guesses}:${state.revisions.revealReady}`,
    lobbyRevision: `${state.revisions.room}:${state.revisions.players}`,
  };
}

function emit() {
  const snapshot = publicState();
  subscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.error("Room store subscriber failed:", error);
    }
  });
}

function stopRoundListeners() {
  [roundUnsubscribe, bluffUnsubscribe, guessUnsubscribe, revealReadyUnsubscribe].forEach((unsubscribe) => unsubscribe?.());
  roundUnsubscribe = null;
  bluffUnsubscribe = null;
  guessUnsubscribe = null;
  revealReadyUnsubscribe = null;
  state.round = null;
  state.bluffs = {};
  state.guesses = {};
  state.revealReady = {};
  state.roundLoaded = true;
}

function listenToRound(roundId) {
  stopRoundListeners();
  if (!activeRoomId || !roundId) {
    emit();
    return;
  }

  state.roundLoaded = false;
  const base = ["rooms", activeRoomId, "rounds", roundId];
  const roundRef = doc(db, ...base);

  roundUnsubscribe = onSnapshot(
    roundRef,
    (snapshot) => {
      state.round = snapshot.exists() ? {id: snapshot.id, ...snapshot.data()} : null;
      state.roundLoaded = true;
      state.error = null;
      state.revisions.round += 1;
      emit();
    },
    (error) => {
      state.error = error;
      state.roundLoaded = true;
      emit();
    },
  );

  bluffUnsubscribe = onSnapshot(
    collection(db, ...base, "bluffs"),
    (snapshot) => {
      state.bluffs = docsToMap(snapshot);
      state.error = null;
      state.revisions.bluffs += 1;
      emit();
    },
    (error) => {
      state.error = error;
      emit();
    },
  );

  guessUnsubscribe = onSnapshot(
    collection(db, ...base, "guesses"),
    (snapshot) => {
      state.guesses = docsToMap(snapshot);
      state.error = null;
      state.revisions.guesses += 1;
      emit();
    },
    (error) => {
      state.error = error;
      emit();
    },
  );

  revealReadyUnsubscribe = onSnapshot(
    collection(db, ...base, "revealReady"),
    (snapshot) => {
      state.revealReady = docsToMap(snapshot);
      state.error = null;
      state.revisions.revealReady += 1;
      emit();
    },
    (error) => {
      state.error = error;
      emit();
    },
  );
}

export function startRoomStore({roomId, playerId}) {
  if (!roomId || !playerId) throw new Error("ROOM_STORE_IDENTITY_REQUIRED");
  if (activeRoomId === roomId && activePlayerId === playerId && roomUnsubscribe) return;

  stopRoomStore();
  activeRoomId = roomId;
  activePlayerId = playerId;
  state.roomId = roomId;
  state.playerId = playerId;
  state.roomExists = true;
  state.error = null;
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.presenceLoaded = false;
  state.revisions = {room: 0, players: 0, presence: 0, round: 0, bluffs: 0, guesses: 0, revealReady: 0};

  const roomRef = doc(db, "rooms", roomId);
  roomUnsubscribe = onSnapshot(
    roomRef,
    (snapshot) => {
      state.roomLoaded = true;
      state.roomExists = snapshot.exists();
      state.error = null;
      const previousRoundId = state.room?.currentRoundId || null;
      state.room = snapshot.exists() ? {id: snapshot.id, ...snapshot.data(), _fromCache: snapshot.metadata.fromCache, _hasPendingWrites: snapshot.metadata.hasPendingWrites} : null;
      state.revisions.room += 1;
      const nextRoundId = state.room?.currentRoundId || null;
      if (previousRoundId !== nextRoundId) listenToRound(nextRoundId);
      emit();
    },
    (error) => {
      state.error = error;
      state.roomLoaded = true;
      emit();
    },
  );

  playersUnsubscribe = onSnapshot(
    collection(roomRef, "players"),
    (snapshot) => {
      state.players = docsToMap(snapshot);
      state.playersLoaded = true;
      state.error = null;
      state.revisions.players += 1;
      emit();
    },
    (error) => {
      state.error = error;
      state.playersLoaded = true;
      emit();
    },
  );

  presenceUnsubscribe = onSnapshot(
    collection(roomRef, "presence"),
    (snapshot) => {
      state.presence = docsToMap(snapshot);
      state.presenceLoaded = true;
      state.error = null;
      state.revisions.presence += 1;
      emit();
    },
    (error) => {
      state.error = error;
      state.presenceLoaded = true;
      emit();
    },
  );
}

export function stopRoomStore() {
  [roomUnsubscribe, playersUnsubscribe, presenceUnsubscribe].forEach((unsubscribe) => unsubscribe?.());
  roomUnsubscribe = null;
  playersUnsubscribe = null;
  presenceUnsubscribe = null;
  stopRoundListeners();
  activeRoomId = null;
  activePlayerId = null;
  Object.assign(state, {
    roomId: null,
    playerId: null,
    room: null,
    players: {},
    presence: {},
    round: null,
    bluffs: {},
    guesses: {},
    revealReady: {},
    roomLoaded: false,
    playersLoaded: false,
    presenceLoaded: false,
    roundLoaded: true,
    roomExists: true,
    error: null,
    revisions: {room: 0, players: 0, presence: 0, round: 0, bluffs: 0, guesses: 0, revealReady: 0},
  });
  emit();
}

export function subscribeRoomState(callback) {
  subscribers.add(callback);
  callback(publicState());
  return () => subscribers.delete(callback);
}

export function getRoomState() {
  return publicState();
}
