import { CONFIG } from "../config.js";
import { CURATED_LOCATIONS } from "../locations/curated.js";

let viewer = null;
let currentImageId = null;

export function getViewer() { return viewer; }

export function initPanorama(container) {
  if (!window.mapillary) throw new Error("Mapillary SDK not loaded");
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
  return viewer;
}

export function lockPanorama(locked) {
  const container = document.getElementById("streetview");
  container.classList.toggle("locked", !!locked);
}

function bboxAround(lat, lng, radiusMeters) {
  const dLat = radiusMeters / 111000;
  const dLng = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
}

async function searchMapillary(lat, lng, radiusMeters) {
  const bbox = bboxAround(lat, lng, radiusMeters);
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(CONFIG.MAPILLARY_TOKEN)}&fields=id,computed_geometry,is_pano&bbox=${bbox}&limit=25`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
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
    console.warn("Mapillary search failed", e);
    return null;
  }
}

export async function resolveLocationByIndex(index) {
  const total = CURATED_LOCATIONS.length;
  const radius = CONFIG.SEARCH_RADIUS_METERS || 4000;
  for (let i = 0; i < 25; i++) {
    const idx = (index + i) % total;
    const loc = CURATED_LOCATIONS[idx];
    const hit = await searchMapillary(loc.lat, loc.lng, radius);
    if (hit) {
      return { index: idx, lat: hit.lat, lng: hit.lng, imageId: hit.imageId, label: loc.label || null };
    }
    const wider = await searchMapillary(loc.lat, loc.lng, radius * 4);
    if (wider) {
      return { index: idx, lat: wider.lat, lng: wider.lng, imageId: wider.imageId, label: loc.label || null };
    }
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const lat = (Math.random() * 140) - 60;
    const lng = (Math.random() * 360) - 180;
    const hit = await searchMapillary(lat, lng, 60000);
    if (hit) {
      return { index, lat: hit.lat, lng: hit.lng, imageId: hit.imageId, label: null };
    }
  }
  throw new Error("Could not find a Mapillary panorama. Check your token.");
}

export async function showLocation(loc) {
  if (!viewer) return;
  currentImageId = loc.imageId;
  try {
    await viewer.moveTo(loc.imageId);
  } catch (e) {
    console.warn("viewer.moveTo failed", e);
  }
  lockPanorama(false);
}
