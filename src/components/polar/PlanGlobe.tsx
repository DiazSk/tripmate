"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreRenderer";
import "./ImagineDay.css";
import "./NightMap.css";
import "./nightMapMaplibre.css";
import { useReveal } from "./ImagineDay";
import { dayCost, fmtCost, fmtDur, LENS_ORDER, LENSES, routeAlongTrail, toMin, TRAIL, type LensId, type LngLat, type Stop } from "@/lib/petraDay";

/**
 * The plan behind the day, on the night globe. The section opens on the whole world, flies down to
 * Petra the first time it comes into view, and from then on the compact plan in the card drives
 * it: a row in focus flies the camera, Play walks the day.
 *
 * The app's own MapLibre over OpenFreeMap's dark style, a second self-contained map that exists
 * only on the landing. Fail-soft: no WebGL, or no map within LOAD_DEADLINE_MS, draws the same route
 * flat, and the plan beside it is complete either way. Loaded through `dynamic(ssr: false)` from
 * PolarLanding, so the first viewport never pulls MapLibre in.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const LOAD_DEADLINE_MS = 12000;
const FLY_MS = 2400;
const HOLD_MS = 2600;
const PETRA: LngLat = [35.4444, 30.3285];
const GLOBE = { center: [50, 30] as LngLat, zoom: 2.05, pitch: 0, bearing: 0 };
const wide = () => window.matchMedia("(min-width: 900px)").matches;
const globeView = () => (wide() ? GLOBE : { ...GLOBE, center: [40, 30] as LngLat, zoom: 1.05 });
// The card covers the left of the stage; everything the camera frames is pushed right of it.
// MapLibre keeps `padding` on the transform between moves, so moves use a one-off `offset` and
// overviews use cameraForBounds, which only computes.
const panelW = () => (wide() ? Math.min(480, window.innerWidth * 0.4) : 0);
const panelOffset = (): [number, number] => [panelW() / 2, 0];
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Engine = "loading" | "live" | "fallback";
type MapLibre = typeof import("maplibre-gl");
type MLMap = import("maplibre-gl").Map;
type Marker = import("maplibre-gl").Marker;
type GeoJSONSource = import("maplibre-gl").GeoJSONSource;
type MapStyleImageMissingEvent = import("maplibre-gl").MapStyleImageMissingEvent;

let enginePromise: Promise<MapLibre> | null = null;
/** The module, with the tile worker pointed at its static copy in `public/maplibre/`: MapLibre's
 *  own worker URL does not survive Turbopack (see CLAUDE.md). */
