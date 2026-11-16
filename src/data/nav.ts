import type { LatLon } from "../core/types";
import { destination, distanceNm } from "../core/geo";

export interface NavRunway {
  id: string;
  heading: number;
  lat: number;
  lon: number;
  endLat: number;
  endLon: number;
}

export interface NavAirport extends LatLon {
  faaId: string;
  icaoId: string;
  name: string;
  elevation: number;
  runways: NavRunway[];
}

export interface Procedure {
  id: string;
  body: string[];
  transitions: string[][];
  airport?: string;
  runway?: string;
}

/** One source of navigation data (a sector file, or the vNAS nav database). */
export interface NavSet {
  label: string;
  fixes: Map<string, LatLon[]>;
  airports: Map<string, NavAirport>;
  sids: Procedure[];
  stars: Procedure[];
  fixCount: number;
  airportCount: number;
}

export const emptyNavSet = (label: string): NavSet => ({
  label,
  fixes: new Map(),
  airports: new Map(),
  sids: [],
  stars: [],
  fixCount: 0,
  airportCount: 0,
});

export function addFix(set: NavSet, id: string, loc: LatLon) {
  const key = id.toUpperCase();
  const list = set.fixes.get(key);
  if (list) list.push(loc);
  else set.fixes.set(key, [loc]);
  set.fixCount++;
}

export function addAirport(set: NavSet, a: NavAirport) {
  const existing = (a.icaoId && set.airports.get(a.icaoId)) || (a.faaId && set.airports.get(a.faaId));
  if (existing) {
    // Sector files list runways separately from airports; merge onto one record.
    existing.runways.push(...a.runways);
    return;
  }
  if (a.faaId) set.airports.set(a.faaId.toUpperCase(), a);
  if (a.icaoId) set.airports.set(a.icaoId.toUpperCase(), a);
  set.airportCount++;
}

/**
 * Ordered nav sources. Earlier sources win: user-loaded sector files first,
 * the vNAS nav database as the fallback.
 */
export class NavDb {
  constructor(public sources: NavSet[]) {}

  get loaded() {
    return this.sources.length > 0;
  }

  airport(id: string): NavAirport | undefined {
    const key = id.trim().toUpperCase();
    if (!key) return undefined;
    const alts = [key];
    if (key.length === 3) alts.push("K" + key, "P" + key);
    if (key.length === 4 && key[0] === "K") alts.push(key.slice(1));
    let found: NavAirport | undefined;
    for (const s of this.sources) {
      for (const k of alts) {
        const a = s.airports.get(k);
        if (!a) continue;
        if (!found) found = a;
        // Prefer whichever source actually has runway data.
        if (a.runways.length && !found.runways.length) found = { ...found, runways: a.runways };
      }
    }
    return found;
  }

  /** Resolve a fix, navaid, airport or fix-radial-distance (e.g. BOS090020). */
  fix(name: string, near?: LatLon): LatLon | undefined {
    const key = name.trim().toUpperCase();
    if (!key) return undefined;
    for (const s of this.sources) {
      const list = s.fixes.get(key);
      if (list?.length) return nearest(list, near);
    }
    const frd = /^([A-Z]{2,5})(\d{3})(\d{3})$/.exec(key);
    if (frd) {
      const base = this.fix(frd[1], near);
      if (base) return destination(base, +frd[2], +frd[3]);
    }
    const apt = this.airport(key);
    return apt ? { lat: apt.lat, lon: apt.lon } : undefined;
  }

  runway(airportId: string, runwayId: string): NavRunway | undefined {
    const id = runwayId.trim().toUpperCase().replace(/^0/, "");
    return this.airport(airportId)?.runways.find((r) => r.id.toUpperCase().replace(/^0/, "") === id);
  }

  procedure(kind: "sids" | "stars", id: string): Procedure | undefined {
    const key = id.toUpperCase();
    for (const s of this.sources) {
      const p = s[kind].find((x) => x.id.toUpperCase() === key);
      if (p) return p;
    }
    return undefined;
  }

  suggest(prefix: string, limit = 12): string[] {
    const p = prefix.trim().toUpperCase();
    if (p.length < 2) return [];
    const out = new Set<string>();
    for (const s of this.sources) {
      for (const k of s.fixes.keys()) {
        if (k.startsWith(p)) out.add(k);
        if (out.size >= limit * 4) break;
      }
    }
    return [...out].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
  }

  /**
   * Turn a navigation path / route string into drawable points. Tokens that
   * are not known fixes (airways, speeds) are skipped; SID/STAR names expand
   * to their fixes. A `.RWY` suffix (ROBUC3.22L) is ignored.
   */
  routePoints(route: string, near?: LatLon): { name: string; pos: LatLon }[] {
    const pts: { name: string; pos: LatLon }[] = [];
    let ref = near;
    const push = (name: string) => {
      const pos = this.fix(name, ref);
      if (pos && (!ref || distanceNm(ref, pos) < 1500)) {
        pts.push({ name, pos });
        ref = pos;
      }
    };
    for (const raw of route.toUpperCase().split(/\s+/)) {
      const tok = raw.split(".")[0].split("/")[0];
      if (!tok || tok === "DCT") continue;
      const proc = this.procedure("stars", tok) ?? this.procedure("sids", tok);
      if (proc) {
        const last = pts[pts.length - 1]?.name;
        const trans = proc.transitions.find((t) => last && t.includes(last));
        const seq = [...(trans ? trans.slice(trans.indexOf(last!) + 1) : []), ...proc.body];
        for (const f of seq) if (f !== pts[pts.length - 1]?.name) push(f);
        continue;
      }
      push(tok);
    }
    return pts;
  }
}

function nearest(list: LatLon[], near?: LatLon): LatLon {
  if (!near || list.length === 1) return list[0];
  let best = list[0];
  let bestD = Infinity;
  for (const p of list) {
    const d = distanceNm(near, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
