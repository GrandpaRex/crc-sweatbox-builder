import { useEffect } from "react";
import { newProject, slug } from "../core/project";
import { ensureMap, getState, loadArtcc, loadFiles, replaceProject, setState, useStore, type Page } from "../state/store";
import { download, pickFiles } from "./widgets";
import { SetupPage } from "./SetupPage";
import { PositionsPage } from "./PositionsPage";
import { TrafficPage } from "./TrafficPage";
import { AircraftPage } from "./AircraftPage";
import { ExtrasPage } from "./ExtrasPage";
import { ExportPage } from "./ExportPage";

const PAGES: { id: Page; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "positions", label: "Positions" },
  { id: "traffic", label: "Traffic rules" },
  { id: "aircraft", label: "Aircraft" },
  { id: "extras", label: "Generators & triggers" },
  { id: "export", label: "Export" },
];

export function App() {
  const page = useStore((s) => s.page);
  const project = useStore((s) => s.project);
  const busy = useStore((s) => s.busy);
  const artcc = useStore((s) => s.artcc);
  const s = project.scenario;

  // Restore facility data for a saved project.
  useEffect(() => {
    const id = getState().project.scenario.artccId;
    if (id && !getState().artcc) void loadArtcc(id);
  }, []);

  // Fetch ground maps for every airport the scenario touches.
  const airportKey = [s.primaryAirportId, ...project.rules.map((r) => r.airportId), ...s.aircraft.map((a) => a.airportId)]
    .filter(Boolean)
    .map((x) => x!.toUpperCase())
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(",");
  useEffect(() => {
    if (!artcc) return;
    for (const id of airportKey.split(",")) if (id) void ensureMap(id);
  }, [airportKey, artcc]);

  const counts: Partial<Record<Page, number>> = {
    positions: s.atc.length,
    traffic: project.rules.length,
    aircraft: s.aircraft.length,
    extras: s.aircraftGenerators.length + s.initializationTriggers.length,
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <strong>CRC Sweatbox Builder</strong>
          <span className="muted">ATCTrainer scenarios</span>
        </div>
        <div className="top-title" title={s.name}>
          {s.name || "Untitled"} {s.artccId && <span className="pill">{s.artccId}</span>}
        </div>
        {busy && <span className="busy">{busy}…</span>}
        <div className="row">
          <button
            onClick={() => {
              if (!s.aircraft.length || confirm("Start a new scenario? The current one is discarded unless you saved the project.")) {
                replaceProject(newProject(), "New scenario");
                setState({ page: "setup" });
              }
            }}
          >
            New
          </button>
          <button onClick={() => pickFiles(".json", (f) => void loadFiles(f))}>Open</button>
          <button onClick={() => download(`${slug(s.name)}.project.json`, JSON.stringify(project, null, 2))}>Save project</button>
        </div>
      </header>
      <nav className="tabs">
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? "tab on" : "tab"} onClick={() => setState({ page: p.id })}>
            {p.label}
            {counts[p.id] ? <span className="count">{counts[p.id]}</span> : null}
          </button>
        ))}
      </nav>
      <main>
        {page === "setup" && <SetupPage />}
        {page === "positions" && <PositionsPage />}
        {page === "traffic" && <TrafficPage />}
        {page === "aircraft" && <AircraftPage />}
        {page === "extras" && <ExtrasPage />}
        {page === "export" && <ExportPage />}
      </main>
    </div>
  );
}
