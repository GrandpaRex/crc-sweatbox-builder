import { parseSctCoord } from "../core/geo";
import { addAirport, addFix, emptyNavSet, type NavSet } from "./nav";

function latLon(tokens: string[]): { lat: number; lon: number } | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!/^[NS]/i.test(tokens[i])) continue;
    const lat = parseSctCoord(tokens[i]);
    const lon = parseSctCoord(tokens[i + 1]);
    if (lat !== null && lon !== null) return { lat, lon };
  }
  return null;
}

/** VRC / EuroScope sector file (.sct, .sct2): airports, fixes, navaids, runways. */
export function parseSct(text: string, label: string): NavSet {
  const set = emptyNavSet(label);
  let section = "";
  const runwayLines: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const head = /^\[([A-Z ]+)\]/i.exec(line);
    if (head) {
      section = head[1].toUpperCase();
      continue;
    }
    const tok = line.split(/\s+/);
    if (section === "RUNWAY") {
      if (tok.length >= 8) runwayLines.push(tok);
    } else if (section === "AIRPORT") {
      const pos = latLon(tok);
      if (pos) {
        const id = tok[0].toUpperCase();
        addAirport(set, { faaId: "", icaoId: id, name: id, elevation: 0, runways: [], ...pos });
        addFix(set, id, pos);
      }
    } else if (section === "FIXES" || section === "VOR" || section === "NDB") {
      const pos = latLon(tok);
      if (pos && tok[0].length <= 10) addFix(set, tok[0], pos);
    }
  }
  // Runway lines: ID1 ID2 HDG1 HDG2 LAT1 LON1 LAT2 LON2 [AIRPORT]
  const soleAirport = set.airportCount === 1 ? [...set.airports.keys()][0] : "";
  for (const t of runwayLines) {
    const a = latLon(t.slice(4, 6));
    const b = latLon(t.slice(6, 8));
    const apt = (t[8] ?? soleAirport).toUpperCase();
    if (!a || !b || !apt) continue;
    addAirport(set, {
      faaId: "",
      icaoId: apt,
      name: apt,
      elevation: 0,
      lat: a.lat,
      lon: a.lon,
      runways: [
        { id: t[0].toUpperCase(), heading: +t[2] || 0, lat: a.lat, lon: a.lon, endLat: b.lat, endLon: b.lon },
        { id: t[1].toUpperCase(), heading: +t[3] || 0, lat: b.lat, lon: b.lon, endLat: a.lat, endLon: a.lon },
      ],
    });
  }
  return set;
}

/** EuroScope .ese: only the SID/STAR definitions are used. */
export function parseEse(text: string, label: string): NavSet {
  const set = emptyNavSet(label);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    const m = /^(SID|STAR):([^:]+):([^:]+):([^:]+):(.*)$/i.exec(line);
    if (!m) continue;
    const proc = {
      id: m[4].trim().toUpperCase(),
      airport: m[2].trim().toUpperCase(),
      runway: m[3].trim().toUpperCase(),
      body: m[5].trim().toUpperCase().split(/\s+/).filter(Boolean),
      transitions: [],
    };
    (m[1].toUpperCase() === "SID" ? set.sids : set.stars).push(proc);
  }
  return set;
}
