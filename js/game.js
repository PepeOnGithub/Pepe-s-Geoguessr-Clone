import { CONFIG } from "../config.js";
import { CURATED_LOCATIONS } from "../locations/curated.js";
import { initPanorama, showLocation, lockPanorama, resolveLocationByIndex } from "./streetview.js";
import { initGuessMap, resetGuessMap, getCurrentGuess, initResultMap, drawRoundResult, initFinalMap, drawFinalSummary } from "./map.js";
import { computeDistanceKm, scoreFromDistanceKm } from "./score.js";
import { $, showScreen, setHud, toast, setLockedGuessButton, formatDistance, escapeHtml, setMpStrip } from "./ui.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededIndices(seed, count, max) {
  const rand = mulberry32(seed);
  const used = new Set();
  const out = [];
  let safety = 0;
  while (out.length < count && safety < count * 50) {
    safety++;
    const idx = Math.floor(rand() * max);
    if (!used.has(idx)) {
      used.add(idx);
      out.push(idx);
    }
  }
  return out;
}

export function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let state = null;
let timerHandle = null;
let mpAdapter = null;
let onAllPlayersGuessed = null;

export function getState() { return state; }

function resetState() {
  state = {
    mode: "single",
    seed: 0,
    indices: [],
    currentRoundIdx: 0,
    rounds: [],
    totalScore: 0,
    currentLocation: null,
    currentGuess: null,
    awaitingNext: false,
    locked: false,
    timeLeft: CONFIG.ROUND_TIME_SECONDS,
    started: false,
    youId: null
  };
}

export async function startSinglePlayer() {
  resetState();
  state.mode = "single";
  state.seed = Date.now() >>> 0;
  state.indices = seededIndices(state.seed, CONFIG.ROUNDS_PER_GAME, CURATED_LOCATIONS.length);
  mpAdapter = null;
  await runGame();
}

export async function startMultiplayerGame({ seed, indices, adapter, youId }) {
  resetState();
  state.mode = "mp";
  state.seed = seed;
  state.indices = indices;
  state.youId = youId;
  mpAdapter = adapter;
  await runGame();
}

async function runGame() {
  showScreen("screen-game");
  ensureMapsInit();
  await beginRound(0);
}

function ensureMapsInit() {
  if (!window.__panoInit) {
    initPanorama($("streetview"));
    initGuessMap($("guess-map"), guess => {
      setLockedGuessButton(false);
    });
    initResultMap($("result-map"));
    initFinalMap($("final-map"));
    window.__panoInit = true;
  }
}

async function beginRound(idx) {
  state.currentRoundIdx = idx;
  state.currentGuess = null;
  state.awaitingNext = false;
  state.locked = false;
  setLockedGuessButton(true);
  resetGuessMap();
  setHud({ round: idx + 1, total: CONFIG.ROUNDS_PER_GAME, time: CONFIG.ROUND_TIME_SECONDS, score: state.totalScore });
  showScreen("screen-game");
  toast("Loading panorama…", false, 1200);

  const locIdx = state.indices[idx];
  const loc = await resolveLocationByIndex(locIdx);
  state.currentLocation = loc;
  showLocation(loc);

  if (mpAdapter) {
    mpAdapter.onRoundStart(idx, loc);
  }

  startTimer();
}

function startTimer() {
  clearInterval(timerHandle);
  state.timeLeft = CONFIG.ROUND_TIME_SECONDS;
  setHud({ time: state.timeLeft });
  timerHandle = setInterval(() => {
    state.timeLeft--;
    setHud({ time: Math.max(0, state.timeLeft) });
    if (state.timeLeft <= 0) {
      clearInterval(timerHandle);
      handleTimeout();
    }
  }, 1000);
}

function handleTimeout() {
  if (state.locked) return;
  const guess = getCurrentGuess();
  submitGuess(guess);
}

export function submitGuess(guessOrNull) {
  if (state.locked) return;
  state.locked = true;
  clearInterval(timerHandle);
  lockPanorama(true);
  setLockedGuessButton(true);

  const guess = guessOrNull || null;
  state.currentGuess = guess;

  let distanceKm = guess ? computeDistanceKm(guess, state.currentLocation) : 20000;
  let score = guess ? scoreFromDistanceKm(distanceKm) : 0;

  const roundRecord = {
    actual: { lat: state.currentLocation.lat, lng: state.currentLocation.lng },
    guess,
    distanceKm,
    score
  };
  state.rounds[state.currentRoundIdx] = roundRecord;
  state.totalScore += score;
  setHud({ score: state.totalScore });

  if (mpAdapter) {
    mpAdapter.submitGuess({ guess, distanceKm, score });
    showWaitingPanel();
  } else {
    showRoundResult({ otherGuesses: [] });
  }
}

