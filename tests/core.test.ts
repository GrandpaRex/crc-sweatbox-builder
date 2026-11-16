import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { generateRule, newRule, parseAltitude, parseFleet, parseFlights, type GenContext } from "../src/core/generate";
import { cleanScenario, newProject, projectFromScenario, regenerate } from "../src/core/project";
import { validate } from "../src/core/validate";
import { isUlid, ulid } from "../src/core/ulid";
import { bearing, destination, distanceNm, parseSctCoord } from "../src/core/geo";
import { aircraftPosition } from "../src/core/position";
import { NavDb, addAirport, addFix, emptyNavSet } from "../src/data/nav";
import { decodeNavData } from "../src/data/protobuf";
import { parseEse, parseSct } from "../src/data/sector";
import { parseAirportMap } from "../src/data/vnas";
import type { Scenario } from "../src/core/types";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const bosMap = parseAirportMap(fixture("BOS_map.geojson"), "BOS");

const ctx = (): GenContext => ({
  airportFleet: () => undefined,
  parking: (id) => (id === "BOS" ? bosMap.parking.map((p) => p.name) : undefined),
  usedCallsigns: new Set(),
  usedParking: new Set(),
});

describe("basics", () => {
  test("ulid shape and ordering", () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(isUlid(a)).toBe(true);
    expect(a.length).toBe(26);
    expect(a < b).toBe(true);
  });
  test("altitude forms", () => {
    expect(parseAltitude("350")).toBe(35000);
    expect(parseAltitude("FL240")).toBe(24000);
    expect(parseAltitude("11000")).toBe(11000);
  });
  test("geo round trip", () => {
    const bos = { lat: 42.3629, lon: -71.0064 };
    const p = destination(bos, 90, 20);
    expect(distanceNm(bos, p)).toBeCloseTo(20, 1);
    expect(bearing(bos, p)).toBeCloseTo(90, 0);
    expect(parseSctCoord("N042.21.46.999")).toBeCloseTo(42.36305, 4);
    expect(parseSctCoord("W071.00.23.000")).toBeCloseTo(-71.00639, 4);
  });
  test("flight and fleet text", () => {
    const { flights, errors } = parseFlights("kbos kord 360 hylnd5 hylnd\n# comment\nbad line\nKBOS KATL FL340");
    expect(flights).toEqual([
      { departure: "KBOS", destination: "KORD", altitude: 36000, route: "HYLND5 HYLND" },
      { departure: "KBOS", destination: "KATL", altitude: 34000, route: "" },
    ]);
    expect(errors).toHaveLength(1);
    expect(parseFleet("AAL: B738, A321 @3\nN: C172")).toEqual([
      { airline: "AAL", weight: 3, types: ["B738", "A321"] },
      { airline: "N", weight: 1, types: ["C172"] },
    ]);
  });
});

