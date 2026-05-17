import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { CONFIG } from "../config.js";
import { CURATED_LOCATIONS } from "../locations/curated.js";
import { seededIndices, seedFromString, startMultiplayerGame, onAllMpGuesses, advanceToRound, showFinal, getState } from "./game.js";
import { $, showScreen, toast, escapeHtml, setMpStrip } from "./ui.js";

let supabase = null;
let channel = null;
let myPlayerId = null;
let myName = "Player";
let isHost = false;
let currentRoom = null;
let hostId = null;
let presenceState = {};

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let pendingGuesses = {};
let roundTimerHandle = null;

function initSupabase() {
  if (supabase) return;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_URL.includes("YOUR_")) {
    throw new Error("Supabase not configured");
  }
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } }
  });
}

function genRoomCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return s;
}

const db = {
  async insertRoom(code, hostId) {
    const { error } = await supabase.from("rooms").insert({
      room_code: code, host_id: hostId, game_status: "lobby"
    });
    if (error) throw error;
  },
  async deleteRoom(code) {
    const { error } = await supabase.from("rooms").delete().eq("room_code", code);
    if (error) console.warn("deleteRoom", error);
  },
  async updateRoom(code, patch) {
    const { error } = await supabase.from("rooms").update(patch).eq("room_code", code);
    if (error) console.warn("updateRoom", error);
  },
  async upsertPlayer(code, playerId, name) {
    const { error } = await supabase.from("players").upsert(
      { room_code: code, player_id: playerId, name, ready: false },
      { onConflict: "room_code,player_id" }
    );
    if (error) console.warn("upsertPlayer", error);
  },
  async deletePlayer(code, playerId) {
    const { error } = await supabase.from("players")
      .delete().eq("room_code", code).eq("player_id", playerId);
    if (error) console.warn("deletePlayer", error);
  },
  async setPlayerScore(code, playerId, score) {
    const { error } = await supabase.from("players")
      .update({ score }).eq("room_code", code).eq("player_id", playerId);
    if (error) console.warn("setPlayerScore", error);
  },
  async insertGuess(row) {
    const { error } = await supabase.from("guesses").upsert(row, {
      onConflict: "room_code,round_num,player_id"
    });
    if (error) console.warn("insertGuess", error);
  }
};

async function createRoomRow(hostId) {
  for (let i = 0; i < 5; i++) {
    const code = genRoomCode();
    try {
      await db.insertRoom(code, hostId);
      return code;
    } catch (e) {
      if (e.code !== "23505") throw e;
    }
  }
  throw new Error("Could not allocate a room code, try again");
}

function genPlayerId() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export function setMyName(n) { myName = (n || "Player").slice(0, 16); }

export async function createRoom(name) {
  initSupabase();
  setMyName(name);
  myPlayerId = genPlayerId();
  isHost = true;
  hostId = myPlayerId;
  currentRoom = await createRoomRow(myPlayerId);
  await db.upsertPlayer(currentRoom, myPlayerId, myName);
  await joinChannel(currentRoom);
  showLobby(currentRoom);
  return currentRoom;
}

export async function joinRoom(rawCode, name) {
  initSupabase();
  const code = (rawCode || "").toUpperCase().trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Invalid room code");
  setMyName(name);
  myPlayerId = genPlayerId();
  isHost = false;
  currentRoom = code;
  await joinChannel(code);

  await new Promise(r => setTimeout(r, 1500));
  const members = Object.values(presenceState).flat();
  const host = members.find(m => m.isHost && m.id !== myPlayerId);
  if (!host) {
    await leaveRoom();
    throw new Error("Room not found");
  }
  hostId = host.id;
  if (members.length > CONFIG.MAX_PLAYERS) {
    await leaveRoom();
    throw new Error("Room is full");
  }
  await db.upsertPlayer(code, myPlayerId, myName);
  showLobby(code);
}

