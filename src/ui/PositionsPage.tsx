import { useState } from "react";
import type { ScenarioAtc } from "../core/types";
import { ulid } from "../core/ulid";
import { updateScenario, useStore } from "../state/store";
import { Card, Check, Empty, PositionSelect, Text } from "./widgets";

export function PositionsPage() {
  const s = useStore((x) => x.project.scenario);
  const artcc = useStore((x) => x.artcc);
  const [pick, setPick] = useState("");
  const pos = (id: string) => artcc?.positions.find((p) => p.id === id);
  const set = (atc: ScenarioAtc[]) => updateScenario({ atc });
  const patch = (id: string, p: Partial<ScenarioAtc>) => set(s.atc.map((a) => (a.id === id ? { ...a, ...p } : a)));

  const add = () => {
    const p = pos(pick);
    if (!p || s.atc.some((a) => a.positionId === p.id)) return;
    set([...s.atc, { id: ulid(), artccId: s.artccId, facilityId: p.facilityId, positionId: p.id, autoConnect: true, autoTrackAirportIds: [] }]);
    setPick("");
  };

  return (
    <Card title="Simulated controller positions">
      <p className="lead">
        Positions ATCTrainer staffs around the student: the sectors that hand traffic in and accept handoffs out. The student's
        own position is set on the Setup page.
      </p>
      {!artcc && <Empty>Load a facility on the Setup page to pick positions.</Empty>}
      <div className="row end">
        <div className="grow">
          <PositionSelect value={pick} onChange={setPick} />
        </div>
        <button className="primary" disabled={!pick} onClick={add}>
          Add position
        </button>
      </div>
      {s.atc.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Callsign</th>
              <th>Position</th>
              <th>Facility</th>
              <th>Auto-connect</th>
              <th>Auto-track departures from</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.atc.map((a) => {
              const p = pos(a.positionId);
              return (
                <tr key={a.id}>
                  <td className="mono">{p?.callsign ?? "?"}</td>
                  <td>{p ? `${p.name} · ${(p.frequency / 1e6).toFixed(3)}` : <span className="muted">{a.positionId}</span>}</td>
                  <td>{a.facilityId}</td>
                  <td>
                    <Check checked={a.autoConnect} onChange={(autoConnect) => patch(a.id, { autoConnect })} label="" />
                  </td>
                  <td>
                    <Text
                      value={a.autoTrackAirportIds.join(" ")}
                      onChange={(v) => patch(a.id, { autoTrackAirportIds: v.split(/[\s,]+/).filter(Boolean) })}
                      placeholder="BOS PVD"
                      upper
                    />
                  </td>
                  <td>
                    <button className="small danger" onClick={() => set(s.atc.filter((x) => x.id !== a.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