describe("generation", () => {
  test("parked departures get unique real gates and callsigns", () => {
    const rule = { ...newRule("departure", "BOS"), count: 30, parkingFilter: "A*, B*" };
    const { aircraft, warnings } = generateRule(rule, ctx(), 42);
    expect(warnings).toEqual([]);
    expect(aircraft).toHaveLength(30);
    const gates = aircraft.map((a) => a.startingConditions.parking!);
    expect(new Set(gates).size).toBe(30);
    expect(gates.every((g) => /^[AB]/.test(g) && bosMap.parking.some((p) => p.name === g))).toBe(true);
    expect(new Set(aircraft.map((a) => a.aircraftId)).size).toBe(30);
    expect(aircraft[0].flightplan).toMatchObject({ departure: "KBOS", destination: "KORD", cruiseAltitude: 36000, rules: "IFR" });
    expect(aircraft[0].aircraftType).toMatch(/\/L$/);
    expect(aircraft[0].spawnDelay).toBeUndefined();
  });

  test("same seed gives the same traffic, different seed differs", () => {
    const rule = newRule("departure", "BOS");
    const strip = (r: ReturnType<typeof generateRule>) => r.aircraft.map((a) => [a.aircraftId, a.startingConditions.parking]);
    expect(strip(generateRule(rule, ctx(), 7))).toEqual(strip(generateRule(rule, ctx(), 7)));
    expect(strip(generateRule(rule, ctx(), 7))).not.toEqual(strip(generateRule(rule, ctx(), 8)));
  });

  test("arrival stream at a fix is spaced and tracked", () => {
    const rule = {
      ...newRule("arrival", "BOS"),
      count: 6,
      startOffset: 30,
      interval: 120,
      jitterPct: 0,
      fix: "robuc",
      altitude: 14000,
      speed: 250,
      navigationPath: "robuc robuc3.22l",
      autoTrackPositionId: "01G3CZTG1TFZZ4EB2PJ5P4MJ2X",
      handoffDelay: 60,
      expectedApproach: "i22l",
      presetCommands: "RNS\nWAIT 120 HO B1M",
    };
    const { aircraft } = generateRule(rule, ctx(), 1);
    expect(aircraft.map((a) => a.spawnDelay)).toEqual([30, 150, 270, 390, 510, 630]);
    expect(aircraft[0].startingConditions).toEqual({ type: "FixOrFrd", fix: "ROBUC", altitude: 14000, speed: 250, navigationPath: "ROBUC ROBUC3.22L" });
    expect(aircraft[0].onAltitudeProfile).toBe(true);
    expect(aircraft[0].autoTrackConditions).toEqual({ positionId: "01G3CZTG1TFZZ4EB2PJ5P4MJ2X", handoffDelay: 60 });
    expect(aircraft[0].expectedApproach).toBe("I22L");
    expect(aircraft[0].presetCommands.map((c) => c.command)).toEqual(["RNS", "WAIT 120 HO B1M"]);
    expect(aircraft[0].flightplan!.destination).toBe("KBOS");
  });

  test("warns when gates run out or no map is loaded", () => {
    const few = generateRule({ ...newRule("departure", "BOS"), count: 5, parkingFilter: "A1,A2" }, ctx(), 1);
    expect(few.aircraft).toHaveLength(2);
    expect(few.warnings[0]).toMatch(/only 2 free/);
    const none = generateRule(newRule("departure", "XYZ"), ctx(), 1);
    expect(none.aircraft).toHaveLength(0);
    expect(none.warnings[0]).toMatch(/no airport map/);
  });

  test("regenerate keeps manual aircraft and never reuses their gate", () => {
    let p = newProject();
    p.rules = [{ ...newRule("departure", "BOS"), count: 20 }];
    const data = { airportFleet: () => undefined, parking: ctx().parking };
    p = regenerate(p, data).project;
    expect(p.scenario.aircraft).toHaveLength(20);
    // Detach one (as a hand edit does) and regenerate.
    const manual = p.scenario.aircraft[0];
    delete p.generatedBy[manual.id];
    p = regenerate(p, data).project;
    expect(p.scenario.aircraft).toHaveLength(21);
    expect(p.scenario.aircraft[0]).toBe(manual);
    const gates = p.scenario.aircraft.map((a) => a.startingConditions.parking);
    expect(new Set(gates).size).toBe(21);
  });
});

