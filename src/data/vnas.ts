import type { LatLon, Scenario } from "../core/types";
import { decodeNavData } from "./protobuf";
import type { NavSet } from "./nav";

export interface Position {
  id: string;
  name: string;
  callsign: string;
  radioName: string;
  frequency: number;
  facilityId: string;
  facilityName: string;
  facilityType: string;
}

export interface Facility {
  id: string;
  name: string;
  type: string;
}

export interface ArtccData {
  id: string;
  facilities: Facility[];
  positions: Position[];
}

export interface FleetEntry {
  airline: string;
  weight: number;
  types: string[];
}

export interface TrainingAirport {
  id: string;
  artccId: string;
  fleet: FleetEntry[];
}

export interface MapPoint extends LatLon {
  name: string;
  heading?: number;
}

export interface AirportMap {
  airportId: string;
  parking: MapPoint[];
  spots: MapPoint[];
  runways: { name: string; line: LatLon[] }[];
  taxiways: { name: string; line: LatLon[] }[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  primaryAirportId?: string;
  artccId: string;
}

export const ARTCC_IDS = [
  "ZAB", "ZAN", "ZAU", "ZBW", "ZDC", "ZDV", "ZFW", "ZHN", "ZHU", "ZID", "ZJX", "ZKC",
  "ZLA", "ZLC", "ZMA", "ZME", "ZMP", "ZNY", "ZOA", "ZOB", "ZSE", "ZSU", "ZTL", "ZUA",
];

// ---- parsers (shared by network fetch and manual file loading) ----

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseArtcc(json: any): ArtccData {
  if (!json?.facility?.id) throw new Error("Not a vNAS ARTCC file (no facility)");
  const facilities: Facility[] = [];
  const positions: Position[] = [];
  const walk = (f: any) => {
    facilities.push({ id: f.id, name: f.name, type: f.type });
    for (const p of f.positions ?? []) {
      positions.push({
        id: p.id,
        name: p.name,
        callsign: p.callsign ?? "",
        radioName: p.radioName ?? "",
        frequency: p.frequency ?? 0,
        facilityId: f.id,
        facilityName: f.name,
        facilityType: f.type,
      });
    }
    for (const c of f.childFacilities ?? []) walk(c);
  };
  walk(json.facility);
  return { id: json.id ?? json.facility.id, facilities, positions };
}

export function parseTrainingAirports(json: any): TrainingAirport[] {
  if (!Array.isArray(json)) throw new Error("Not a training airport list");
  return json
    .filter((a) => a && typeof a.id === "string")
    .map((a) => ({
      id: a.id,
      artccId: a.artccId ?? "",
      fleet: (a.trainingAircraftSets ?? [])
        .filter((s: any) => s.aircraftTypeCodes?.length)
        .map((s: any) => ({ airline: s.airlineIcaoCode ?? "", weight: s.weight ?? 1, types: s.aircraftTypeCodes })),
    }));
}

export function parseAirportMap(json: any, airportId: string): AirportMap {
  if (json?.type !== "FeatureCollection") throw new Error("Not a GeoJSON FeatureCollection");
  const map: AirportMap = { airportId, parking: [], spots: [], runways: [], taxiways: [] };
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const g = f.geometry ?? {};
    const name = String(p.name ?? "");
    if (g.type === "Point") {
      const pt: MapPoint = { name, lon: g.coordinates[0], lat: g.coordinates[1] };
      if (p.heading != null && p.heading !== "") pt.heading = +p.heading;
      if (p.type === "parking") map.parking.push(pt);
      else if (p.type === "spot") map.spots.push(pt);
    } else if (g.type === "LineString") {
      const line = g.coordinates.map((c: number[]) => ({ lon: c[0], lat: c[1] }));
      if (p.type === "runway") map.runways.push({ name, line });
      else if (p.type === "taxiway") map.taxiways.push({ name, line });
    }
  }
  return map;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- network (through the dev-server proxy, or a user-supplied base URL) ----

export class VnasClient {
  constructor(public base: string) {}

  private async get(path: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.base.replace(/\/$/, "") + path);
    } catch {
      throw new Error(`Could not reach vNAS (${path}). Check your connection and try again.`);
    }
    const type = res.headers.get("content-type") ?? "";
    // A static host answers unknown paths with its own index.html.
    if (!res.ok || type.includes("text/html")) {
      throw new Error(`vNAS request failed (${res.status}) for ${path}`);
    }
    return res;
  }

  async artcc(id: string): Promise<ArtccData> {
    return parseArtcc(await (await this.get(`/api/artccs/${id}`)).json());
  }
  async trainingAirports(): Promise<TrainingAirport[]> {
    return parseTrainingAirports(await (await this.get(`/api/training/airports`)).json());
  }
  async airportMap(faaId: string): Promise<AirportMap> {
    return parseAirportMap(await (await this.get(`/api/training/airports/${faaId}/map`)).json(), faaId);
  }
  async navData(): Promise<NavSet> {
    const buf = await (await this.get(`/Files/NavData.dat`)).arrayBuffer();
    return decodeNavData(new Uint8Array(buf));
  }
  async scenarioSummaries(artccId: string): Promise<ScenarioSummary[]> {
    return (await this.get(`/api/training/scenario-summaries/by-artcc/${artccId}`)).json();
  }
  async scenario(id: string): Promise<Scenario> {
    return (await this.get(`/api/training/scenarios/${id}`)).json();
  }
}
