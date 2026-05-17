export function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function computeDistanceKm(guess, actual) {
  return haversineKm(guess, actual);
}

export function scoreFromDistanceKm(km) {
  const s = Math.round(5000 * Math.exp(-km / 2000));
  return Math.max(0, Math.min(5000, s));
}