async function joinChannel(code) {
  channel = supabase.channel(`geoguess:${code}`, {
    config: {
      broadcast: { self: true, ack: false },
      presence: { key: myPlayerId }
    }
  });

  channel.on("presence", { event: "sync" }, () => {
    presenceState = channel.presenceState();
    handlePresenceSync();
  });

  channel.on("broadcast", { event: "game_start" }, ({ payload }) => onGameStart(payload));
  channel.on("broadcast", { event: "round_start" }, ({ payload }) => onRoundStartBroadcast(payload));
  channel.on("broadcast", { event: "guess" }, ({ payload }) => onGuessBroadcast(payload));
  channel.on("broadcast", { event: "round_results" }, ({ payload }) => onRoundResultsBroadcast(payload));
  channel.on("broadcast", { event: "game_end" }, ({ payload }) => onGameEndBroadcast(payload));
  channel.on("broadcast", { event: "kick" }, ({ payload }) => {
    if (payload.target === myPlayerId) {
      toast("You were removed from the room", true);
      leaveRoom().then(() => showScreen("screen-menu"));
    }
  });

  await new Promise((resolve, reject) => {
    let resolved = false;
    const t = setTimeout(() => { if (!resolved) reject(new Error("Connection timed out")); }, 8000);
    channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        resolved = true;
        clearTimeout(t);
        await channel.track({
          id: myPlayerId,
          name: myName,
          isHost,
          joinedAt: Date.now(),
          guessed: false
        });
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (!resolved) { resolved = true; clearTimeout(t); reject(new Error("Channel error: " + status)); }
      }
    });
  });
}

function handlePresenceSync() {
  const members = Object.values(presenceState).flat();
  const host = members.find(m => m.isHost);
  if (host) hostId = host.id;
  const onLobby = document.getElementById("screen-lobby").classList.contains("active");
  if (onLobby) renderLobbyPlayers(members);
  const onGame = document.getElementById("screen-game").classList.contains("active");
  if (onGame) {
    setMpStrip(members.map(m => ({ name: m.name, done: !!m.guessed })));
  }
}

function renderLobbyPlayers(members) {
  const list = $("lobby-players");
  list.innerHTML = members.map(p =>
    `<li>
      <span>${escapeHtml(p.name)}${p.id === myPlayerId ? " (you)" : ""}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    </li>`
  ).join("");
}

function showLobby(code) {
  $("lobby-code").textContent = code;
  showScreen("screen-lobby");
  $("btn-lobby-start").style.display = isHost ? "block" : "none";
  $("lobby-hint").textContent = isHost
    ? "You are the host. Share the room code with friends, then start when ready."
    : "Waiting for host to start the game…";
}

export async function startGameAsHost() {
  if (!isHost || !channel) return;
  const seed = seedFromString(currentRoom + ":" + Date.now());
  const indices = seededIndices(seed, CONFIG.ROUNDS_PER_GAME, CURATED_LOCATIONS.length);
  await db.updateRoom(currentRoom, { game_status: "playing", current_round: 0 });
  await channel.send({
    type: "broadcast", event: "game_start",
    payload: { seed, indices }
  });
}

async function onGameStart(payload) {
  const adapter = makeAdapter();
  await startMultiplayerGame({
    seed: payload.seed,
    indices: payload.indices,
    adapter,
    youId: myPlayerId
  });
}

async function onRoundStartBroadcast(payload) {
  pendingGuesses = {};
  await trackUpdate({ guessed: false });
  setMpStrip([]);
  const state = getState();
  if (state && payload.round !== state.currentRoundIdx) {
    await advanceToRound(payload.round);
  }
}

async function onGuessBroadcast(payload) {
  if (!isHost) return;
  pendingGuesses[payload.playerId] = payload;
  const members = Object.values(presenceState).flat();
  const activePlayerIds = members.map(m => m.id);
  const allDone = activePlayerIds.length > 0 && activePlayerIds.every(id => pendingGuesses[id]);
  if (allDone) {
    clearTimeout(roundTimerHandle);
    await broadcastRoundResults();
  }
}

