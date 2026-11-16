import type { Scenario } from "./types";
import type { NavDb } from "../data/nav";
import { isUlid } from "./ulid";

export interface Issue {
  level: "error" | "warn";
  message: string;
  aircraftId?: string;
}

export interface ValidationData {
  nav: NavDb;
  positionIds?: Set<string>;
  parking: (airportId: string) => string[] | undefined;
}

export function validate(s: Scenario, data: ValidationData): Issue[] {
  const out: Issue[] = [];
  const err = (message: string, aircraftId?: string) => out.push({ level: "error", message, aircraftId });
  const warn = (message: string, aircraftId?: string) => out.push({ level: "warn", message, aircraftId });

  if (!s.name.trim()) err("Scenario has no name");
  if (!s.artccId) err("No ARTCC selected");
  if (!s.primaryAirportId) warn("No primary airport set");
  if (!s.studentPositionId) warn("No student position selected");
  else if (data.positionIds && !data.positionIds.has(s.studentPositionId)) {
    err("Student position is not a position in the loaded ARTCC");
  }
  if (!s.aircraft.length && !s.aircraftGenerators.length) warn("Scenario has no aircraft");

  for (const atc of s.atc) {
    if (data.positionIds && !data.positionIds.has(atc.positionId)) {
      err(`ATC entry references unknown position ${atc.positionId}`);
    }
  }

  const callsigns = new Map<string, number>();
  const spots = new Map<string, string>();
  const near = s.primaryAirportId ? data.nav.fix(s.primaryAirportId) : undefined;

  for (const a of s.aircraft) {
    const cs = a.aircraftId || "(no callsign)";
    if (!isUlid(a.id)) err(`${cs}: id is not a valid ULID`, a.id);
    if (!/^[A-Z0-9]{2,7}$/.test(a.aircraftId)) err(`${cs}: callsign must be 2-7 letters/digits`, a.id);
    callsigns.set(a.aircraftId, (callsigns.get(a.aircraftId) ?? 0) + 1);
    if (!a.aircraftType) err(`${cs}: no aircraft type`, a.id);

    const st = a.startingConditions;
    if (st.type === "Parking") {
      if (!st.parking) err(`${cs}: parking spot not set`, a.id);
      else {
        const key = `${a.airportId}:${st.parking}`;
        if (spots.has(key)) warn(`${cs}: shares parking ${st.parking} with ${spots.get(key)}`, a.id);
        spots.set(key, cs);
        const known = a.airportId ? data.parking(a.airportId) : undefined;
        if (known && !known.includes(st.parking)) {
          err(`${cs}: parking "${st.parking}" does not exist on the ${a.airportId} airport map`, a.id);
        }
      }
      if (!a.airportId) err(`${cs}: parked aircraft need an airport`, a.id);
    } else if (st.type === "FixOrFrd") {
      if (!st.fix) err(`${cs}: starting fix not set`, a.id);
      else if (data.nav.loaded && !data.nav.fix(st.fix, near)) warn(`${cs}: fix "${st.fix}" not found in nav data`, a.id);
      if (!st.altitude) warn(`${cs}: no starting altitude`, a.id);
    } else if (st.type === "Coordinates") {
      if (!st.coordinates) err(`${cs}: coordinates not set`, a.id);
      if (!st.altitude) warn(`${cs}: no starting altitude`, a.id);
    } else if (st.type === "OnFinal" || st.type === "OnRunway") {
      if (!st.runway) err(`${cs}: runway not set`, a.id);
      else if (a.airportId && data.nav.airport(a.airportId)?.runways.length && !data.nav.runway(a.airportId, st.runway)) {
        warn(`${cs}: runway ${st.runway} not found at ${a.airportId}`, a.id);
      }
      if (st.type === "OnFinal" && !st.distanceFromRunway) err(`${cs}: distance from runway not set`, a.id);
      if (!a.airportId) err(`${cs}: needs an airport for runway ${st.runway ?? ""}`, a.id);
    }

    if (a.flightplan) {
      const fp = a.flightplan;
      if (fp.rules === "IFR" && (!fp.departure || !fp.destination)) {
        warn(`${cs}: IFR flight plan is missing departure or destination`, a.id);
      }
    }
    if (a.autoTrackConditions && data.positionIds && !data.positionIds.has(a.autoTrackConditions.positionId)) {
      err(`${cs}: auto-track position is not in the loaded ARTCC`, a.id);
    }
  }
  for (const [cs, n] of callsigns) if (n > 1) err(`Callsign ${cs} is used ${n} times`);
  return out;
}
