# CRC Sweatbox Builder

A web app for building **vNAS ATCTrainer** training scenarios, the scenarios
that fly the traffic you control in **CRC** on the sweatbox servers.

Describe traffic as rules ("15 departures from the A and B gates", "an arrival
every 3 minutes over ROBUC at 14,000 on the ROBUC3"), generate it, tweak
individual aircraft, and export scenario JSON in the exact shape vNAS uses.

![Traffic rules](docs/traffic-rules.png)

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5180.

Other commands: `npm test` (unit tests), `npm run build` (type-check + production
build into `dist/`), `npm run preview` (serve the build, with vNAS forwarding).

## How it works

| Tab | What you do there |
| --- | --- |
| **Setup** | Load data, name the scenario, pick the primary airport and student position. Optionally start from a published scenario. |
| **Positions** | Choose the simulated controllers around the student. |
| **Traffic rules** | Departure, arrival and overflight streams. Covers ground/tower (gates, runway, final), approach (fixes and STARs) and enroute (boundary fixes at cruise). |
| **Aircraft** | Every aircraft in a table and on a map. Edit, add, duplicate or delete by hand. |
| **Generators & triggers** | ATCTrainer's built-in arrival generators and scenario-wide commands such as `SQALL`. |
| **Export** | Validation, JSON download, and the Data Admin push snippet. |

Generation is seeded: the same rules give the same traffic until you press
**Reshuffle**. Editing a generated aircraft detaches it from its rule, so
regenerating never overwrites hand edits. Gates and callsigns are never reused.

The project autosaves in the browser. **Save project** writes a `.project.json`
(scenario + rules) you can reopen or share.

## Where the data comes from

Navigation data (fixes, airports, runways, SIDs/STARs) is resolved in order:

1. **Sector files you load** — `.sct` / `.sct2` (airports, fixes, VORs, NDBs,
   runways) and `.ese` (SIDs and STARs).
2. **vNAS nav database** (`NavData.dat`) for anything the sector files lack.

Controller positions, gate names and airline fleets **always** come from vNAS,
because a scenario refers to positions by vNAS id and to gates by the names on
the vNAS airport map. A sector file can't supply those.

### The vNAS connection

The vNAS data API does not allow cross-origin calls from a web page. The dev
and preview servers therefore forward read-only `GET /vnas/*` requests to
`data-api.vnas.vatsim.net` (see `vite.config.ts`).

If you host the built app as static files there is no forwarder, so either:

- run a forwarding proxy (`proxy/worker.js` is a ready-made Cloudflare Worker) and either
  build with `VITE_VNAS_BASE=<its URL>` so it is built in and the setting is hidden (the
  Pages workflow reads it from the `VNAS_BASE` repository secret), or enter it under **Setup → vNAS connection**, or
- save the vNAS files yourself and drop them on the Setup page: the ARTCC JSON
  (`/api/artccs/ZBW`), an airport map (`/api/training/airports/BOS/map`), the
  training airport list (`/api/training/airports`) and `/Files/NavData.dat`.

## Getting a scenario into vNAS

vNAS Data Admin has **no scenario file import**; its documentation says
scenarios cannot be modified externally. The Export tab offers what other
community tools do: a short console snippet that, run on a scenario's page in
Data Admin while you are logged in, saves your scenario over that one using
the same request the Save button sends.

This is unofficial, has no undo, and has not been tested against a real Data
Admin account. Create an empty scenario to receive it rather than overwriting
real work, and check with your facility's training staff before using it.

## Layout

```
src/core    schema types, traffic generator, validation, geo, ids
src/data    vNAS client and parsers, NavData protobuf decoder, sector files
src/state   app store (project autosave, data loading)
src/ui      pages, map preview, form widgets
tests       unit tests and fixtures (a real vNAS scenario and airport map)
```
