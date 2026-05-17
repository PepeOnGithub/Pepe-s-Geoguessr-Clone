import { CONFIG } from "../config.js";
import { $, showScreen, toast } from "./ui.js";
import * as game from "./game.js";
import { getCurrentGuess } from "./map.js";
import { resetToStart, resizeViewer } from "./streetview.js";
import * as mp from "./multiplayer.js";

function waitForGlobals() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.L && window.mapillary) return resolve();
      if (Date.now() - start > 8000) return reject(new Error("Map/Mapillary libraries failed to load"));
      setTimeout(check, 50);
    })();
  });
}

function configValid() {
  return CONFIG.MAPILLARY_TOKEN
    && !CONFIG.MAPILLARY_TOKEN.includes("YOUR_")
    && CONFIG.SUPABASE_URL
    && !CONFIG.SUPABASE_URL.includes("YOUR_");
}

function bindUI() {
  $("btn-single").addEventListener("click", async () => {
    try {
      await game.startSinglePlayer();
    } catch (e) {
      console.error(e);
      toast(e.message || "Failed to start", true);
    }
  });

  $("btn-mp-create").addEventListener("click", async () => {
    const name = ($("player-name").value || "").trim() || "Host";
    try {
      await mp.createRoom(name);
    } catch (e) {
      console.error(e);
      toast(e.message || "Failed to create room", true);
    }
  });

  $("btn-mp-join").addEventListener("click", async () => {
    const code = $("join-code").value;
    const name = ($("player-name").value || "").trim() || "Player";
    try {
      await mp.joinRoom(code, name);
    } catch (e) {
      console.error(e);
      toast(e.message || "Failed to join", true);
    }
  });

  $("join-code").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  $("btn-lobby-start").addEventListener("click", async () => {
    try { await mp.startGameAsHost(); } catch (e) { toast(e.message || "Failed to start", true); }
  });

  $("btn-lobby-leave").addEventListener("click", async () => {
    await mp.leaveRoom();
    showScreen("screen-menu");
  });

  $("btn-guess").addEventListener("click", () => {
    const g = getCurrentGuess();
    if (!g) return toast("Drop a pin on the map first", true);
    game.submitGuess(g);
  });

  $("btn-next").addEventListener("click", () => game.nextRound());

  $("btn-quit").addEventListener("click", async () => {
    if (!confirm("Quit current game?")) return;
    if (mp.isInRoom()) await mp.leaveRoom();
    game.quitGame();
  });

  $("btn-play-again").addEventListener("click", async () => {
    if (mp.isInRoom()) { toast("Return to lobby first", true); return; }
    await game.startSinglePlayer();
  });

  $("btn-home").addEventListener("click", async () => {
    if (mp.isInRoom()) await mp.leaveRoom();
    showScreen("screen-menu");
  });

  $("btn-share").addEventListener("click", async () => {
    const txt = game.getShareText();
    try { await navigator.clipboard.writeText(txt); toast("Copied to clipboard"); }
    catch { toast("Copy failed", true); }
  });

  $("map-toggle").addEventListener("click", () => {
    $("guess-map-container").classList.toggle("collapsed");
    setTimeout(() => { resizeViewer(); }, 320);
  });

  const resetBtn = document.getElementById("btn-reset-pos");
  if (resetBtn) resetBtn.addEventListener("click", () => resetToStart());

  const copyBtn = document.getElementById("btn-copy-code");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    try { await navigator.clipboard.writeText(code); toast("Code copied"); }
    catch { toast("Copy failed", true); }
  });
}

async function boot() {
  bindUI();
  try {
    await waitForGlobals();
    if (!configValid()) {
      toast("Edit config.js with your Mapillary token and Supabase keys.", true, 6000);
    }
    showScreen("screen-menu");
  } catch (e) {
    console.error(e);
    toast(e.message, true, 6000);
    showScreen("screen-menu");
  }
}

boot();
