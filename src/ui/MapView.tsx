import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLon, ScenarioAircraft } from "../core/types";
import { aircraftPosition } from "../core/position";
import { setState, useStore } from "../state/store";

interface View {
  lat: number;
  lon: number;
  /** Visible width in nautical miles. */
  span: number;
}

const W = 600;
const H = 420;

const KIND_CLASS: Record<string, string> = { Parking: "k-ground", OnRunway: "k-ground", OnFinal: "k-final", FixOrFrd: "k-air", Coordinates: "k-air" };

export function MapView({ aircraft }: { aircraft: ScenarioAircraft[] }) {
  const nav = useStore((s) => s.nav);
  const maps = useStore((s) => s.maps);
  const primary = useStore((s) => s.project.scenario.primaryAirportId ?? "");
  const selected = useStore((s) => s.selectedAircraftId);
  const [view, setView] = useState<View | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const home = useMemo<LatLon | undefined>(() => {
    const m = maps[primary];
    if (m?.parking.length) return { lat: m.parking[0].lat, lon: m.parking[0].lon };
    return primary ? nav.fix(primary) : undefined;
  }, [maps, primary, nav]);

  const points = useMemo(
    () =>
      aircraft
        .map((a) => ({ a, pos: aircraftPosition(a, nav, maps, home) }))
        .filter((p): p is { a: ScenarioAircraft; pos: LatLon } => !!p.pos),
    [aircraft, nav, maps, home],
  );

  const fit = (pts: LatLon[], minSpan: number): View | null => {
    if (!pts.length) return null;
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const h = (Math.max(...lats) - Math.min(...lats)) * 60;
    const w = (Math.max(...lons) - Math.min(...lons)) * 60 * Math.cos((lat * Math.PI) / 180);
    return { lat, lon, span: Math.max(minSpan, w * 1.25, h * 1.25 * (W / H)) };
  };
  const fitAll = () => fit([...points.map((p) => p.pos), ...(home ? [home] : [])], 3);
  const fitAirport = () => {
    const m = maps[primary];
    if (m) return fit([...m.parking, ...m.runways.flatMap((r) => r.line)], 1.5);
    return home ? { ...home, span: 12 } : null;
  };

  // Start (and restart, when the airport changes) on a sensible view.
  const key = `${primary}|${!!home}|${points.length > 0}`;
  useEffect(() => {
    setView(fitAll() ?? fitAirport());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const v = view ?? (home ? { ...home, span: 60 } : { lat: 39, lon: -96, span: 2400 });
  const scale = W / v.span;
  const cos = Math.cos((v.lat * Math.PI) / 180);
  const px = (p: LatLon): [number, number] => [W / 2 + (p.lon - v.lon) * 60 * cos * scale, H / 2 - (p.lat - v.lat) * 60 * scale];
  const path = (line: LatLon[]) => line.map((p, i) => (i ? "L" : "M") + px(p).map((n) => n.toFixed(1)).join(" ")).join("");
  const inView = ([x, y]: [number, number]) => x > -40 && x < W + 40 && y > -40 && y < H + 40;

  const onWheel = (e: React.WheelEvent) => {
    const f = e.deltaY > 0 ? 1.25 : 0.8;
    setView({ ...v, span: Math.min(6000, Math.max(0.3, v.span * f)) });
  };
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, view: v };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !svg.current) return;
    const k = W / svg.current.getBoundingClientRect().width;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    setView({ ...d.view, lon: d.view.lon - dx / scale / 60 / cos, lat: d.view.lat + dy / scale / 60 });
  };

  const showGround = v.span < 40;
  const sel = points.find((p) => p.a.id === selected);
  const route = useMemo(() => {
    if (!sel) return [];
    const st = sel.a.startingConditions;
    const text = st.navigationPath || sel.a.flightplan?.route || "";
    return [sel.pos, ...nav.routePoints(text, sel.pos).map((p) => p.pos)];
  }, [sel, nav]);

  const airportIds = Object.keys(maps);
  const navRunways = primary && !maps[primary] ? (nav.airport(primary)?.runways ?? []) : [];

  return (
    <div className="map">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="Spawn position preview"
      >
        {showGround &&
          airportIds.map((id) => (
            <g key={id}>
              {maps[id].taxiways.map((t, i) => (
                <path key={"t" + i} d={path(t.line)} className="m-taxi" />
              ))}
              {maps[id].runways.map((r, i) => (
                <path key={"r" + i} d={path(r.line)} className="m-runway" />
              ))}
              {v.span < 6 &&
                maps[id].parking.map((p) => {
                  const [x, y] = px(p);
                  return <circle key={p.name} cx={x} cy={y} r={1.6} className="m-parking" />;
                })}
            </g>
          ))}
        {navRunways.map((r) => (
          <path key={r.id} d={path([r, { lat: r.endLat, lon: r.endLon }])} className="m-runway" />
        ))}
        {home && !showGround && (
          <g transform={`translate(${px(home).join(" ")})`}>
            <circle r={4} className="m-airport" />
            <text x={7} y={4} className="m-label">
              {primary}
            </text>
          </g>
        )}
        {route.length > 1 && <path d={path(route)} className="m-route" />}
        {points.map(({ a, pos }) => {
          const p = px(pos);
          if (!inView(p)) return null;
          const isSel = a.id === selected;
          return (
            <g
              key={a.id}
              transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`}
              className={"m-ac " + (KIND_CLASS[a.startingConditions.type] ?? "") + (isSel ? " sel" : "")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setState({ selectedAircraftId: a.id })}
            >
              <circle r={isSel ? 5 : 3.2} />
              {(isSel || points.length <= 40 || v.span < 4) && (
                <text x={6} y={3.5}>
                  {a.aircraftId}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="map-bar">
        <span className="map-legend">
          <i className="k-ground" /> Ground <i className="k-final" /> Final <i className="k-air" /> Airborne
        </span>
        <span className="muted">
          {points.length}/{aircraft.length} placed · {v.span < 10 ? v.span.toFixed(1) : Math.round(v.span)} nm wide
        </span>
        <button className="small" onClick={() => setView(fitAirport() ?? v)}>
          Airport
        </button>
        <button className="small" onClick={() => setView(fitAll() ?? v)}>
          Fit all
        </button>
      </div>
      {!nav.loaded && !airportIds.length && <div className="map-note">Load nav data on the Setup page to see spawn positions.</div>}
    </div>
  );
}
