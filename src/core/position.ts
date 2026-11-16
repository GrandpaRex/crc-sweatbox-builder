import type { LatLon, ScenarioAircraft } from "./types";
import type { NavDb } from "../data/nav";
import type { AirportMap } from "../data/vnas";
import { destination } from "./geo";

/** Where an aircraft spawns, for the map preview. Undefined when unresolvable. */
export function aircraftPosition(
  a: ScenarioAircraft,
  nav: NavDb,
  maps: Record<string, AirportMap>,
  near?: LatLon,
): LatLon | undefined {
  const st = a.startingConditions;
  const apt = a.airportId ?? "";
  switch (st.type) {
    case "Coordinates":
      return st.coordinates;
    case "Parking": {
      const p = maps[apt]?.parking.find((x) => x.name === st.parking);
      return p ? { lat: p.lat, lon: p.lon } : undefined;
    }
    case "FixOrFrd":
      return st.fix ? nav.fix(st.fix, near) : undefined;
    case "OnRunway":
    case "OnFinal": {
      const rw = st.runway ? nav.runway(apt, st.runway) : undefined;
      if (!rw) return undefined;
      const thr = { lat: rw.lat, lon: rw.lon };
      return st.type === "OnRunway" ? thr : destination(thr, rw.heading + 180, st.distanceFromRunway ?? 0);
    }
  }
  return undefined;
}

export function describeStart(a: ScenarioAircraft): string {
  const st = a.startingConditions;
  const alt = st.altitude ? ` ${st.altitude >= 18000 ? "FL" + Math.round(st.altitude / 100) : st.altitude}` : "";
  switch (st.type) {
    case "Parking":
      return `Gate ${st.parking ?? "?"}`;
    case "FixOrFrd":
      return `${st.fix ?? "?"}${alt}`;
    case "Coordinates":
      return st.coordinates ? `${st.coordinates.lat.toFixed(3)}, ${st.coordinates.lon.toFixed(3)}${alt}` : "Coordinates ?";
    case "OnFinal":
      return `${st.distanceFromRunway ?? "?"} nm final ${st.runway ?? "?"}`;
    case "OnRunway":
      return `Runway ${st.runway ?? "?"}`;
  }
  return st.type;
}

export function fmtTime(sec: number | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
