const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

let guessMap = null;
let guessMarker = null;
let onGuessChange = null;

export function getGuessMap() { return guessMap; }

export function invalidateAllMaps() {
  [guessMap, resultMap, finalMap].forEach(m => {
    if (m) { try { m.invalidateSize(); } catch (e) {} }
  });
}

export function initGuessMap(container, onChange) {
  onGuessChange = onChange;
  guessMap = L.map(container, {
    center: [20, 0],
    zoom: 1,
    minZoom: 1,
    maxZoom: 18,
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: false
  });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(guessMap);
  guessMap.on("click", e => {
    placeGuessMarker(e.latlng);
    if (onGuessChange) onGuessChange({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
  return guessMap;
}

export function placeGuessMarker(latLng) {
  if (!guessMap) return;
  if (guessMarker) {
    guessMarker.setLatLng(latLng);
  } else {
    guessMarker = L.circleMarker(latLng, {
      radius: 9, color: "#ffffff", weight: 2, fillColor: "#58a6ff", fillOpacity: 1
    }).addTo(guessMap);
  }
}

export function resetGuessMap() {
  if (guessMarker && guessMap) {
    guessMap.removeLayer(guessMarker);
    guessMarker = null;
  }
  if (guessMap) {
    guessMap.setView([20, 0], 1);
  }
}

export function getCurrentGuess() {
  if (!guessMarker) return null;
  const ll = guessMarker.getLatLng();
  return { lat: ll.lat, lng: ll.lng };
}

let resultMap = null;
let resultArtifacts = [];

export function initResultMap(container) {
  resultMap = L.map(container, {
    center: [20, 0], zoom: 2, minZoom: 1, worldCopyJump: true, zoomControl: false, attributionControl: false
  });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(resultMap);
  return resultMap;
}

export function clearResultMap() {
  if (!resultMap) return;
  resultArtifacts.forEach(a => resultMap.removeLayer(a));
  resultArtifacts = [];
}

export function drawRoundResult({ guess, actual, otherGuesses = [], you }) {
  if (!resultMap) return;
  clearResultMap();
  setTimeout(() => resultMap.invalidateSize(), 0);

  const points = [];

  const actualMarker = L.circleMarker([actual.lat, actual.lng], {
    radius: 10, color: "#ffffff", weight: 2, fillColor: "#2ea043", fillOpacity: 1
  }).addTo(resultMap).bindTooltip("Actual", { permanent: false });
  resultArtifacts.push(actualMarker);
  points.push([actual.lat, actual.lng]);

  if (guess) {
    const gm = L.circleMarker([guess.lat, guess.lng], {
      radius: 8, color: "#ffffff", weight: 2, fillColor: "#58a6ff", fillOpacity: 1
    }).addTo(resultMap).bindTooltip(you || "Your guess", { permanent: false });
    resultArtifacts.push(gm);
    points.push([guess.lat, guess.lng]);
    animateLine([guess.lat, guess.lng], [actual.lat, actual.lng], "#58a6ff");
  }

  otherGuesses.forEach(g => {
    const c = g.color || "#f0b429";
    const m = L.circleMarker([g.lat, g.lng], {
      radius: 7, color: "#ffffff", weight: 2, fillColor: c, fillOpacity: 1
    }).addTo(resultMap).bindTooltip(g.name || "Player", { permanent: false });
    resultArtifacts.push(m);
    points.push([g.lat, g.lng]);
    animateLine([g.lat, g.lng], [actual.lat, actual.lng], c);
  });

  if (points.length) {
    resultMap.fitBounds(points, { padding: [60, 60], maxZoom: 8 });
  }
}

function animateLine(from, to, color) {
  if (!resultMap) return;
  const line = L.polyline([from, from], { color, weight: 3, opacity: 0.9, dashArray: "6 8" }).addTo(resultMap);
  resultArtifacts.push(line);
  const steps = 30;
  let i = 0;
  const interval = setInterval(() => {
    i++;
    const t = i / steps;
    const lat = from[0] + (to[0] - from[0]) * t;
    const lng = from[1] + (to[1] - from[1]) * t;
    line.setLatLngs([from, [lat, lng]]);
    if (i >= steps) clearInterval(interval);
  }, 18);
}

let finalMap = null;
let finalArtifacts = [];

export function initFinalMap(container) {
  finalMap = L.map(container, {
    center: [20, 0], zoom: 2, minZoom: 1, worldCopyJump: true, zoomControl: false, attributionControl: false
  });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(finalMap);
  return finalMap;
}

export function drawFinalSummary(rounds) {
  if (!finalMap) return;
  finalArtifacts.forEach(a => finalMap.removeLayer(a));
  finalArtifacts = [];
  setTimeout(() => finalMap.invalidateSize(), 0);
  const points = [];

  rounds.forEach((r, i) => {
    const am = L.circleMarker([r.actual.lat, r.actual.lng], {
      radius: 9, color: "#ffffff", weight: 2, fillColor: "#2ea043", fillOpacity: 1
    }).addTo(finalMap).bindTooltip(`Round ${i + 1} actual`, { permanent: false });
    finalArtifacts.push(am);
    points.push([r.actual.lat, r.actual.lng]);

    if (r.guess) {
      const gm = L.circleMarker([r.guess.lat, r.guess.lng], {
        radius: 7, color: "#ffffff", weight: 2, fillColor: "#58a6ff", fillOpacity: 1
      }).addTo(finalMap).bindTooltip(`Round ${i + 1} guess`, { permanent: false });
      finalArtifacts.push(gm);
      points.push([r.guess.lat, r.guess.lng]);
      const line = L.polyline([[r.guess.lat, r.guess.lng], [r.actual.lat, r.actual.lng]], {
        color: "#58a6ff", weight: 2, opacity: 0.7
      }).addTo(finalMap);
      finalArtifacts.push(line);
    }
  });

  if (points.length) {
    finalMap.fitBounds(points, { padding: [60, 60] });
  }
}
