import { CONFIG } from "../config.js";
import { CURATED_LOCATIONS } from "../locations/curated.js";

let viewer = null;
let currentImageId = null;
let bearingCallback = null;
let initialBearing = 0;
let initialImageId = null;

export function getViewer() { return viewer; }
export function getCurrentBearing() { return initialBearing; }

export function initPanorama(container) {
  if (!window.mapillary) throw new Error("Mapillary SDK not loaded");
  if (viewer) return viewer;
  viewer = new mapillary.Viewer({
    accessToken: CONFIG.MAPILLARY_TOKEN,
    container,
    component: {
      cover: false,
      attribution: true,
      bearing: false,
      direction: false,
      sequence: false,
      zoom: false,
      image: true,
      pointer: { dragPan: true, scrollZoom: false, touchZoom: true }
    }
  });
  viewer.on("bearing", e => {
    if (bearingCallback) bearingCallback(e.bearing);
  });
  setTimeout(() => { try { viewer.resize(); } catch (e) {} }, 100);
  return viewer;
}

export function onBearingChange(cb) { bearingCallback = cb; }

export function resizeViewer() {
  if (viewer) {
    try { viewer.resize(); } catch (e) {}
  }
}

export function lockPanorama(locked) {
  const container = document.getElementById("streetview");
  container.classList.toggle("locked", !!locked);
}

export async function resetToStart() {
  if (!viewer || !initialImageId) return;
  try { await viewer.moveTo(initialImageId); } catch (e) {}
}

const MAX_BBOX_AREA = 0.0095;

function maxSafeRadiusMeters(lat) {
  const cosL = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const halfSideDeg = Math.sqrt(MAX_BBOX_AREA * cosL) / 2;
  return halfSideDeg * 111000;
}

function bboxAround(lat, lng, radiusMeters) {
  const safeR = Math.min(radiusMeters, maxSafeRadiusMeters(lat));
  const dLat = safeR / 111000;
  const dLng = safeR / (111000 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
}

async function searchMapillary(lat, lng, radiusMeters) {
  const bbox = bboxAround(lat, lng, radiusMeters);
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(CONFIG.MAPILLARY_TOKEN)}&fields=id,computed_geometry,is_pano&bbox=${bbox}&limit=50`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("Mapillary search", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    if (data.error) { console.warn("Mapillary error", data.error); return null; }
    if (!data.data || !data.data.length) return null;
    const valid = data.data.filter(x => x.computed_geometry && x.computed_geometry.coordinates);
    if (!valid.length) return null;
    const panos = valid.filter(x => x.is_pano);
    const pool = panos.length ? panos : valid;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return {
      imageId: pick.id,
      lng: pick.computed_geometry.coordinates[0],
      lat: pick.computed_geometry.coordinates[1]
    };
  } catch (e) {
    console.warn("Mapillary fetch failed", e);
    return null;
  }
}

export async function resolveLocationByIndex(index) {
  const total = CURATED_LOCATIONS.length;
  const radius = CONFIG.SEARCH_RADIUS_METERS || 3500;
  const tried = new Set();
  const strides = [1, 7, 13, 23, 37];

  for (const stride of strides) {
    for (let i = 0; i < 50 && tried.size < total; i++) {
      const idx = (index + i * stride) % total;
      if (tried.has(idx)) continue;
      tried.add(idx);
      const loc = CURATED_LOCATIONS[idx];
      const hit = await searchMapillary(loc.lat, loc.lng, radius);
      if (hit) {
        return {
          index: idx, lat: hit.lat, lng: hit.lng,
          imageId: hit.imageId, label: loc.label || null
        };
      }
    }
  }
  throw new Error("No Mapillary imagery found nearby. Coverage may be sparse — try again.");
}

export async function showLocation(loc) {
  if (!viewer) return;
  currentImageId = loc.imageId;
  initialImageId = loc.imageId;
  try {
    await viewer.moveTo(loc.imageId);
    setTimeout(() => { try { viewer.resize(); } catch (e) {} }, 100);
  } catch (e) {
    console.warn("viewer.moveTo failed", e);
    throw e;
  }
  lockPanorama(false);
}
