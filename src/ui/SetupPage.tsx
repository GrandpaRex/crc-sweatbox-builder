import { useMemo, useState } from "react";
import { ARTCC_IDS } from "../data/vnas";
import {
  importVnasScenario,
  loadArtcc,
  loadFiles,
  loadSummaries,
  loadVnasNav,
  setState,
  setVnasBase,
  updateScenario,
  useStore,
} from "../state/store";
import { Card, Empty, Field, PositionSelect, Select, Text, pickFiles } from "./widgets";

const FILE_TYPES = ".sct,.sct2,.ese,.dat,.json,.geojson";

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? "status ok" : "status"}>
      <span className="dot" />
      <span className="status-label">{label}</span>
      <span className="muted">{detail}</span>
    </li>
  );
}

export function SetupPage() {
  const s = useStore((x) => x.project.scenario);
  const artcc = useStore((x) => x.artcc);
  const airports = useStore((x) => x.trainingAirports);
  const maps = useStore((x) => x.maps);
  const vnasNav = useStore((x) => x.vnasNav);
  const sectorNavs = useStore((x) => x.sectorNavs);
  const log = useStore((x) => x.log);
  const busy = useStore((x) => x.busy);
  const vnasBase = useStore((x) => x.vnasBase);
  const summaries = useStore((x) => x.summaries);
  const [artccPick, setArtccPick] = useState(s.artccId || "ZBW");
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState("");

  const myAirports = useMemo(() => airports.filter((a) => !s.artccId || a.artccId === s.artccId).map((a) => a.id).sort(), [airports, s.artccId]);
  const sectorFixes = sectorNavs.reduce((n, x) => n + x.fixCount, 0);
  const shown = summaries.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

  return (
    <div className="grid two">
      <div className="stack">
        <Card title="1 · Data sources">
          <p className="lead">
            Sector files you load are used first for fixes, airports and runways. Anything they don't cover falls back to the
            vNAS nav database. Controller positions and gate names always come from vNAS, because the scenario refers to them by
            vNAS id.
          </p>
          <div className="row wrap end">
            <Field label="ARTCC">
              <Select value={artccPick} onChange={setArtccPick} options={ARTCC_IDS} />
            </Field>
            <button className="primary" disabled={!!busy} onClick={() => void loadArtcc(artccPick)}>
              Load facility from vNAS
            </button>
            <button disabled={!!busy} onClick={() => void loadVnasNav()}>
              {vnasNav ? "Reload" : "Load"} vNAS nav database (5 MB)
            </button>
          </div>
          <div
            className={"drop" + (over ? " over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void loadFiles([...e.dataTransfer.files]);
            }}
          >
            <strong>Drop files here</strong> or{" "}
            <button className="link" onClick={() => pickFiles(FILE_TYPES, (f) => void loadFiles(f))}>
              browse
            </button>
            <div className="muted">
              Sector files (.sct, .sct2, .ese) · vNAS files saved by hand (ARTCC .json, airport map .geojson, NavData.dat) · an
              existing scenario or project .json
            </div>
          </div>
          <ul className="statuses">
            <Status ok={!!artcc} label="Facility & positions" detail={artcc ? `${artcc.id} · ${artcc.positions.length} positions in ${artcc.facilities.length} facilities` : "not loaded"} />
            <Status ok={airports.length > 0} label="Airline fleets" detail={airports.length ? `${myAirports.length} training airports` : "not loaded (a built-in fleet is used)"} />
            <Status ok={Object.keys(maps).length > 0} label="Gate maps" detail={Object.keys(maps).length ? Object.entries(maps).map(([k, m]) => `${k} (${m.parking.length} spots)`).join(", ") : "loaded per airport when needed"} />
            <Status ok={sectorNavs.length > 0} label="Sector files" detail={sectorNavs.length ? `${sectorNavs.map((n) => n.label).join(", ")} · ${sectorFixes.toLocaleString()} fixes` : "none loaded"} />
            <Status ok={!!vnasNav} label="vNAS nav database" detail={vnasNav ? `${vnasNav.fixCount.toLocaleString()} fixes · ${vnasNav.airportCount.toLocaleString()} airports · ${vnasNav.stars.length} STARs` : "not loaded"} />
          </ul>
          {sectorNavs.length > 0 && (
            <button className="small" onClick={() => setState({ sectorNavs: [] })}>
              Remove sector files
            </button>
          )}
          {log.length > 0 && (
            <ul className="log">
              {log.slice(0, 6).map((l, i) => (
                <li key={i} className={l.level}>
                  {l.text}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>vNAS connection</summary>
            <p className="muted">
              The vNAS API doesn't allow direct calls from a web page, so requests go through <code>/vnas</code>, which{" "}
              <code>npm run dev</code> and <code>npm run preview</code> forward for you. If you host this app as static files,
              point this at your own forwarding proxy or load the files by hand above.
            </p>
            <Field label="vNAS base URL">
              <Text value={vnasBase} onChange={setVnasBase} mono />
            </Field>
          </details>
        </Card>
      </div>

      <div className="stack">
        <Card title="2 · Scenario">
          <div className="form">
            <Field label="Name" wide>
              <Text value={s.name} onChange={(name) => updateScenario({ name })} placeholder="S2-BOS-3 | Departure sequencing" />
            </Field>
            <Field label="Primary airport" hint="FAA id, e.g. BOS">
              <Text value={s.primaryAirportId ?? ""} onChange={(v) => updateScenario({ primaryAirportId: v || undefined })} upper list="apt-list" />
              <datalist id="apt-list">
                {myAirports.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label="Primary approach" hint="e.g. I22L">
              <Text value={s.primaryApproach ?? ""} onChange={(v) => updateScenario({ primaryApproach: v || undefined })} upper />
            </Field>
            <Field label="Student position" wide hint={artcc ? undefined : "Load a facility to pick a position"}>
              <PositionSelect value={s.studentPositionId ?? ""} onChange={(v) => updateScenario({ studentPositionId: v || undefined })} />
            </Field>
            <Field label="Auto-delete aircraft">
              <Select value={s.autoDeleteMode} onChange={(autoDeleteMode) => updateScenario({ autoDeleteMode })} options={["None", "OnLanding", "Parked"]} />
            </Field>
            <Field label="Minimum rating">
              <Select
                value={s.minimumRating ?? ""}
                onChange={(v) => updateScenario({ minimumRating: v || undefined })}
                options={[{ value: "", label: "Any" }, "Student1", "Student2", "Student3", "Controller1"]}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Start from an existing scenario"
          actions={
            <button className="small" disabled={!s.artccId || !!busy} onClick={() => void loadSummaries()}>
              List {s.artccId || "ARTCC"} scenarios
            </button>
          }
        >
          {summaries.length === 0 ? (
            <Empty>Optional. Pull a published scenario from vNAS to edit or use as a template.</Empty>
          ) : (
            <>
              <Text value={filter} onChange={setFilter} placeholder={`Filter ${summaries.length} scenarios`} />
              <ul className="picklist">
                {shown.map((x) => (
                  <li key={x.id}>
                    <button
                      className="link"
                      onClick={() => {
                        if (confirm(`Replace the current scenario with "${x.name}"?`)) void importVnasScenario(x.id);
                      }}
                    >
                      {x.name}
                    </button>
                    <span className="muted">{x.primaryAirportId}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
