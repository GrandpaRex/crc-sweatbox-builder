import type { Rule, RuleKind, StartType } from "../core/types";
import { newRule, parseFlights } from "../core/generate";
import { ruleAircraftCount } from "../core/project";
import { fmtTime } from "../core/position";
import { addRule, removeRule, runGenerate, setState, updateRule, useStore } from "../state/store";
import { MapView } from "./MapView";
import { Area, Card, Check, Empty, Field, FixInput, Num, PositionSelect, Select, Text } from "./widgets";

const KIND_LABEL: Record<RuleKind, string> = { departure: "Departures", arrival: "Arrivals", overflight: "Overflights" };

const START_OPTIONS: Record<RuleKind, { value: StartType; label: string }[]> = {
  departure: [
    { value: "Parking", label: "Parked at a gate" },
    { value: "OnRunway", label: "Lined up on the runway" },
  ],
  arrival: [
    { value: "FixOrFrd", label: "At a fix" },
    { value: "OnFinal", label: "On final" },
  ],
  overflight: [{ value: "FixOrFrd", label: "At a fix" }],
};

function RuleEditor({ rule }: { rule: Rule }) {
  const maps = useStore((s) => s.maps);
  const mapStatus = useStore((s) => s.mapStatus);
  const hasFleet = useStore((s) => !!s.trainingAirports.find((a) => a.id === rule.airportId)?.fleet.length);
  const set = (patch: Partial<Rule>) => updateRule(rule.id, patch);
  const spots = maps[rule.airportId]?.parking.length;
  const flightErrors = parseFlights(rule.flights).errors;
  const last = rule.startOffset + Math.max(0, rule.count - 1) * rule.interval;

  return (
    <Card
      title={`${KIND_LABEL[rule.kind]} rule`}
      actions={
        <>
          <button className="primary" onClick={() => runGenerate(rule.id)}>
            Generate this rule
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete rule "${rule.name}" and its aircraft?`)) removeRule(rule.id);
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Rule name" wide>
          <Text value={rule.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label="Airport" hint="FAA id">
          <Text value={rule.airportId} onChange={(airportId) => set({ airportId })} upper />
        </Field>
        <Field label="Start">
          <Select value={rule.startType} onChange={(startType) => set({ startType })} options={START_OPTIONS[rule.kind]} />
        </Field>

        <h3>How many, and when</h3>
        <Field label="Aircraft">
          <Num value={rule.count} min={1} onChange={(v) => set({ count: Math.max(1, v ?? 1) })} />
        </Field>
        <Field label="First spawn (s)">
          <Num value={rule.startOffset} min={0} onChange={(v) => set({ startOffset: v ?? 0 })} />
        </Field>
        <Field label="Gap between aircraft (s)" hint={rule.interval ? `${(3600 / rule.interval).toFixed(1)}/hour · last at ${fmtTime(last)}` : "All present at the start"}>
          <Num value={rule.interval} min={0} onChange={(v) => set({ interval: v ?? 0 })} />
        </Field>
        <Field label="Gap randomness (%)">
          <Num value={rule.jitterPct} min={0} onChange={(v) => set({ jitterPct: Math.min(100, v ?? 0) })} />
        </Field>

        <h3>Starting position</h3>
        {rule.startType === "Parking" && (
          <Field
            label="Gates to use"
            wide
            hint={
              spots
                ? `${spots} spots on the ${rule.airportId} map. Blank = any. Comma-separated, * wildcard: A*, B1, C2*`
                : mapStatus[rule.airportId] === "failed"
                  ? `No gate map could be loaded for ${rule.airportId}. Load its airport map .geojson on the Setup page.`
                  : "Load a facility on the Setup page to get this airport's gate names."
            }
          >
            <Text value={rule.parkingFilter} onChange={(parkingFilter) => set({ parkingFilter })} placeholder="any free gate" mono />
          </Field>
        )}
        {(rule.startType === "OnRunway" || rule.startType === "OnFinal") && (
          <Field label="Runway">
            <Text value={rule.runway} onChange={(runway) => set({ runway })} placeholder="22L" upper />
          </Field>
        )}
        {rule.startType === "OnFinal" && (
          <Field label="Distance from runway (nm)">
            <Num value={rule.distanceFromRunway} min={1} onChange={(v) => set({ distanceFromRunway: v ?? 10 })} />
          </Field>
        )}
        {rule.startType === "FixOrFrd" && (
          <>
            <Field label="Spawn fix" hint="Fix, navaid, or fix-radial-distance (BOS090020)">
              <FixInput value={rule.fix} onChange={(fix) => set({ fix })} placeholder="ROBUC" />
            </Field>
            <Field label="Altitude (ft)">
              <Num value={rule.altitude} step={1000} onChange={(v) => set({ altitude: v ?? 0 })} />
            </Field>
            <Field label="Speed (kt)" hint="0 = let the sim choose">
              <Num value={rule.speed} step={10} onChange={(v) => set({ speed: v ?? 0 })} />
            </Field>
            <Field label="Navigation path" wide hint="What the aircraft flies after spawning, e.g. ROBUC ROBUC3.22L">
              <Text value={rule.navigationPath} onChange={(navigationPath) => set({ navigationPath })} upper />
            </Field>
            <Field label="Altitude profile" wide>
              <Check checked={rule.onAltitudeProfile} onChange={(onAltitudeProfile) => set({ onAltitudeProfile })} label="Descend on the procedure's published altitudes" />
            </Field>
          </>
        )}

        <h3>Flight plans</h3>
        <Field label="Plans, one per line: DEP DEST ALT ROUTE" wide hint={flightErrors[0] ?? "Used in order and repeated as needed. ALT accepts 350, FL350 or 35000."}>
          <Area value={rule.flights} onChange={(flights) => set({ flights })} rows={5} placeholder="KBOS KORD 360 HYLND5 HYLND Q822 FNT WYNDE2" />
        </Field>
        <Field label="Flight rules">
          <Select value={rule.flightRules} onChange={(flightRules) => set({ flightRules })} options={["IFR", "VFR"]} />
        </Field>
        <Field label="Remarks">
          <Text value={rule.remarks} onChange={(remarks) => set({ remarks })} mono />
        </Field>

        <h3>Aircraft and callsigns</h3>
        <Field label="Fleet" hint={rule.fleetSource === "airport" && !hasFleet ? "No vNAS fleet loaded for this airport, so a built-in US airline mix is used." : undefined}>
          <Select
            value={rule.fleetSource}
            onChange={(fleetSource) => set({ fleetSource })}
            options={[
              { value: "airport", label: "Airlines configured for the airport in vNAS" },
              { value: "custom", label: "Custom list" },
            ]}
          />
        </Field>
        <Field label="Equipment suffix">
          <Text value={rule.equipmentSuffix} onChange={(equipmentSuffix) => set({ equipmentSuffix })} upper />
        </Field>
        {rule.fleetSource === "custom" && (
          <Field label="Airlines, one per line: ICAO: types @weight" wide hint="Use N: for general aviation N-numbers.">
            <Area value={rule.fleetText} onChange={(fleetText) => set({ fleetText })} rows={4} />
          </Field>
        )}

        <h3>Behaviour</h3>
        <Field label="Preset commands, one per line" wide hint="ATCTrainer commands run at spawn, e.g. WAIT 120 HO B1M">
          <Area value={rule.presetCommands} onChange={(presetCommands) => set({ presetCommands })} rows={3} />
        </Field>
        <Field label="Start tracked by" wide hint="Position that owns the track at spawn (for example the feeding center sector)">
          <PositionSelect value={rule.autoTrackPositionId} onChange={(autoTrackPositionId) => set({ autoTrackPositionId })} />
        </Field>
        {rule.autoTrackPositionId && (
          <>
            <Field label="Handoff after (s)">
              <Num value={rule.handoffDelay} min={0} placeholder="none" onChange={(handoffDelay) => set({ handoffDelay })} />
            </Field>
            <Field label="Scratchpad">
              <Text value={rule.scratchPad} onChange={(scratchPad) => set({ scratchPad })} upper />
            </Field>
          </>
        )}
        <Field label="Expected approach">
          <Text value={rule.expectedApproach} onChange={(expectedApproach) => set({ expectedApproach })} placeholder="I22L" upper />
        </Field>
        <Field label="Pilot difficulty">
          <Select value={rule.difficulty} onChange={(difficulty) => set({ difficulty })} options={["Easy", "Medium", "Hard"]} />
        </Field>
      </div>
    </Card>
  );
}

export function TrafficPage() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedRuleId);
  const warnings = useStore((s) => s.genWarnings);
  const rule = project.rules.find((r) => r.id === selectedId) ?? project.rules[0];
  const primary = project.scenario.primaryAirportId ?? "";
  const shown = rule ? project.scenario.aircraft.filter((a) => project.generatedBy[a.id] === rule.id) : project.scenario.aircraft;

  return (
    <div className="grid side">
      <div className="stack">
        <Card
          title="Rules"
          actions={
            <>
              <button className="small" title="Same rules, new random callsigns, gates and timing" onClick={() => runGenerate(undefined, true)} disabled={!project.rules.length}>
                Reshuffle
              </button>
              <button className="small primary" onClick={() => runGenerate()} disabled={!project.rules.length}>
                Generate all
              </button>
            </>
          }
        >
          {project.rules.length === 0 && <Empty>A rule describes a stream of traffic. Add one, then generate.</Empty>}
          <ul className="rules">
            {project.rules.map((r) => (
              <li key={r.id} className={r.id === rule?.id ? "on" : ""} onClick={() => setState({ selectedRuleId: r.id })}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  title="Include when generating"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
                />
                <span className="grow">
                  <strong>{r.name || KIND_LABEL[r.kind]}</strong>
                  <span className="muted">
                    {KIND_LABEL[r.kind]} · {r.airportId || "no airport"} · {r.count} wanted
                  </span>
                </span>
                <span className="count">{ruleAircraftCount(project, r)}</span>
              </li>
            ))}
          </ul>
          <div className="row wrap">
            {(Object.keys(KIND_LABEL) as RuleKind[]).map((k) => (
              <button key={k} className="small" onClick={() => addRule(newRule(k, primary))}>
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {warnings.length > 0 && (
            <ul className="log">
              {warnings.map((w, i) => (
                <li key={i} className="error">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <MapView aircraft={shown} />
      </div>
      <div>{rule ? <RuleEditor key={rule.id} rule={rule} /> : <Card title="No rule selected">{<Empty>Add a departure, arrival or overflight rule on the left.</Empty>}</Card>}</div>
    </div>
  );
}