function loadEngine(): Promise<MapLibre> {
  if (!enginePromise) {
    enginePromise = import("maplibre-gl")
      .then((ml) => {
        ml.setWorkerUrl(MAPLIBRE_WORKER_URL);
        return ml;
      })
      .catch((e) => {
        enginePromise = null;
        throw e;
      });
  }
  return enginePromise;
}
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
const line = (coordinates: LngLat[]): GeoJSON.Feature<GeoJSON.LineString> => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
function bearing([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}º ${String(m).padStart(2, "0")}’ ${String(s).padStart(2, "0")}” ${v >= 0 ? pos : neg}`;
}
// Two stops in one place (the Treasury at dawn and by candlelight) would stack; nudge the later one.
const nudge = (stops: Stop[], i: number): [number, number] =>
  stops.slice(0, i).some((s) => s.at[0] === stops[i].at[0] && s.at[1] === stops[i].at[1]) ? [16, -16] : [0, 0];

// The day-rhythm bar spans 05:00 to 23:00; the tinted band is daylight (sunrise to sunset in April).
const DAY0 = 5 * 60;
const SPAN = 18 * 60;
const pct = (m: number) => `${((m - DAY0) / SPAN) * 100}%`;

export default function PlanGlobe({
  lens,
  setLens,
  hot,
  setHot,
  when,
  onOpen,
}: {
  lens: LensId;
  setLens: (l: LensId) => void;
  hot: string | null;
  setHot: (s: string | null) => void;
  /** The sample day, formatted ("Wed 14 Apr 2027"). */
  when: string;
  onOpen: () => void;
}) {
  const L = LENSES[lens];
  const stops = L.stops;
  const section = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const engineRef = useRef<MapLibre | null>(null);
  const cityPin = useRef<Marker | null>(null);
  const markers = useRef<{ id: string; el: HTMLElement; m: Marker }[]>([]);
  const flyTimer = useRef<number | undefined>(undefined);
  // No WebGL is decided here (this component never renders on the server), so the boot has
  // nothing to set synchronously.
  const [engine, setEngine] = useState<Engine>(() => (webglAvailable() ? "loading" : "fallback"));
  const [arrived, setArrived] = useState(false); // false = the whole world, true = at Petra
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState<"Globe" | "City" | "Street">("Globe");
  const hotIndex = stops.findIndex((s) => s.id === hot);
  const focus = hotIndex >= 0 ? stops[hotIndex].at : arrived ? PETRA : GLOBE.center;
  const totals = useMemo(() => ({ km: stops.reduce((s, x) => s + (x.next?.km ?? 0) + (x.walkKm ?? 0), 0), cost: dayCost(stops) }), [stops]);
  useReveal([lens]);

  const fly = (opts: Record<string, unknown>, ms = FLY_MS) => {
    const m = map.current;
    if (!m) return;
    if (reduced()) m.easeTo({ ...opts, duration: 0 });
    else m.flyTo({ ...opts, duration: ms, curve: 1.5, essential: false });
  };
  // A pin the camera has carried to (or past) the stage's edge is hidden, not left cut in half: at street
  // zoom the other stops are off the map, and half a numbered disc on its border reads as a mistake.
  // visibility, not display, so the pin keeps its box and returns as the camera does.
  const cullPins = () => {
    const m = map.current;
    if (!m) return;
    const c = m.getCanvas().getBoundingClientRect();
    markers.current.forEach(({ el }) => {
      const r = el.getBoundingClientRect();
      el.style.visibility = r.left < c.left || r.right > c.right || r.top < c.top || r.bottom > c.bottom ? "hidden" : "";
    });
  };
  const overview = (ms = 3600) => {
    const m = map.current;
    const ml = engineRef.current;
    if (!m || !ml) return;
    const b = new ml.LngLatBounds();
    stops.forEach((s) => b.extend(s.at));
    // The flight ends turned -18 degrees, and a box fitted unturned loses its corners past the edge
    // once it is: fit the turned one, so the nearest and farthest pins keep their padding.
    const fit = { bearing: -18, maxZoom: 15 };
    const cam = m.cameraForBounds(b, wide() ? { ...fit, padding: { top: 110, bottom: 110, left: panelW() + 60, right: 120 } } : { ...fit, padding: 50 });
    if (cam) fly({ ...cam, pitch: 42, bearing: -18 }, ms);
  };
  const toPetra = () => {
    setArrived(true);
    overview();
  };
  const toGlobe = () => {
    setPlaying(false);
    setHot(null);
    setArrived(false);
    fly({ ...globeView(), offset: panelOffset() }, 3200);
  };
  // The city pin is built once, inside the boot effect, so its click reaches the current toPetra
  // through a ref rather than the one that existed when the map loaded.
  const toPetraRef = useRef(toPetra);
  useEffect(() => {
    toPetraRef.current = toPetra;
  });

  // ── Boot the engine on the whole world; fail soft to a flat drawing of the route ──
  useEffect(() => {
    if (!webglAvailable()) return;
    let cancelled = false;
    const deadline = window.setTimeout(() => !cancelled && !map.current && setEngine("fallback"), LOAD_DEADLINE_MS);
    loadEngine()
      .then((ml) => {
        if (cancelled || !host.current) return;
        engineRef.current = ml;
        const m = new ml.Map({ container: host.current, style: STYLE_URL, ...globeView(), attributionControl: { compact: true }, cooperativeGestures: true, keyboard: false, maxPitch: 70 });
        // The map is a picture of the plan (its canvas container is aria-hidden; the day card beside it carries every
        // stop as a real row and Play), so nothing on it is a Tab stop. MapLibre makes the canvas one.
        m.getCanvas().tabIndex = -1;
        // Hide the picture, not the host: the attribution control is licence text a keyboard user may open.
        m.getCanvasContainer().setAttribute("aria-hidden", "true");
        map.current = m;
        // `render`, not `move`: the markers position themselves on `move`, so a handler there can read the
        // previous frame. Maplibre only renders when something changed, so this costs nothing at rest.
        m.on("render", cullPins);
        m.on("style.load", () => {
          try {
            m.setProjection({ type: "globe" });
          } catch {
            /* older engines draw Mercator; still a map */
          }
          // Pull OpenFreeMap's dark style onto the night palette.
          const set = (id: string, prop: Parameters<MLMap["setPaintProperty"]>[1], v: Parameters<MLMap["setPaintProperty"]>[2]) => {
            try {
              if (m.getLayer(id)) m.setPaintProperty(id, prop, v);
            } catch {
              /* layer shape differs between style versions */
            }
          };
          set("background", "background-color", "#090b10");
          set("water", "fill-color", "#0d1622");
          set("building", "fill-color", "#161a24");
          for (const id of ["highway_minor", "highway_path"]) set(id, "line-color", "#283044");
          try {
            m.setSky({ "sky-color": "#090b10", "horizon-color": "#1b2436", "fog-color": "#090b10", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.6, 8, 0] });
          } catch {
            /* sky is decoration */
          }
          m.addSource("trail", { type: "geojson", data: line(TRAIL) });
          m.addSource("route", { type: "geojson", data: line([]) });
          m.addLayer({ id: "trail", type: "line", source: "trail", minzoom: 11, paint: { "line-color": "#a8acb3", "line-width": 1.2, "line-opacity": 0.35, "line-dasharray": [2, 2] } });
          m.addLayer({ id: "route-glow", type: "line", source: "route", paint: { "line-color": "#6af0ff", "line-width": 8, "line-opacity": 0.14, "line-blur": 4 } });
          m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#6af0ff", "line-width": 2.2 } });
          const el = document.createElement("button");
          el.type = "button";
          el.className = "nm-city-pin";
          el.tabIndex = -1;
          el.setAttribute("aria-label", "Fly to Petra");
          el.innerHTML = '<span class="nm-city-dot"></span><span class="nm-city-name">Petra</span>';
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            toPetraRef.current();
          });
          cityPin.current = new ml.Marker({ element: el, anchor: "left", offset: [-6, 0] }).setLngLat(PETRA).addTo(m);
        });
        m.once("load", () => {
          window.clearTimeout(deadline);
          m.easeTo({ ...globeView(), offset: panelOffset(), duration: 0 });
          // The compact attribution opens itself on wide maps; start it folded to its button.
          host.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          if (!cancelled) setEngine("live");
        });
        m.on("error", () => {
          /* a failed tile is not a failed map */
        });
        m.on("styleimagemissing", (e: MapStyleImageMissingEvent) => {
          if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
        });
        m.on("dragstart", () => setPlaying(false));
        // Stop pins only mean something near the ground; the city pin only from far away.
        m.on("zoom", () => {
          const far = m.getZoom() < 9;
          host.current?.classList.toggle("is-far", far);
          const pin = cityPin.current?.getElement();
          if (pin) pin.style.display = far ? "" : "none";
        });
        m.on("zoomend", () => {
          const z = m.getZoom();
          setScale(z < 5 ? "Globe" : z < 13.5 ? "City" : "Street");
        });
      })
      .catch(() => !cancelled && setEngine("fallback"));
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      window.clearTimeout(flyTimer.current);
      map.current?.remove();
      map.current = null;
    };
    // Once per mount: the map is built a single time and everything after it moves the camera.
  }, []);

  // ── The first time the section is properly in view, leave the globe for Petra ──
  useEffect(() => {
    if (engine !== "live" || arrived || !section.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        toPetra();
      },
      { threshold: 0.55 }
    );
    io.observe(section.current);
    return () => io.disconnect();
    // Armed once, when the map goes live; `arrived` only ever stops it re-arming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // ── Draw the chosen way of the day ──
  useEffect(() => {
    const m = map.current;
    const ml = engineRef.current;
    if (engine !== "live" || !m || !ml) return;
    markers.current.forEach((x) => x.m.remove());
    m.getSource<GeoJSONSource>("route")?.setData(line(routeAlongTrail(stops.map((s) => s.at))));
    markers.current = stops.map((s, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "nm-stop-pin";
      el.tabIndex = -1;
      el.setAttribute("aria-label", `${s.time} ${s.title}`);
      const n = document.createElement("span");
      n.className = "nm-stop-n";
      n.textContent = String(i + 1);
      const tag = document.createElement("span");
      tag.className = "nm-stop-tag";
      const time = document.createElement("em");
      time.textContent = s.time;
      tag.append(time, s.title);
      el.append(n, tag);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setPlaying(false);
        setArrived(true);
        setHot(s.id);
      });
      return { id: s.id, el, m: new ml.Marker({ element: el, anchor: "center", offset: nudge(stops, i) }).setLngLat(s.at).addTo(m) };
    });
    cullPins();
    if (arrived) overview(1600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, stops]);

  // ── The stop in focus lights its pin and, after a short settle, moves the camera ──
  useEffect(() => {
    markers.current.forEach(({ id, el }, i) => {
      el.classList.toggle("is-on", id === hot);
      el.classList.toggle("is-past", hotIndex >= 0 && i < hotIndex);
      el.classList.toggle("show-tag", id === hot);
    });
    if (engine !== "live" || !map.current) return;
    window.clearTimeout(flyTimer.current);
    flyTimer.current = window.setTimeout(() => {
      if (hotIndex < 0) {
        if (arrived) overview(1600);
        return;
      }
      setArrived(true);
      const s = stops[hotIndex];
      const next = stops[hotIndex + 1];
      const prev = stops[hotIndex - 1];
      const b = next ? bearing(s.at, next.at) : prev ? bearing(prev.at, s.at) : -18;
      // Right of the card, and left of centre in what is left, so the pin's name has room.
      fly({ center: s.at, zoom: 16, pitch: 58, bearing: b, offset: [panelOffset()[0] - 60, 30] });
    }, 280);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hot, hotIndex, engine]);

  // ── Playback: the stop in focus is the clock, so a row picked mid-play simply continues from there ──
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(
      () => {
        if (hotIndex + 1 >= stops.length) {
          setPlaying(false);
          setHot(null);
        } else setHot(stops[hotIndex + 1].id);
      },
      hotIndex < 0 ? 300 : (reduced() ? 0 : FLY_MS) + HOLD_MS
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hotIndex, stops]);

  // Keep the row in focus visible inside the card's own scroll while the day plays.
  useEffect(() => {
    if (playing && hot) document.getElementById(`stop-${hot}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing, hot]);

  return (
    <section ref={section} className="nm" aria-label="The plan behind it, on the map">
      <div className="nm-stage">
        {/* Positioned inline: MapLibre's own `.maplibregl-map { position: relative }` lands on this
            element and outranks a class, which collapses the map to zero height. */}
        <div ref={host} className={`nm-canvas${engine === "live" ? " is-live" : ""}`} style={{ position: "absolute", inset: 0 }} />
        {engine === "fallback" && <FallbackRoute stops={stops} hot={hot} onHot={setHot} />}
        <div className="nm-vignette" aria-hidden="true" />
        {engine === "loading" && (
          <div className="nm-status" role="status">
            <span className="nm-spinner" aria-hidden="true" />
            Loading the map…
          </div>
        )}
        <div className="nm-hud">
          <span className="nm-scale">{engine === "fallback" ? "Overview" : scale}</span>
          <span className="nm-coord">
            [ {dms(focus[1], "N", "S")}, {dms(focus[0], "E", "W")} ]
          </span>
          {engine === "live" &&
            (arrived ? (
              <button type="button" className="nm-chip" onClick={toGlobe}>
                Back to the globe
              </button>
            ) : (
              <button type="button" className="nm-chip" onClick={toPetra}>
                Fly to Petra
              </button>
            ))}
        </div>
      </div>

      {/* The plan, compact: the row in focus opens to its reasons, the rest stay one line. On a wide
          screen it is centred in the stage below the app's fixed navbar. */}
      <div
        data-lenis-prevent
        className="relative z-[3] mx-4 mb-16 mt-3 flex max-h-[44rem] flex-col overflow-hidden rounded-[6px] bg-white text-[var(--ink)] shadow-[0_24px_60px_rgba(0,0,0,.35)] min-[900px]:absolute min-[900px]:left-5 min-[900px]:top-[calc(50%+var(--nav-h)/2)] min-[900px]:m-0 min-[900px]:max-h-[calc(100%-5rem-var(--nav-h))] min-[900px]:w-[min(30rem,40vw)] min-[900px]:-translate-y-1/2"
      >
        <header className="border-b border-[var(--rule)] p-5">
          <p className="pl-eyebrow text-[var(--signal-text)]">The plan behind it</p>
          <h2 className="pl-display mt-3 text-[clamp(30px,2.6vw,40px)]">The same day, written down.</h2>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="pl-label text-[12px] text-[var(--charcoal)]">Day 2 · {when} · Sample</p>
            <div role="radiogroup" aria-label="Way to travel" className="flex gap-0.5 rounded-[3px] bg-[var(--paper)] p-0.5">
              {LENS_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={id === lens}
                  onClick={() => setLens(id)}
                  className={`rounded-[2px] px-2.5 py-1 text-[12px] font-semibold transition-colors duration-200 ${id === lens ? "bg-[var(--ink)] text-white" : "hover:bg-white"}`}
                >
                  {LENSES[id].short}
                </button>
              ))}
            </div>
          </div>
          <dl className="pl-tnum mt-4 grid grid-cols-3 gap-3">
            {[
              ["Stops", String(stops.length)],
              ["On foot", `≈ ${totals.km.toFixed(1)} km`],
              ["Per person", `$${totals.cost}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="pl-label text-[11px] text-[var(--charcoal)]">{k}</dt>
                <dd className="text-[18px] font-normal">{v}</dd>
              </div>
            ))}
          </dl>
          <div key={lens} data-reveal-group className="relative mt-4 h-3 rounded-[2px] bg-[var(--paper)]" aria-hidden>
            <span className="absolute inset-y-0 bg-[rgba(255,126,21,.14)]" style={{ left: pct(toMin("06:12")), right: `calc(100% - ${pct(toMin("19:04"))})` }} />
            {stops.map((s, i) => (
              <span
                key={s.id}
                className="pl-seg absolute inset-y-0.5 rounded-[1px]"
                style={{ left: pct(toMin(s.time)), width: `${(s.min / SPAN) * 100}%`, backgroundColor: hot === s.id ? "var(--signal)" : "var(--ink)", ...({ "--d": `${i * 80}ms` } as CSSProperties) }}
              />
            ))}
          </div>
        </header>

        <ol key={lens} className="pl-swap min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {stops.map((s, i) => {
            const open = s.id === hot;
            return (
              <li key={s.id} className="border-b border-[var(--rule)] last:border-b-0">
                <button
                  type="button"
                  id={`stop-${s.id}`}
                  aria-expanded={open}
                  // Not while playing: the play scrolls rows under a resting pointer, and the
                  // mouseenter that follows would pull the day back to whichever row is there.
                  onMouseEnter={() => !playing && setHot(s.id)}
                  onFocus={() => setHot(s.id)}
                  onClick={() => {
                    setPlaying(false);
                    setHot(s.id);
                  }}
                  className={`pl-row grid w-full grid-cols-[46px_22px_1fr_auto] items-start gap-x-3 px-5 py-3.5 text-left ${open ? "bg-[rgba(255,126,21,.07)]" : "hover:bg-[var(--paper)]"}`}
                >
                  <span className="pl-tnum pt-0.5">
                    <span className="block text-[14px] font-semibold">{s.time}</span>
                    <span className="block text-[11px] text-[var(--charcoal)]">{fmtDur(s.min)}</span>
                  </span>
                  <span
                    className={`pl-tnum mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-semibold transition-colors duration-200 ${open ? "bg-[var(--signal)] text-[var(--ink)]" : "bg-[var(--ink)] text-white"}`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="pl-label block text-[11px] text-[var(--charcoal)]">{s.kind}</span>
                    <span className="pl-serif block text-[21px] leading-[1.1]">{s.title}</span>
                    <span className={`grid transition-[grid-template-rows] duration-500 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <span className="overflow-hidden">
                        <span className="mt-1.5 block text-[14px] leading-[1.5]">{s.why}</span>
                        <span className="mt-2 flex gap-2 text-[13px] leading-[1.45] text-[var(--charcoal)]">
                          <span aria-hidden className="text-[10px] leading-[19px]">
                            ●
                          </span>
                          <span>{s.practical}</span>
                        </span>
                        {s.next && <span className="pl-tnum mt-2 block text-[12px] text-[var(--charcoal)]">↓ {s.next.text}</span>}
                      </span>
                    </span>
                  </span>
                  <span className="pl-tnum pt-0.5 text-right text-[14px] font-semibold">{fmtCost(s.cost)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--rule)] p-4">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
            className="flex items-center gap-2 rounded-[2px] bg-[var(--ink)] px-3.5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2c374b]"
          >
            {playing ? "Pause" : hotIndex >= 0 ? "Resume" : "Play the day"} <span aria-hidden>{playing ? "❚❚" : "▸"}</span>
          </button>
          <span className="pl-tnum text-[12px] text-[var(--charcoal)]" aria-live="polite">
            {hotIndex >= 0 ? `Stop ${hotIndex + 1} of ${stops.length}` : `${stops.length} stops`}
          </span>
          <button type="button" onClick={onOpen} className="pl-cta ml-auto px-4 py-2.5 text-[13px]">
            Open in the planner →
          </button>
        </footer>
      </div>
    </section>
  );
}

