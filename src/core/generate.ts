import type { FlightPlan, Rule, ScenarioAircraft, StartingConditions } from "./types";
import type { FleetEntry } from "../data/vnas";
import { Rng, hashString } from "./rng";
import { ulid } from "./ulid";

export const DEFAULT_FLEET: FleetEntry[] = [
  { airline: "AAL", weight: 5, types: ["B738", "A321", "A319"] },
  { airline: "DAL", weight: 5, types: ["B739", "A321", "A320", "B752"] },
  { airline: "UAL", weight: 5, types: ["B738", "B739", "A320"] },
  { airline: "SWA", weight: 5, types: ["B737", "B738", "B38M"] },
  { airline: "JBU", weight: 2, types: ["A320", "A321", "BCS3"] },
  { airline: "SKW", weight: 3, types: ["CRJ7", "E75L", "CRJ2"] },
  { airline: "RPA", weight: 2, types: ["E75L", "E170"] },
  { airline: "NKS", weight: 1, types: ["A320", "A20N"] },
  { airline: "ASA", weight: 1, types: ["B739", "B738"] },
  { airline: "FDX", weight: 1, types: ["B763", "B752", "MD11"] },
  { airline: "UPS", weight: 1, types: ["B763", "B752", "A306"] },
];

export interface GenContext {
  /** Fleet configured for an airport in vNAS (by FAA id). */
  airportFleet: (airportId: string) => FleetEntry[] | undefined;
  /** Parking spot names for an airport, or undefined when its map is not loaded. */
  parking: (airportId: string) => string[] | undefined;
  usedCallsigns: Set<string>;
  /** Keys of the form `BOS:A1`. */
  usedParking: Set<string>;
}

export interface GenResult {
  aircraft: ScenarioAircraft[];
  warnings: string[];
}

export interface ParsedFlight {
  departure: string;
  destination: string;
  altitude: number;
  route: string;
}

/** `350`, `FL350` and `35000` all mean 35,000 ft. */
export function parseAltitude(text: string): number {
  const n = parseInt(text.replace(/^FL/i, ""), 10);
  if (!Number.isFinite(n)) return 0;
  return n < 1000 ? n * 100 : n;
}

export function parseFlights(text: string): { flights: ParsedFlight[]; errors: string[] } {
  const flights: ParsedFlight[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const t = line.split(/\s+/);
    if (t.length < 3 || !/^(FL)?\d+$/i.test(t[2])) {
      errors.push(`Flight line ${i + 1}: expected "DEP DEST ALT ROUTE", got "${line}"`);
      return;
    }
    flights.push({
      departure: t[0].toUpperCase(),
      destination: t[1].toUpperCase(),
      altitude: parseAltitude(t[2]),
      route: t.slice(3).join(" ").toUpperCase(),
    });
  });
  return { flights, errors };
}

export function parseFleet(text: string): FleetEntry[] {
  const out: FleetEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9]{1,4})\s*:\s*([^@]+?)(?:@\s*(\d+(?:\.\d+)?))?\s*$/.exec(raw);
    if (!m) continue;
    const types = m[2].split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (types.length) out.push({ airline: m[1].toUpperCase(), weight: m[3] ? +m[3] : 1, types });
  }
  return out;
}

function matchesFilter(name: string, filter: string): boolean {
  const pats = filter.split(",").map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return true;
  return pats.some((p) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*#]/g, ".*") + "$", "i");
    return re.test(name);
  });
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeCallsign(rng: Rng, airline: string, used: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    let cs: string;
    if (airline === "N") {
      // US registration: N + 1-3 digits + two letters
      cs = "N" + rng.int(1, 9) + String(rng.int(0, 99)).padStart(2, "0") + rng.pick([...LETTERS]) + rng.pick([...LETTERS]);
    } else {
      const digits = rng.weighted([3, 4, 2], (d) => (d === 3 ? 3 : d === 4 ? 5 : 1));
      cs = airline + rng.int(10 ** (digits - 1), 10 ** digits - 1);
    }
    if (!used.has(cs)) {
      used.add(cs);
      return cs;
    }
  }
  const fallback = airline + Date.now().toString().slice(-4);
  used.add(fallback);
  return fallback;
}

const icao = (faaOrIcao: string) => {
  const id = faaOrIcao.trim().toUpperCase();
  return id.length === 3 && /^[A-Z]+$/.test(id) ? "K" + id : id;
};