function showWaitingPanel() {
  toast("Waiting for other players…", false, 1500);
}

export function onAllMpGuesses(playerResults) {
  const me = state.youId;
  const others = playerResults.filter(p => p.id !== me && p.guess).map(p => ({
    lat: p.guess.lat,
    lng: p.guess.lng,
    name: p.name,
    color: p.color || colorForId(p.id)
  }));
  showRoundResult({ otherGuesses: others, mpResults: playerResults });
}

function colorForId(id) {
  const palette = ["#f0b429", "#f85149", "#a371f7", "#39d353", "#ec6cb9"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function showRoundResult({ otherGuesses, mpResults }) {
  showScreen("screen-round-result");
  const r = state.rounds[state.currentRoundIdx];
  $("result-title").textContent = `Round ${state.currentRoundIdx + 1}`;
  animateNumber($("result-score"), 0, r.score, 800);
  $("result-distance").textContent = formatDistance(r.distanceKm);
  drawRoundResult({
    guess: r.guess,
    actual: r.actual,
    otherGuesses,
    you: "You"
  });

  const mpList = $("result-mp-list");
  if (mpResults && mpResults.length) {
    const sorted = [...mpResults].sort((a, b) => (b.score || 0) - (a.score || 0));
    mpList.innerHTML = sorted.map((p, i) =>
      `<div class="lb-row ${p.id === state.youId ? 'you' : ''}">
         <span><span class="rank">#${i + 1}</span>${escapeHtml(p.name)}</span>
         <span>${formatDistance(p.distanceKm || 20000)} · <span class="lb-score">${p.score || 0}</span></span>
       </div>`
    ).join("");
  } else {
    mpList.innerHTML = "";
  }

  const btnNext = $("btn-next");
  if (state.currentRoundIdx + 1 >= CONFIG.ROUNDS_PER_GAME) {
    btnNext.textContent = "See Final Results";
  } else {
    btnNext.textContent = "Next Round";
  }
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export async function nextRound() {
  if (mpAdapter) {
    mpAdapter.requestNextRound();
    return;
  }
  if (state.currentRoundIdx + 1 >= CONFIG.ROUNDS_PER_GAME) {
    showFinal();
  } else {
    await beginRound(state.currentRoundIdx + 1);
  }
}

export async function advanceToRound(idx) {
  if (idx >= CONFIG.ROUNDS_PER_GAME) {
    showFinal();
  } else {
    await beginRound(idx);
  }
}

export function showFinal(leaderboard) {
  showScreen("screen-final");
  clearInterval(timerHandle);
  animateNumber($("final-score"), 0, state.totalScore, 1200);
  drawFinalSummary(state.rounds.map(r => ({ actual: r.actual, guess: r.guess })));

  const list = $("final-rounds");
  list.innerHTML = state.rounds.map((r, i) =>
    `<li><span>Round ${i + 1}</span><span>${formatDistance(r.distanceKm)} · <strong>${r.score}</strong> pts</span></li>`
  ).join("");

  const lb = $("final-mp-leaderboard");
  if (leaderboard && leaderboard.length) {
    const sorted = [...leaderboard].sort((a, b) => (b.score || 0) - (a.score || 0));
    lb.innerHTML = `<h3 style="margin:12px 0 8px;font-size:14px;color:var(--text-dim)">Leaderboard</h3>` +
      sorted.map((p, i) =>
        `<div class="lb-row ${p.id === state.youId ? 'you' : ''}">
           <span><span class="rank">#${i + 1}</span>${escapeHtml(p.name)}</span>
           <span class="lb-score">${p.score || 0}</span>
         </div>`
      ).join("");
  } else {
    lb.innerHTML = "";
  }
}

export function getShareText() {
  const tot = state.totalScore;
  const lines = state.rounds.map((r, i) => `R${i + 1}: ${r.score} pts (${formatDistance(r.distanceKm)})`);
  return `GeoGuess — ${tot} pts\n${lines.join("\n")}`;
}

export function quitGame() {
  clearInterval(timerHandle);
  if (mpAdapter) mpAdapter.leave();
  resetState();
  showScreen("screen-menu");
}
