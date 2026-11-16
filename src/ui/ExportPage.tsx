import { useMemo, useState } from "react";
import { cleanScenario, scenarioJson, slug } from "../core/project";
import { validate } from "../core/validate";
import { dataLookups, setState, useStore } from "../state/store";
import { Card, Empty, download } from "./widgets";

/** Console snippet that saves the scenario over the one open in vNAS Data Admin. */
export function pushSnippet(json: string): string {
  return `(async () => {
  const scenario = ${json};
  const m = location.pathname.match(/scenarios\\/([0-9A-Za-z]{26})/);
  if (location.hostname !== "data-admin.vnas.vatsim.net" || !m) {
    alert("Open the scenario you want to overwrite in vNAS Data Admin first, then run this again.");
    return;
  }
  const url = "https://data-api.vnas.vatsim.net/api/training/scenarios/" + m[1];
  const current = await (await fetch(url, { credentials: "include" })).json();
  const next = { ...scenario, id: current.id, artccId: current.artccId };
  const ok = confirm(
    'Overwrite "' + current.name + '" (' + current.aircraft.length + " aircraft) with \\"" +
      next.name + '" (' + next.aircraft.length + " aircraft)? This cannot be undone.");
  if (!ok) return;
  const res = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  alert(res.ok ? "Saved. Reload the page to see it." : "Save failed: " + res.status + " " + (await res.text()).slice(0, 300));
})();`;
}

export function ExportPage() {
  const scenario = useStore((s) => s.project.scenario);
  const nav = useStore((s) => s.nav);
  const artcc = useStore((s) => s.artcc);
  const maps = useStore((s) => s.maps);
  const [copied, setCopied] = useState("");

  const json = useMemo(() => scenarioJson(scenario), [scenario]);
  const issues = useMemo(
    () => validate(scenario, { nav, positionIds: artcc ? new Set(artcc.positions.map((p) => p.id)) : undefined, parking: dataLookups().parking }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, nav, artcc, maps],
  );
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(""), 2500);
  };

  return (
    <div className="grid two">
      <div className="stack">
        <Card title="Checks">
          {issues.length === 0 ? (
            <p className="good">No problems found.</p>
          ) : (
            <>
              <p className="lead">
                {errors.length} error{errors.length === 1 ? "" : "s"}, {warns.length} warning{warns.length === 1 ? "" : "s"}. Click an
                aircraft problem to open it.
              </p>
              <ul className="issues">
                {[...errors, ...warns].slice(0, 200).map((i, n) => (
                  <li key={n} className={i.level}>
                    {i.aircraftId ? (
                      <button className="link" onClick={() => setState({ page: "aircraft", selectedAircraftId: i.aircraftId! })}>
                        {i.message}
                      </button>
                    ) : (
                      i.message
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!nav.loaded && <Empty>Nav data isn't loaded, so fix names were not checked.</Empty>}
          {!artcc && <Empty>No facility loaded, so position ids were not checked.</Empty>}
        </Card>

        <Card title="Export">
          <div className="row wrap">
            <button className="primary" onClick={() => download(`${slug(scenario.name)}.json`, json)}>
              Download scenario JSON
            </button>
            <button onClick={() => void copy("json", json)}>{copied === "json" ? "Copied" : "Copy JSON"}</button>
          </div>
          <p className="muted">
            {scenario.aircraft.length} aircraft · {scenario.atc.length} positions · {scenario.aircraftGenerators.length} generators ·{" "}
            {(json.length / 1024).toFixed(1)} KB
          </p>
          <h3>Getting it into vNAS</h3>
          <p className="lead">
            vNAS Data Admin has no "import scenario file" button. The route other community tools use is to save over an existing
            scenario through the same request Data Admin's own Save button sends:
          </p>
          <ol className="steps">
            <li>In Data Admin, create an empty scenario (or pick one you're happy to overwrite) and open it.</li>
            <li>Copy the snippet below, open the browser console on that page (F12), paste and press Enter.</li>
            <li>Confirm the overwrite prompt, then reload the page.</li>
          </ol>
          <button disabled={errors.length > 0} onClick={() => void copy("push", pushSnippet(JSON.stringify(cleanScenario(scenario))))}>
            {copied === "push" ? "Copied" : "Copy Data Admin push snippet"}
          </button>
          {errors.length > 0 && <p className="muted">Fix the errors above before pushing.</p>}
          <p className="note">
            This is unofficial and replaces the target scenario with no undo. It keeps the target's id and ARTCC, and takes
            everything else from here. Only paste console code you trust; the snippet is short enough to read first.
          </p>
        </Card>
      </div>
      <Card title="Scenario JSON">
        <pre className="json">{json.length > 60000 ? json.slice(0, 60000) + "\n… (truncated in preview)" : json}</pre>
      </Card>
    </div>
  );
}
