import type { Project, Rule, Scenario, ScenarioAircraft } from "./types";
import { generateRule, type GenContext } from "./generate";
import { ulid } from "./ulid";

export function newScenario(): Scenario {
  return {
    id: ulid(),
    name: "New scenario",
    artccId: "",
    initializationTriggers: [],
    aircraftGenerators: [],
    aircraft: [],
    atc: [],
    autoDeleteMode: "None",
    flightStripConfigurations: [],
  };
}

export function newProject(): Project {
  return { version: 1, seed: Math.floor(Math.random() * 1e9), scenario: newScenario(), rules: [], generatedBy: {} };
}

/** Wrap an existing ATCTrainer scenario (all aircraft become manual). */
export function projectFromScenario(s: Scenario): Project {
  return {
    version: 1,
    seed: Math.floor(Math.random() * 1e9),
    scenario: {
      ...newScenario(),
      ...s,
      aircraft: (s.aircraft ?? []).map((a) => ({ ...a, presetCommands: a.presetCommands ?? [] })),
    },
    rules: [],
    generatedBy: {},
  };
}

export type DataLookups = Pick<GenContext, "airportFleet" | "parking">;

/**
 * Re-run every enabled rule. Aircraft that are not tied to a rule (manual, or
 * detached by editing) are kept and their callsigns / parking are reserved.
 */
export function regenerate(project: Project, data: DataLookups, onlyRuleId?: string): { project: Project; warnings: string[] } {
  const ruleIds = new Set(project.rules.map((r) => r.id));
  const keep = (a: ScenarioAircraft) => {
    const rid = project.generatedBy[a.id];
    if (!rid || !ruleIds.has(rid)) return true;
    return onlyRuleId ? rid !== onlyRuleId : false;
  };
  const kept = project.scenario.aircraft.filter(keep);
  const generatedBy: Record<string, string> = {};
  for (const a of kept) {
    const rid = project.generatedBy[a.id];
    if (rid && ruleIds.has(rid)) generatedBy[a.id] = rid;
  }
  const ctx: GenContext = {
    ...data,
    usedCallsigns: new Set(kept.map((a) => a.aircraftId)),
    usedParking: new Set(
      kept.filter((a) => a.startingConditions.parking).map((a) => `${a.airportId}:${a.startingConditions.parking}`),
    ),
  };
  const warnings: string[] = [];
  const added: ScenarioAircraft[] = [];
  for (const rule of project.rules) {
    if (!rule.enabled || (onlyRuleId && rule.id !== onlyRuleId)) continue;
    const res = generateRule(rule, ctx, project.seed);
    warnings.push(...res.warnings);
    for (const a of res.aircraft) generatedBy[a.id] = rule.id;
    added.push(...res.aircraft);
  }
  return {
    project: { ...project, scenario: { ...project.scenario, aircraft: [...kept, ...added] }, generatedBy },
    warnings,
  };
}

export function ruleAircraftCount(project: Project, rule: Rule): number {
  return project.scenario.aircraft.filter((a) => project.generatedBy[a.id] === rule.id).length;
}

/** Drop unset optional values so the output matches what vNAS itself writes. */
export function cleanScenario(s: Scenario): Scenario {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined || val === null) continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(s) as Scenario;
}

export function scenarioJson(s: Scenario): string {
  return JSON.stringify(cleanScenario(s), null, 2);
}

export function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "scenario";
}
