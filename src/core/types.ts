// ATCTrainer scenario schema, as served by the vNAS data API
// (GET /api/training/scenarios/{id}). Optional fields are omitted when unset.

export interface LatLon {
  lat: number;
  lon: number;
}

export type StartType = "Parking" | "FixOrFrd" | "Coordinates" | "OnFinal" | "OnRunway";

export interface StartingConditions {
  type: StartType;
  parking?: string;
  fix?: string;
  coordinates?: LatLon;
  runway?: string;
  distanceFromRunway?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  navigationPath?: string;
}

export interface FlightPlan {
  rules: "IFR" | "VFR";
  departure: string;
  destination: string;
  cruiseAltitude: number;
  cruiseSpeed: number;
  route: string;
  remarks: string;
  aircraftType: string;
}

export interface PresetCommand {
  id: string;
  command: string;
  timeOffset: number;
}

export interface AutoTrack {
  positionId: string;
  handoffDelay?: number;
  scratchPad?: string;
  interimAltitude?: string;
  clearedAltitude?: string;
}

export interface ScenarioAircraft {
  id: string;
  aircraftId: string;
  aircraftType: string;
  transponderMode: "C" | "Standby" | string;
  startingConditions: StartingConditions;
  onAltitudeProfile: boolean;
  flightplan?: FlightPlan;
  presetCommands: PresetCommand[];
  spawnDelay?: number;
  airportId?: string;
  expectedApproach?: string;
  difficulty?: "Easy" | "Medium" | "Hard" | string;
  autoTrackConditions?: AutoTrack;
}

export interface ScenarioAtc {
  id: string;
  artccId: string;
  facilityId: string;
  positionId: string;
  autoConnect: boolean;
  autoTrackAirportIds: string[];
}

export interface AircraftGenerator {
  id: string;
  runway: string;
  engineType: "Jet" | "Turboprop" | "Piston" | string;
  weightCategory: "Small" | "SmallPlus" | "Large" | "Heavy" | string;
  initialDistance: number;
  maxDistance: number;
  intervalDistance: number;
  startTimeOffset?: number;
  maxTime?: number;
  intervalTime: number;
  randomizeInterval: boolean;
  randomizeWeightCategory: boolean;
  autoTrackConfiguration?: AutoTrack;
}

export interface InitTrigger {
  id: string;
  command: string;
  timeOffset?: number;
}

export interface Scenario {
  id: string;
  name: string;
  artccId: string;
  initializationTriggers: InitTrigger[];
  aircraftGenerators: AircraftGenerator[];
  aircraft: ScenarioAircraft[];
  atc: ScenarioAtc[];
  primaryAirportId?: string;
  primaryApproach?: string;
  studentPositionId?: string;
  autoDeleteMode: "None" | "OnLanding" | "Parked" | string;
  minimumRating?: string;
  flightStripConfigurations: unknown[];
  // Unknown keys from an imported scenario are kept and written back.
  [extra: string]: unknown;
}

// ---- Builder-side model (not part of the exported scenario) ----

export type RuleKind = "departure" | "arrival" | "overflight";

export interface Rule {
  id: string;
  name: string;
  kind: RuleKind;
  enabled: boolean;
  /** FAA id of the airport this traffic belongs to (e.g. BOS). */
  airportId: string;
  count: number;
  /** Seconds after scenario start for the first aircraft. */
  startOffset: number;
  /** Seconds between aircraft. 0 = all present at once. */
  interval: number;
  /** Random spread applied to each gap, as a percentage of the interval. */
  jitterPct: number;
  startType: StartType;
  /** Parking: comma separated names, `*` wildcard. Blank = any free spot. */
  parkingFilter: string;
  runway: string;
  distanceFromRunway: number;
  fix: string;
  altitude: number;
  speed: number;
  navigationPath: string;
  onAltitudeProfile: boolean;
  flightRules: "IFR" | "VFR";
  /** One plan per line: DEP DEST ALT ROUTE... */
  flights: string;
  fleetSource: "airport" | "custom";
  /** One airline per line: `AAL: B738, A321 @3` (weight optional). `N:` = GA. */
  fleetText: string;
  equipmentSuffix: string;
  remarks: string;
  autoTrackPositionId: string;
  handoffDelay: number | null;
  scratchPad: string;
  expectedApproach: string;
  difficulty: string;
  /** One command per line. */
  presetCommands: string;
}

export interface Project {
  version: 1;
  seed: number;
  scenario: Scenario;
  rules: Rule[];
  /** aircraft.id -> rule.id for aircraft produced by a rule. */
  generatedBy: Record<string, string>;
}
