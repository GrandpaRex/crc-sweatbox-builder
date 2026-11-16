import type { LatLon } from "./types";

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(from: LatLon, bearingDeg: number, distNm: number): LatLon {
  const d = distNm / R_NM;
  const b = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    rad(from.lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** Sector-file coordinate token, e.g. `N042.21.52.000` or `W071.00.23.000`. */
export function parseSctCoord(token: string): number | null {
  const m = /^([NSEW])(\d{1,3})\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,3}))?$/i.exec(token.trim());
  if (!m) return null;
  const sec = +m[4] + (m[5] ? +("0." + m[5]) : 0);
  const v = +m[2] + +m[3] / 60 + sec / 3600;
  return /[SW]/i.test(m[1]) ? -v : v;
}
