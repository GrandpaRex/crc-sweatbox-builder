import type { AircraftGenerator, InitTrigger } from "../core/types";
import { ulid } from "../core/ulid";
import { updateScenario, useStore } from "../state/store";
import { Card, Check, Empty, Field, Num, PositionSelect, Select, Text } from "./widgets";

export function ExtrasPage() {
  const s = useStore((x) => x.project.scenario);
  const gens = s.aircraftGenerators;
  const trig = s.initializationTriggers;
  const setGens = (aircraftGenerators: AircraftGenerator[]) => updateScenario({ aircraftGenerators });
  const patchGen = (id: string, p: Partial<AircraftGenerator>) => setGens(gens.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const setTrig = (initializationTriggers: InitTrigger[]) => updateScenario({ initializationTriggers });
  const patchTrig = (id: string, p: Partial<InitTrigger>) => setTrig(trig.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const addGen = () =>
    setGens([
      ...gens,
      { id: ulid(), runway: "", engineType: "Jet", weightCategory: "Large", initialDistance: 15, maxDistance: 50, intervalDistance: 5, startTimeOffset: 0, maxTime: 3600, intervalTime: 240, randomizeInterval: true, randomizeWeightCategory: true },
    ]);

  return (
    <div className="grid two">
      <Card title="Arrival generators" actions={<button className="small primary" onClick={addGen}>+ Add generator</button>}>
        <p className="lead">
          ATCTrainer's built-in endless arrival stream to a runway at the primary airport. It invents its own aircraft at run time,
          so these don't appear in the aircraft list. Handy for keeping a tower or ground student busy without scripting each arrival.
        </p>
        {gens.length === 0 && <Empty>No generators.</Empty>}
        {gens.map((g) => (
          <div className="sub" key={g.id}>
            <div className="form">
              <Field label="Runway">
                <Text value={g.runway} onChange={(runway) => patchGen(g.id, { runway })} upper placeholder="22L" />
              </Field>
              <Field label="Engine type">
                <Select value={g.engineType} onChange={(engineType) => patchGen(g.id, { engineType })} options={["Jet", "Turboprop", "Piston"]} />
              </Field>
              <Field label="Weight">
                <Select value={g.weightCategory} onChange={(weightCategory) => patchGen(g.id, { weightCategory })} options={["Small", "SmallPlus", "Large", "Heavy"]} />
              </Field>
              <Field label="Mix">
                <Check checked={g.randomizeWeightCategory} onChange={(randomizeWeightCategory) => patchGen(g.id, { randomizeWeightCategory })} label="Randomize weight" />
              </Field>
              <Field label="First aircraft at (nm)">
                <Num value={g.initialDistance} min={1} onChange={(v) => patchGen(g.id, { initialDistance: v ?? 10 })} />
              </Field>
              <Field label="Furthest spawn (nm)">
                <Num value={g.maxDistance} min={1} onChange={(v) => patchGen(g.id, { maxDistance: v ?? 50 })} />
              </Field>
              <Field label="In-trail spacing (nm)">
                <Num value={g.intervalDistance} min={0} onChange={(v) => patchGen(g.id, { intervalDistance: v ?? 0 })} />
              </Field>
              <Field label="Every (s)">
                <Num value={g.intervalTime} min={10} onChange={(v) => patchGen(g.id, { intervalTime: v ?? 300 })} />
              </Field>
              <Field label="Start at (s)">
                <Num value={g.startTimeOffset ?? 0} min={0} onChange={(v) => patchGen(g.id, { startTimeOffset: v || undefined })} />
              </Field>
              <Field label="Stop after (s)" hint="Blank = never">
                <Num value={g.maxTime} min={0} onChange={(v) => patchGen(g.id, { maxTime: v ?? undefined })} />
              </Field>
              <Field label="Timing">
                <Check checked={g.randomizeInterval} onChange={(randomizeInterval) => patchGen(g.id, { randomizeInterval })} label="Randomize interval" />
              </Field>
              <Field label="Start tracked by" wide>
                <PositionSelect
                  value={g.autoTrackConfiguration?.positionId ?? ""}
                  onChange={(v) => patchGen(g.id, { autoTrackConfiguration: v ? { ...g.autoTrackConfiguration, positionId: v } : undefined })}
                />
              </Field>
              {g.autoTrackConfiguration && (
                <>
                  <Field label="Handoff after (s)">
                    <Num value={g.autoTrackConfiguration.handoffDelay} min={0} onChange={(v) => patchGen(g.id, { autoTrackConfiguration: { ...g.autoTrackConfiguration!, handoffDelay: v ?? undefined } })} />
                  </Field>
                  <Field label="Scratchpad">
                    <Text value={g.autoTrackConfiguration.scratchPad ?? ""} upper onChange={(v) => patchGen(g.id, { autoTrackConfiguration: { ...g.autoTrackConfiguration!, scratchPad: v || undefined } })} />
                  </Field>
                </>
              )}
            </div>
            <button className="small danger" onClick={() => setGens(gens.filter((x) => x.id !== g.id))}>
              Remove generator
            </button>
          </div>
        ))}
      </Card>

      <Card title="Initialization triggers" actions={<button className="small primary" onClick={() => setTrig([...trig, { id: ulid(), command: "" }])}>+ Add trigger</button>}>
        <p className="lead">Scenario-wide ATCTrainer commands run at a set time, for example <code>SQALL</code> to have every aircraft squawk its assigned code.</p>
        {trig.length === 0 && <Empty>No triggers.</Empty>}
        {trig.map((t) => (
          <div className="row end" key={t.id}>
            <div className="grow">
              <Field label="Command">
                <Text value={t.command} onChange={(command) => patchTrig(t.id, { command })} upper />
              </Field>
            </div>
            <Field label="At (s)">
              <Num value={t.timeOffset ?? 0} min={0} onChange={(v) => patchTrig(t.id, { timeOffset: v || undefined })} />
            </Field>
            <button className="small danger" onClick={() => setTrig(trig.filter((x) => x.id !== t.id))}>
              Remove
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}
