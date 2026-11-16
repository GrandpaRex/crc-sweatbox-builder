import { useSyncExternalStore } from "react";
import type { Project, Rule, Scenario, ScenarioAircraft } from "../core/types";
import { newProject, projectFromScenario, regenerate } from "../core/project";
import { NavDb, type NavSet } from "../data/nav";
import { decodeNavData } from "../data/protobuf";
import { parseEse, parseSct } from "../data/sector";
import {
  VnasClient,
  parseAirportMap,
  parseArtcc,
  parseTrainingAirports,
  type AirportMap,
  type ArtccData,
  type ScenarioSummary,
  type TrainingAirport,
} from "../data/vnas";

export type Page = "setup" | "positions" | "traffic" | "aircraft" | "extras" | "export";

export interface LogEntry {
  level: "info" | "error";
  text: string;
}

export interface State {
  project: Project;
  page: Page;
  selectedAircraftId: string | null;
  selectedRuleId: string | null;
  artcc: ArtccData | null;
  trainingAirports: TrainingAirport[];
  maps: Record<string, AirportMap>;
  mapStatus: Record<string, "loading" | "failed">;
  vnasNav: NavSet | null;
  sectorNavs: NavSet[];
  nav: NavDb;
  summaries: ScenarioSummary[];
  genWarnings: string[];
  log: LogEntry[];
  busy: string | null;
  vnasBase: string;
}

const PROJECT_KEY = "csb.project.v1";
const BASE_KEY = "csb.vnasBase";

function loadSaved(): Project {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p?.version === 1 && p.scenario) return p;
    }
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return newProject();
}

function savedBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) || "/vnas";
  } catch {
    return "/vnas";
  }
}

let state: State = {
  project: loadSaved(),
  page: "setup",
  selectedAircraftId: null,
  selectedRuleId: null,
  artcc: null,
  trainingAirports: [],
  maps: {},
  mapStatus: {},
  vnasNav: null,
  sectorNavs: [],
  nav: new NavDb([]),
  summaries: [],
  genWarnings: [],
  log: [],
  busy: null,
  vnasBase: savedBase(),
};

const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const getState = () => state;

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  const prev = state;
  state = { ...state, ...p };
  if (state.vnasNav !== prev.vnasNav || state.sectorNavs !== prev.sectorNavs) {
    // Sector files first, vNAS nav database as the fallback.
    state.nav = new NavDb([...state.sectorNavs, ...(state.vnasNav ? [state.vnasNav] : [])]);
  }
  if (state.project !== prev.project) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_KEY, JSON.stringify(state.project));
      } catch {
        /* ignore quota errors */
      }
    }, 300);
  }
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

const log = (text: string, level: LogEntry["level"] = "info") =>
  setState((s) => ({ log: [{ level, text }, ...s.log].slice(0, 30) }));

const client = () => new VnasClient(state.vnasBase);

async function task<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  setState({ busy: label });
  try {
    return await fn();
  } catch (e) {
    log(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    setState({ busy: null });
  }
}

// ---- project edits ----

export const setProject = (fn: (p: Project) => Project) => setState((s) => ({ project: fn(s.project) }));

export const updateScenario = (patch: Partial<Scenario>) =>
  setProject((p) => ({ ...p, scenario: { ...p.scenario, ...patch } }));

export function updateAircraft(id: string, fn: (a: ScenarioAircraft) => ScenarioAircraft) {
  setProject((p) => {
    // A hand-edited aircraft is detached from its rule so regenerating keeps it.
    const { [id]: _detached, ...generatedBy } = p.generatedBy;
    return {
      ...p,
      generatedBy,
      scenario: { ...p.scenario, aircraft: p.scenario.aircraft.map((a) => (a.id === id ? fn(a) : a)) },
    };
  });
}

export function removeAircraft(ids: string[]) {
  const set = new Set(ids);
  setProject((p) => ({ ...p, scenario: { ...p.scenario, aircraft: p.scenario.aircraft.filter((a) => !set.has(a.id)) } }));
  if (state.selectedAircraftId && set.has(state.selectedAircraftId)) setState({ selectedAircraftId: null });
}

export const addAircraft = (a: ScenarioAircraft) => {
  setProject((p) => ({ ...p, scenario: { ...p.scenario, aircraft: [...p.scenario.aircraft, a] } }));
  setState({ selectedAircraftId: a.id });
};