describe("scenario round trip and validation", () => {
  const real = fixture("scenario_bos_app.json") as Scenario;

  test("a real vNAS scenario survives import and export unchanged", () => {
    const out = cleanScenario(projectFromScenario(real).scenario);
    expect(out).toEqual(real);
  });

  test("validation catches broken aircraft", () => {
    const nav = new NavDb([]);
    const s = structuredClone(real);
    s.aircraft[1].aircraftId = s.aircraft[0].aircraftId;
    s.aircraft[2].startingConditions = { type: "Parking", parking: "NOPE" };
    const issues = validate(s, { nav, parking: ctx().parking });
    expect(issues.some((i) => /used 2 times/.test(i.message))).toBe(true);
    expect(issues.some((i) => /"NOPE" does not exist/.test(i.message))).toBe(true);
    expect(validate(real, { nav, parking: ctx().parking }).filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("nav data", () => {
  test("sector file parsing and source priority", () => {
    const sct = parseSct(
      [
        "[AIRPORT]",
        "KBOS 128.800 N042.21.46.999 W071.00.23.000 B",
        "[VOR]",
        "BOS 112.700 N042.21.26.820 W070.59.22.370",
        "[FIXES]",
        "ROBUC N041.40.44.000 W071.35.06.000 ; comment",
        "[RUNWAY]",
        "04L 22R 035 215 N042.21.28.758 W071.00.51.619 N042.22.41.876 W071.00.16.250 KBOS",
      ].join("\n"),
      "test.sct",
    );
    expect(sct.fixCount).toBe(3);
    const vnas = emptyNavSet("vnas");
    addFix(vnas, "ROBUC", { lat: 1, lon: 1 });
    addFix(vnas, "ONLYV", { lat: 2, lon: 2 });
    addAirport(vnas, { faaId: "BOS", icaoId: "KBOS", name: "Logan", elevation: 20, lat: 42.36, lon: -71, runways: [] });
    const db = new NavDb([sct, vnas]);
    expect(db.fix("ROBUC")!.lat).toBeCloseTo(41.679, 2); // sector file wins
    expect(db.fix("ONLYV")).toEqual({ lat: 2, lon: 2 }); // falls back to vNAS
    expect(db.runway("BOS", "4L")!.heading).toBe(35); // FAA id resolves to the KBOS sector entry
    const frd = db.fix("BOS090020")!;
    expect(distanceNm(db.fix("BOS")!, frd)).toBeCloseTo(20, 1);
    const onFinal = aircraftPosition(
      { id: "x", aircraftId: "T1", aircraftType: "B738", transponderMode: "C", onAltitudeProfile: false, presetCommands: [], airportId: "BOS", startingConditions: { type: "OnFinal", runway: "22R", distanceFromRunway: 10 } },
      db,
      {},
    )!;
    expect(distanceNm(onFinal, db.runway("BOS", "22R")!)).toBeCloseTo(10, 1);
  });

  test("ese procedures", () => {
    const ese = parseEse("[SIDSSTARS]\nSTAR:KBOS:22L:ROBUC3:ROBUC PROVI JOODY\nSID:KBOS:09:LOGAN4:BOS", "t.ese");
    expect(ese.stars[0]).toMatchObject({ id: "ROBUC3", airport: "KBOS", runway: "22L", body: ["ROBUC", "PROVI", "JOODY"] });
    expect(ese.sids).toHaveLength(1);
  });

  test("decodes the vNAS protobuf nav format", () => {
    // Hand-encoded NavDataSet: one airport (with an unknown field to skip), one fix, one STAR.
    const enc = new TextEncoder();
    const dbl = (n: number) => new Uint8Array(new Float64Array([n]).buffer);
    const cat = (...p: (Uint8Array | number[])[]) => Uint8Array.from(p.flatMap((x) => [...x]));
    const str = (field: number, s: string) => cat([(field << 3) | 2, s.length], enc.encode(s));
    const msg = (field: number, body: Uint8Array) => cat([(field << 3) | 2, body.length], body);
    const geo = (lat: number, lon: number) => cat([0x09], dbl(lat), [0x11], dbl(lon));
    const runway = cat(str(1, "04L"), [0x11], dbl(19.7), msg(5, geo(42.35, -71.01)), msg(6, geo(42.37, -71.0)));
    const airport = cat(str(1, "BOS"), str(2, "KBOS"), str(3, "ZBW"), str(4, "LOGAN"), [0x29], dbl(19), msg(6, geo(42.36, -71.0)), msg(7, runway));
    const fix = cat(str(1, "ROBUC"), msg(2, geo(41.67, -71.58)));
    const star = cat(str(1, "ROBUC3"), msg(2, cat(str(1, "JFK"), str(1, "ROBUC"))), str(3, "ROBUC"), str(3, "PROVI"));
    const set = decodeNavData(cat(msg(1, airport), msg(2, fix), msg(5, star)));
    const db = new NavDb([set]);
    expect(db.airport("BOS")).toMatchObject({ icaoId: "KBOS", name: "LOGAN", elevation: 19, lat: 42.36 });
    expect(db.runway("BOS", "4L")).toMatchObject({ heading: 19.7, lat: 42.35, endLat: 42.37 });
    expect(db.fix("ROBUC")).toEqual({ lat: 41.67, lon: -71.58 });
    expect(set.stars[0]).toEqual({ id: "ROBUC3", body: ["ROBUC", "PROVI"], transitions: [["JFK", "ROBUC"]] });
    expect(db.routePoints("ROBUC ROBUC3.22L").map((p) => p.name)).toEqual(["ROBUC"]);
  });
});