export function generateRule(rule: Rule, ctx: GenContext, seed: number): GenResult {
  const warnings: string[] = [];
  const aircraft: ScenarioAircraft[] = [];
  const rng = new Rng(seed ^ hashString(rule.id));
  const tag = `Rule "${rule.name}"`;

  const { flights, errors } = parseFlights(rule.flights);
  warnings.push(...errors.map((e) => `${tag}: ${e}`));

  let fleet = rule.fleetSource === "custom" ? parseFleet(rule.fleetText) : (ctx.airportFleet(rule.airportId) ?? []);
  if (!fleet.length) {
    if (rule.fleetSource === "custom") warnings.push(`${tag}: custom fleet is empty, using the built-in default fleet`);
    fleet = DEFAULT_FLEET;
  }

  // Parking spots are handed out without repeats across the whole scenario.
  let freeSpots: string[] = [];
  if (rule.startType === "Parking") {
    const all = ctx.parking(rule.airportId);
    if (!all) {
      warnings.push(`${tag}: no airport map loaded for ${rule.airportId || "?"}, cannot assign parking`);
    } else {
      const matching = all.filter((n) => matchesFilter(n, rule.parkingFilter));
      freeSpots = rng.shuffle(matching.filter((n) => !ctx.usedParking.has(`${rule.airportId}:${n}`)));
      if (freeSpots.length < rule.count) {
        warnings.push(
          `${tag}: wanted ${rule.count} parking spots but only ${freeSpots.length} free ` +
            `(${matching.length} match the filter)`,
        );
      }
    }
  }

  const commands = rule.presetCommands.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let clock = rule.startOffset;

  for (let i = 0; i < rule.count; i++) {
    const start: StartingConditions = { type: rule.startType };
    if (rule.startType === "Parking") {
      const spot = freeSpots.shift();
      if (!spot) break;
      ctx.usedParking.add(`${rule.airportId}:${spot}`);
      start.parking = spot;
    } else if (rule.startType === "OnRunway") {
      start.runway = rule.runway.toUpperCase();
    } else if (rule.startType === "OnFinal") {
      start.runway = rule.runway.toUpperCase();
      start.distanceFromRunway = rule.distanceFromRunway;
      if (rule.speed) start.speed = rule.speed;
    } else {
      // FixOrFrd
      start.fix = rule.fix.toUpperCase();
      start.altitude = rule.altitude;
      if (rule.speed) start.speed = rule.speed;
      if (rule.navigationPath.trim()) start.navigationPath = rule.navigationPath.trim().toUpperCase();
    }

    const entry = rng.weighted(fleet, (f) => f.weight);
    const type = rng.pick(entry.types);
    const callsign = makeCallsign(rng, entry.airline || "N", ctx.usedCallsigns);
    const fullType = type.includes("/") ? type : type + rule.equipmentSuffix;

    const f = flights.length ? flights[i % flights.length] : undefined;
    const apt = icao(rule.airportId);
    const plan: FlightPlan = {
      rules: rule.flightRules,
      departure: f?.departure ?? (rule.kind === "departure" ? apt : ""),
      destination: f?.destination ?? (rule.kind === "arrival" ? apt : ""),
      cruiseAltitude: f?.altitude ?? rule.altitude ?? 0,
      cruiseSpeed: 0,
      route: f?.route ?? "",
      remarks: rule.remarks,
      aircraftType: fullType,
    };

    const ac: ScenarioAircraft = {
      id: ulid(),
      aircraftId: callsign,
      aircraftType: fullType,
      transponderMode: "C",
      startingConditions: start,
      onAltitudeProfile: rule.startType === "FixOrFrd" ? rule.onAltitudeProfile : false,
      flightplan: plan,
      presetCommands: commands.map((command) => ({ id: ulid(), command, timeOffset: 0 })),
      airportId: rule.airportId.toUpperCase() || undefined,
      difficulty: rule.difficulty || "Easy",
    };
    const delay = Math.max(0, Math.round(clock));
    if (delay > 0) ac.spawnDelay = delay;
    if (rule.expectedApproach.trim()) ac.expectedApproach = rule.expectedApproach.trim().toUpperCase();
    if (rule.autoTrackPositionId) {
      ac.autoTrackConditions = { positionId: rule.autoTrackPositionId };
      if (rule.handoffDelay != null) ac.autoTrackConditions.handoffDelay = rule.handoffDelay;
      if (rule.scratchPad.trim()) ac.autoTrackConditions.scratchPad = rule.scratchPad.trim().toUpperCase();
    }
    aircraft.push(ac);

    const spread = (rule.interval * rule.jitterPct) / 100;
    clock += rule.interval + (spread ? (rng.next() * 2 - 1) * spread : 0);
  }

  if (flights.length === 0 && !errors.length) {
    warnings.push(`${tag}: no flight plans listed, aircraft have an empty route`);
  }
  return { aircraft, warnings };
}

export function newRule(kind: Rule["kind"], airportId: string): Rule {
  const apt = icao(airportId || "XXX");
  const base: Rule = {
    id: ulid(),
    name: "",
    kind,
    enabled: true,
    airportId: airportId.toUpperCase(),
    count: 10,
    startOffset: 0,
    interval: 0,
    jitterPct: 0,
    startType: "Parking",
    parkingFilter: "",
    runway: "",
    distanceFromRunway: 10,
    fix: "",
    altitude: 11000,
    speed: 250,
    navigationPath: "",
    onAltitudeProfile: true,
    flightRules: "IFR",
    flights: "",
    fleetSource: "airport",
    fleetText: "AAL: B738, A321 @3\nSKW: CRJ7, E75L @2\nN: C172, PA28, SR22 @1",
    equipmentSuffix: "/L",
    remarks: "/v/",
    autoTrackPositionId: "",
    handoffDelay: null,
    scratchPad: "",
    expectedApproach: "",
    difficulty: "Easy",
    presetCommands: "",
  };
  if (kind === "departure") {
    return { ...base, name: "Departures", flights: `${apt} KORD 360 \n${apt} KATL 340 ` };
  }
  if (kind === "arrival") {
    return {
      ...base,
      name: "Arrivals",
      startType: "FixOrFrd",
      count: 12,
      interval: 180,
      jitterPct: 20,
      flights: `KORD ${apt} 350 \nKATL ${apt} 370 `,
    };
  }
  return {
    ...base,
    name: "Overflights",
    startType: "FixOrFrd",
    count: 8,
    interval: 300,
    jitterPct: 30,
    altitude: 35000,
    speed: 0,
    onAltitudeProfile: false,
    fleetSource: "custom",
    flights: "KJFK KLAX 350 \nKBOS KDFW 370 ",
  };
}