async function broadcastRoundResults() {
  const members = Object.values(presenceState).flat();
  const results = members.map(m => {
    const g = pendingGuesses[m.id];
    return {
      id: m.id,
      name: m.name,
      guess: g && !g.skipped ? { lat: g.lat, lng: g.lng } : null,
      score: g ? g.score : 0,
      distanceKm: g ? g.distance : 20000
    };
  });
  if (!window.__mpTotals) window.__mpTotals = {};
  results.forEach(r => {
    window.__mpTotals[r.id] = (window.__mpTotals[r.id] || 0) + (r.score || 0);
  });
  await Promise.all(results.map(r =>
    db.setPlayerScore(currentRoom, r.id, window.__mpTotals[r.id] || 0)
  ));
  await channel.send({
    type: "broadcast", event: "round_results",
    payload: { results, totals: { ...window.__mpTotals } }
  });
}

function onRoundResultsBroadcast(payload) {
  window.__mpTotals = payload.totals || {};
  onAllMpGuesses(payload.results);
}

async function onGameEndBroadcast(payload) {
  const leaderboard = (payload.leaderboard || []).map(p => ({ id: p.id, name: p.name, score: p.score }));
  showFinal(leaderboard);
}

async function trackUpdate(patch) {
  if (!channel) return;
  await channel.track({
    id: myPlayerId,
    name: myName,
    isHost,
    joinedAt: Date.now(),
    ...patch
  });
}

function makeAdapter() {
  return {
    async onRoundStart(idx, loc) {
      if (isHost) {
        pendingGuesses = {};
        clearTimeout(roundTimerHandle);
        await db.updateRoom(currentRoom, { current_round: idx });
        await channel.send({
          type: "broadcast", event: "round_start",
          payload: { round: idx }
        });
        const grace = (CONFIG.ROUND_TIME_SECONDS + 6) * 1000;
        roundTimerHandle = setTimeout(() => {
          broadcastRoundResults().catch(() => {});
        }, grace);
      }
      setMpStrip([]);
    },
    async submitGuess({ guess, distanceKm, score }) {
      const state = getState();
      const roundIdx = state ? state.currentRoundIdx : 0;
      const payload = {
        playerId: myPlayerId,
        lat: guess ? guess.lat : 0,
        lng: guess ? guess.lng : 0,
        score,
        distance: distanceKm,
        skipped: !guess,
        ts: Date.now()
      };
      await db.insertGuess({
        room_code: currentRoom,
        round_num: roundIdx,
        player_id: myPlayerId,
        lat: guess ? guess.lat : null,
        lng: guess ? guess.lng : null,
        score: score || 0,
        distance_km: distanceKm || 0
      });
      await trackUpdate({ guessed: true });
      await channel.send({
        type: "broadcast", event: "guess",
        payload
      });
    },
    async requestNextRound() {
      const state = getState();
      const idx = state.currentRoundIdx;
      if (isHost) {
        if (idx + 1 >= CONFIG.ROUNDS_PER_GAME) {
          const members = Object.values(presenceState).flat();
          const lb = members.map(m => ({
            id: m.id,
            name: m.name,
            score: (window.__mpTotals || {})[m.id] || 0
          }));
          await db.updateRoom(currentRoom, { game_status: "finished" });
          await channel.send({
            type: "broadcast", event: "game_end",
            payload: { leaderboard: lb }
          });
        } else {
          await advanceToRound(idx + 1);
        }
      } else {
        toast("Waiting for host to advance…", false, 1500);
      }
    },
    leave() { leaveRoom(); }
  };
}

export async function leaveRoom() {
  clearTimeout(roundTimerHandle);
  if (currentRoom && myPlayerId) {
    if (isHost) {
      await db.deleteRoom(currentRoom);
    } else {
      await db.deletePlayer(currentRoom, myPlayerId);
    }
  }
  if (channel) {
    try { await channel.untrack(); } catch (e) {}
    try { await supabase.removeChannel(channel); } catch (e) {}
  }
  channel = null;
  currentRoom = null;
  myPlayerId = null;
  isHost = false;
  hostId = null;
  presenceState = {};
  pendingGuesses = {};
  window.__mpTotals = {};
  setMpStrip([]);
}

export function isInRoom() { return !!currentRoom; }
export function getRoomCode() { return currentRoom; }
export function getMyPlayerId() { return myPlayerId; }