export const updateRule = (id: string, patch: Partial<Rule>) =>
  setProject((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

export function addRule(rule: Rule) {
  setProject((p) => ({ ...p, rules: [...p.rules, rule] }));
  setState({ selectedRuleId: rule.id });
}

export function removeRule(id: string) {
  setProject((p) => {
    const generatedBy = { ...p.generatedBy };
    const aircraft = p.scenario.aircraft.filter((a) => generatedBy[a.id] !== id);
    for (const k of Object.keys(generatedBy)) if (generatedBy[k] === id) delete generatedBy[k];
    return { ...p, rules: p.rules.filter((r) => r.id !== id), generatedBy, scenario: { ...p.scenario, aircraft } };
  });
  if (state.selectedRuleId === id) setState({ selectedRuleId: null });
}

export const dataLookups = () => ({
  airportFleet: (id: string) => {
    const f = state.trainingAirports.find((a) => a.id === id.toUpperCase())?.fleet;
    return f?.length ? f : undefined;
  },
  parking: (id: string) => state.maps[id.toUpperCase()]?.parking.map((p) => p.name),
});

export function runGenerate(ruleId?: string, reshuffle = false) {
  const base = reshuffle ? { ...state.project, seed: Math.floor(Math.random() * 1e9) } : state.project;
  const res = regenerate(base, dataLookups(), ruleId);
  setState({ project: res.project, genWarnings: res.warnings });
}

export function replaceProject(p: Project, note: string) {
  setState({ project: p, selectedAircraftId: null, selectedRuleId: null, genWarnings: [] });
  log(note);
  if (p.scenario.artccId && state.artcc?.id !== p.scenario.artccId) void loadArtcc(p.scenario.artccId);
}

// ---- data loading ----

export function setVnasBase(base: string) {
  setState({ vnasBase: base });
  try {
    localStorage.setItem(BASE_KEY, base);
  } catch {
    /* ignore */
  }
}

export async function loadArtcc(id: string) {
  await task(`Loading ${id} from vNAS`, async () => {
    const [artcc, airports] = await Promise.all([client().artcc(id), client().trainingAirports()]);
    setState({ artcc, trainingAirports: airports, mapStatus: {} });
    if (state.project.scenario.artccId !== artcc.id) updateScenario({ artccId: artcc.id });
    log(`Loaded ${artcc.id}: ${artcc.positions.length} positions, ${airports.filter((a) => a.artccId === artcc.id).length} training airports`);
  });
}

export async function loadVnasNav() {
  await task("Downloading vNAS nav database", async () => {
    const nav = await client().navData();
    setState({ vnasNav: nav });
    log(`vNAS nav database: ${nav.fixCount.toLocaleString()} fixes, ${nav.airportCount.toLocaleString()} airports`);
  });
}

export async function loadSummaries() {
  const id = state.project.scenario.artccId;
  if (!id) return;
  await task("Loading scenario list", async () => {
    const list = await client().scenarioSummaries(id);
    setState({ summaries: list.sort((a, b) => a.name.localeCompare(b.name)) });
  });
}

export async function importVnasScenario(id: string) {
  await task("Loading scenario", async () => {
    const s = await client().scenario(id);
    replaceProject(projectFromScenario(s), `Imported "${s.name}" (${s.aircraft.length} aircraft)`);
  });
}

/** Fetch an airport's ground map once; quietly gives up if vNAS is unreachable. */
export async function ensureMap(faaId: string) {
  const id = faaId.toUpperCase();
  if (!id || state.maps[id] || state.mapStatus[id]) return;
  setState((s) => ({ mapStatus: { ...s.mapStatus, [id]: "loading" } }));
  try {
    const map = await client().airportMap(id);
    setState((s) => {
      const { [id]: _done, ...mapStatus } = s.mapStatus;
      return { maps: { ...s.maps, [id]: map }, mapStatus };
    });
  } catch {
    setState((s) => ({ mapStatus: { ...s.mapStatus, [id]: "failed" } }));
  }
}

export async function loadFiles(files: File[]) {
  for (const file of files) {
    const name = file.name;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    try {
      if (ext === "sct" || ext === "sct2") {
        const set = parseSct(await file.text(), name);
        setState((s) => ({ sectorNavs: [...s.sectorNavs.filter((n) => n.label !== name), set] }));
        log(`${name}: ${set.fixCount.toLocaleString()} fixes, ${set.airportCount} airports`);
      } else if (ext === "ese") {
        const set = parseEse(await file.text(), name);
        setState((s) => ({ sectorNavs: [...s.sectorNavs.filter((n) => n.label !== name), set] }));
        log(`${name}: ${set.sids.length} SIDs, ${set.stars.length} STARs`);
      } else if (ext === "dat") {
        const nav = decodeNavData(new Uint8Array(await file.arrayBuffer()), name);
        if (!nav.fixCount) throw new Error("no fixes found, is this NavData.dat?");
        setState({ vnasNav: nav });
        log(`${name}: ${nav.fixCount.toLocaleString()} fixes, ${nav.airportCount.toLocaleString()} airports`);
      } else if (ext === "json" || ext === "geojson") {
        const json = JSON.parse(await file.text());
        if (json?.version === 1 && json.scenario && json.rules) {
          replaceProject(json as Project, `Opened project ${name}`);
        } else if (json?.facility) {
          const artcc = parseArtcc(json);
          setState({ artcc });
          updateScenario({ artccId: artcc.id });
          log(`${name}: ${artcc.id}, ${artcc.positions.length} positions`);
        } else if (json?.type === "FeatureCollection") {
          const id = (String(json.name ?? name).match(/^[A-Za-z0-9]{3,4}/)?.[0] ?? "").toUpperCase();
          const map = parseAirportMap(json, id);
          setState((s) => ({ maps: { ...s.maps, [id]: map } }));
          log(`${name}: ${id} airport map, ${map.parking.length} parking spots`);
        } else if (Array.isArray(json)) {
          const airports = parseTrainingAirports(json);
          setState({ trainingAirports: airports });
          log(`${name}: ${airports.length} training airports`);
        } else if (json?.aircraft && json.artccId) {
          replaceProject(projectFromScenario(json as Scenario), `Imported scenario "${json.name}" from ${name}`);
        } else {
          throw new Error("unrecognised JSON");
        }
      } else {
        throw new Error("unsupported file type");
      }
    } catch (e) {
      log(`${name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  }
}