// Without WebGL (or the map), the same route drawn flat: the plan beside it is complete either way.
const B = { w: 35.4275, e: 35.4795, s: 30.318, n: 30.3405 };
const proj = ([lon, lat]: LngLat) => ({ x: 20 + ((lon - B.w) / (B.e - B.w)) * 360, y: 80 + ((B.n - lat) / (B.n - B.s)) * 240 });
const path = (ps: LngLat[]) =>
  ps
    .map(proj)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
function FallbackRoute({ stops, hot, onHot }: { stops: Stop[]; hot: string | null; onHot: (id: string | null) => void }) {
  return (
    <svg viewBox="-260 0 660 400" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="img" aria-label={`Route of ${stops.length} stops from Wadi Musa into Petra`}>
      <path d={path(TRAIL)} fill="none" stroke="#283044" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path(routeAlongTrail(stops.map((s) => s.at)))} fill="none" stroke="#6af0ff" strokeWidth="2" strokeLinejoin="round" />
      {stops.map((s, i) => {
        const p = proj(s.at);
        const [dx, dy] = nudge(stops, i).map((v) => v * 0.8);
        const on = s.id === hot;
        return (
          <g key={s.id} onMouseEnter={() => onHot(s.id)} className="cursor-pointer">
            <circle cx={p.x + dx} cy={p.y + dy} r="10" fill={on ? "#6af0ff" : "#090b10"} stroke="#fff" strokeWidth="1.5" />
            <text x={p.x + dx} y={p.y + dy + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={on ? "#090b10" : "#fff"} pointerEvents="none">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
