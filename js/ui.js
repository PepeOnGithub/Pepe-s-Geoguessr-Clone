const screens = ["screen-loading", "screen-menu", "screen-lobby", "screen-game", "screen-round-result", "screen-final"];

export function $(id) { return document.getElementById(id); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function showScreen(id) {
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    if (s === id) el.classList.add("active");
    else el.classList.remove("active");
  });
}

let toastTimer = null;
export function toast(msg, isError = false, duration = 2500) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), duration);
}

const TIMER_CIRC = 2 * Math.PI * 20;
let timerTotalRef = 60;

export function setTimerTotal(total) { timerTotalRef = total || 60; }

export function setHud({ round, total, time, score }) {
  if (round != null && total != null) $("hud-round").textContent = `${round}/${total}`;
  if (time != null) {
    const t = $("hud-timer");
    t.textContent = time;
    const warn = time <= 15 && time > 5;
    const danger = time <= 5;
    t.classList.toggle("warn", warn);
    t.classList.toggle("danger", danger);
    const ring = $("timer-ring-fg");
    if (ring) {
      const frac = Math.max(0, Math.min(1, time / timerTotalRef));
      ring.style.strokeDashoffset = String(TIMER_CIRC * (1 - frac));
      ring.classList.toggle("warn", warn);
      ring.classList.toggle("danger", danger);
    }
  }
  if (score != null) {
    $("hud-score").textContent = Number(score).toLocaleString();
  }
}

export function setMpStrip(rows) {
  const strip = $("mp-players-strip");
  if (!rows || !rows.length) {
    strip.classList.remove("show");
    strip.innerHTML = "";
    return;
  }
  strip.classList.add("show");
  strip.innerHTML = rows.map(r =>
    `<div class="mp-player-row ${r.done ? 'done' : ''}">
       <span>${escapeHtml(r.name)}</span>
       <span>${r.done ? '✓' : '…'}</span>
     </div>`
  ).join("");
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

export function setLockedGuessButton(locked) {
  $("btn-guess").disabled = locked;
}
