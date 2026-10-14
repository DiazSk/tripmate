'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAPLIBRE_WORKER_URL } from '@/lib/maplibreRenderer';
import './NightMap.css';
import './nightMapMaplibre.css';
import { MAP_VIEWBOX, WORLD_LAND_PATH, projectToMap } from '@/lib/worldLand';

// The app's own MapLibre over OpenFreeMap's dark style — the same engine and tiles as the trip
// view, in a second, self-contained map that exists only on the landing.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const LOAD_DEADLINE_MS = 12000;
const FLY_MS = 2600;
const HOLD_MS = 2600;
type LngLat = [number, number];
type Stop = {
  tagLeft?: boolean;
  time: string;
  name: string;
  note: string;
  at: LngLat;
};
type City = {
  labelLeft?: boolean;
  id: string;
  name: string;
  country: string;
  days: string;
  center: LngLat;
  stops: Stop[];
};

// Illustrative days. The places and their coordinates are real; the times are an example.
const CITIES: City[] = [{
  id: 'jaipur',
  name: 'Jaipur',
  country: 'India',
  days: 'Day 2 of 7',
  center: [75.835, 26.95],
  stops: [{
    time: '08:30',
    name: 'Amber Fort',
    note: 'Before the heat and the coaches',
    at: [75.8513, 26.9855]
  }, {
    time: '10:45',
    tagLeft: true,
    name: 'Panna Meena ka Kund',
    note: 'Stepwell, a short walk below the fort',
    at: [75.8556, 26.9876]
  }, {
    time: '13:00',
    tagLeft: true,
    name: 'Hawa Mahal',
    note: 'Old city, lunch nearby',
    at: [75.8267, 26.9239]
  }, {
    time: '15:15',
    name: 'Jantar Mantar',
    note: 'Open-air instruments, mostly shade-free',
    at: [75.8246, 26.9248]
  }, {
    time: '18:10',
    name: 'Nahargarh Fort',
    note: 'The blue hour over the Pink City',
    at: [75.8155, 26.9373]
  }]
}, {
  id: 'orcia',
  labelLeft: true,
  name: "Val d'Orcia",
  country: 'Italy',
  days: 'Day 3 of 9',
  center: [11.6, 43.055],
  stops: [{
    time: '08:00',
    name: 'Cappella di Vitaleta',
    note: 'Mist still in the valley',
    at: [11.6403, 43.0606]
  }, {
    time: '10:00',
    name: 'Pienza',
    note: 'Pecorino, the walls, the view south',
    at: [11.6789, 43.0766]
  }, {
    time: '13:00',
    name: 'Bagno Vignoni',
    note: 'Lunch beside the thermal pool',
    at: [11.6175, 43.0278]
  }, {
    time: '15:30',
    name: "San Quirico d'Orcia",
    note: 'Horti Leonini, slow afternoon',
    at: [11.6053, 43.0587]
  }, {
    time: '18:30',
    name: 'Montalcino',
    note: 'Last light from the fortress',
    at: [11.489, 43.0581]
  }]
}, {
  id: 'sinaia',
  name: 'Sinaia',
  country: 'Romania',
  days: 'Day 1 of 6',
  center: [25.54, 45.352],
  stops: [{
    time: '09:00',
    name: 'Peleș Castle',
    note: 'First tour of the day',
    at: [25.5427, 45.3599]
  }, {
    time: '11:00',
    tagLeft: true,
    name: 'Pelișor Castle',
    note: 'Next door, quieter',
    at: [25.541, 45.3586]
  }, {
    time: '13:00',
    name: 'Sinaia Monastery',
    note: 'Warm lunch in town after',
    at: [25.5513, 45.3539]
  }, {
    time: '15:00',
    name: 'Cota 1400',
    note: 'Cable car — only if the wind allows',
    at: [25.5196, 45.3423]
  }, {
    time: '17:30',
    name: 'Casino Sinaia',
    note: 'Park walk as the lamps come on',
    at: [25.5527, 45.3508]
  }]
}];
const GLOBE_VIEW = {
  center: [50, 30] as LngLat,
  zoom: 2.05,
  pitch: 0,
  bearing: 0
};
const globeView = () => window.matchMedia('(min-width: 900px)').matches ? GLOBE_VIEW : {
  ...GLOBE_VIEW,
  center: [48, 34] as LngLat,
  zoom: 1.05
};
type Engine = 'loading' | 'live' | 'fallback';
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}º ${String(m).padStart(2, '0')}’ ${String(s).padStart(2, '0')}” ${v >= 0 ? pos : neg}`;
}
const coordLabel = ([lng, lat]: LngLat) => `[ ${dms(lat, 'N', 'S')}, ${dms(lng, 'E', 'W')} ]`;
function bearing([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
type MapLibre = typeof import('maplibre-gl');
type MLMap = import('maplibre-gl').Map;
type Marker = import('maplibre-gl').Marker;
type GeoJSONSource = import('maplibre-gl').GeoJSONSource;
type MapStyleImageMissingEvent = import('maplibre-gl').MapStyleImageMissingEvent;
let enginePromise: Promise<MapLibre> | null = null;
/** The module, with the tile worker pointed at its static copy — the same fix createMapLibreMap
 *  makes, for the same reason: MapLibre's own worker URL does not survive Turbopack. */
function loadEngine(): Promise<MapLibre> {
  if (!enginePromise) {
    enginePromise = import('maplibre-gl')
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
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
function lineFeature(coords: LngLat[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords
    }
  };
}
export default function NightMap() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const engineRef = useRef<MapLibre | null>(null);
  const cityMarkers = useRef<Marker[]>([]);
  const stopMarkers = useRef<{
    el: HTMLElement;
    m: Marker;
  }[]>([]);
  const timer = useRef<number | undefined>(undefined);
  // Set by any camera move; the first-load framing must not undo a city picked while tiles load.
  const moved = useRef(false);
  const [engine, setEngine] = useState<Engine>(() => (webglAvailable() ? 'loading' : 'fallback'));
  const [cityId, setCityId] = useState<string | null>(null);
  const [beat, setBeat] = useState(-1); // -1 = the day's overview
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState<'Globe' | 'City' | 'Street'>('Globe');
  const city = CITIES.find(c => c.id === cityId) ?? null;
  const focus: LngLat = city ? beat >= 0 ? city.stops[beat].at : city.center : GLOBE_VIEW.center;

  function tint(m: MLMap) {
    // Pull OpenFreeMap's dark style onto the token palette: night ground, deep water, ink roads.
    const set = (id: string, prop: Parameters<MLMap['setPaintProperty']>[1], v: Parameters<MLMap['setPaintProperty']>[2]) => {
      try {
        if (m.getLayer(id)) m.setPaintProperty(id, prop, v);
      } catch {
        /* layer shape differs between style versions */
      }
    };
    set('background', 'background-color', '#090b10');
    set('water', 'fill-color', '#0d1622');
    set('landuse_residential', 'fill-color', '#10131b');
    set('landcover_wood', 'fill-color', '#0e1218');
    set('landuse_park', 'fill-color', '#0f151a');
    set('building', 'fill-color', '#161a24');
    for (const id of ['highway_minor', 'highway_path']) set(id, 'line-color', '#1c2230');
    for (const id of ['highway_major_inner', 'highway_major_subtle', 'highway_motorway_inner', 'highway_motorway_subtle']) set(id, 'line-color', '#283044');
    for (const id of ['place_city', 'place_city_large', 'place_town', 'place_village', 'place_suburb', 'place_state', 'place_country_major', 'place_country_minor', 'place_country_other', 'water_name', 'highway_name_other', 'highway_name_motorway']) {
      set(id, 'text-color', '#8a8e96');
      set(id, 'text-halo-color', '#090b10');
      try {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]);
      } catch {
        /* keep the style's own label */
      }
    }
    for (const id of ['place_state', 'place_country_major', 'place_country_minor', 'place_country_other']) set(id, 'text-opacity', 0.5);
    try {
      m.setSky({
        'sky-color': '#090b10',
        'horizon-color': '#1b2436',
        'fog-color': '#090b10',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.5,
        'fog-ground-blend': 0.4,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.6, 8, 0]
      });
    } catch {
      /* sky is decoration */
    }
  }
  function addCityMarkers(ml: MapLibre, m: MLMap) {
    cityMarkers.current.forEach(c => c.remove());
    cityMarkers.current = CITIES.map(c => {
      const el = document.createElement('button');
      el.className = `nm-city-pin${c.labelLeft ? ' is-left' : ''}`;
      el.type = 'button';
      el.setAttribute('aria-label', `Show a day in ${c.name}`);
      el.innerHTML = `<span class="nm-city-dot"></span><span class="nm-city-name">${c.name}</span>`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        chooseRef.current(c.id);
      });
      return new ml.Marker({
        element: el,
        anchor: c.labelLeft ? 'right' : 'left',
        offset: [c.labelLeft ? 6 : -6, 0]
      }).setLngLat(c.center).addTo(m);
    });
  }
  const fly = useCallback((opts: Record<string, unknown>, ms = FLY_MS) => {
    const m = map.current;
    if (!m) return;
    moved.current = true;
    if (reducedMotion()) m.easeTo({
      ...opts,
      duration: 0
    });else m.flyTo({
      ...opts,
      duration: ms,
      curve: 1.5,
      essential: false
    });
  }, []);
  const panelPadding = useCallback(() => {
    const wide = window.matchMedia('(min-width: 900px)').matches;
    // Clear the panel on the left, the How-it-works tab on the right and the stats bottom-right.
    return wide ? {
      top: 110,
      bottom: 170,
      left: Math.min(460, window.innerWidth * 0.36) + 40,
      right: 150
    } : {
      top: 50,
      bottom: 50,
      left: 40,
      right: 40
    };
  }, []);
  // MapLibre keeps `padding` on the transform between moves, so a second padded move doubles it.
  // Stops and the globe use a one-off `offset`; overviews use cameraForBounds, which only computes.
  const panelOffset = useCallback((): [number, number] => {
    const wide = window.matchMedia('(min-width: 900px)').matches;
    return wide ? [Math.min(460, window.innerWidth * 0.36) / 2, 0] : [0, 0];
  }, []);
  const overview = useCallback((c: City, ms = 3600) => {
    const m = map.current;
    const ml = engineRef.current;
    if (!m || !ml) return;
    const b = new ml.LngLatBounds();
    c.stops.forEach(s => b.extend(s.at));
    const cam = m.cameraForBounds(b, {
      padding: panelPadding(),
      maxZoom: 14.5
    });
    if (cam) fly({
      ...cam,
      pitch: 38,
      bearing: -12
    }, ms);
  }, [fly, panelPadding]);

  // ── Draw the chosen city's stops and route ──
  useEffect(() => {
    const m = map.current;
    const ml = engineRef.current;
    if (engine !== 'live' || !m || !ml) return;
    stopMarkers.current.forEach(s => s.m.remove());
    stopMarkers.current = [];
    cityMarkers.current.forEach(cm => city ? cm.remove() : cm.addTo(m));
    const route = m.getSource<GeoJSONSource>('route');
    if (!city) {
      route?.setData(lineFeature([]));
      m.getSource<GeoJSONSource>('route-done')?.setData(lineFeature([]));
      return;
    }
    route?.setData(lineFeature(city.stops.map(s => s.at)));
    stopMarkers.current = city.stops.map((s, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `nm-stop-pin${s.tagLeft ? ' tag-left' : ''}`;
      el.setAttribute('aria-label', `${s.time} ${s.name}`);
      el.innerHTML = `<span class="nm-stop-n">${i + 1}</span><span class="nm-stop-tag"><em>${s.time}</em>${s.name}</span>`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        setPlaying(false);
        setBeat(i);
      });
      return {
        el,
        m: new ml.Marker({
          element: el,
          anchor: 'center'
        }).setLngLat(s.at).addTo(m)
      };
    });
  }, [engine, city]);

  // ── The beat drives the camera, the route and the row highlight ──
  useEffect(() => {
    const m = map.current;
    if (!city) return;
    stopMarkers.current.forEach(({
      el
    }, i) => {
      el.classList.toggle('is-on', i === beat);
      el.classList.toggle('is-past', beat >= 0 && i < beat);
      el.classList.toggle('show-tag', beat < 0 || i === beat);
    });
    if (m && engine === 'live') {
      m.getSource<GeoJSONSource>('route-done')?.setData(lineFeature(beat > 0 ? city.stops.slice(0, beat + 1).map(s => s.at) : []));
      if (beat >= 0) {
        const s = city.stops[beat];
        // Face the direction of travel, so the next place is ahead of you as you arrive.
        const next = city.stops[beat + 1];
        const prev = city.stops[beat - 1];
        const b = next ? bearing(s.at, next.at) : prev ? bearing(prev.at, s.at) : 0;
        fly({
          center: s.at,
          zoom: 15.6,
          pitch: 58,
          bearing: b,
          offset: panelOffset()
        });
      }
    }
  }, [beat, city, engine, fly, panelOffset]);

  // ── Playback clock ──
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!playing || !city) return;
    const wait = beat < 0 ? 600 : (reducedMotion() ? 0 : FLY_MS) + HOLD_MS;
    timer.current = window.setTimeout(() => {
      if (beat + 1 >= city.stops.length) {
        setPlaying(false);
        setBeat(-1);
        overview(city, 3000);
      } else setBeat(beat + 1);
    }, wait);
    return () => window.clearTimeout(timer.current);
  }, [playing, beat, city, overview]);
  function chooseCity(id: string) {
    const c = CITIES.find(x => x.id === id)!;
    setPlaying(false);
    setBeat(-1);
    setCityId(id);
    overview(c);
  }
  function play() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!city) {
      chooseCity(CITIES[0].id);
      window.setTimeout(() => setPlaying(true), reducedMotion() ? 0 : 3200);
      return;
    }
    if (beat >= city.stops.length - 1) setBeat(-1);
    setPlaying(true);
  }
  function step(d: number) {
    if (!city) return;
    setPlaying(false);
    setBeat(b => Math.max(0, Math.min(city.stops.length - 1, b + d)));
  }
  function toGlobe() {
    setPlaying(false);
    setBeat(-1);
    setCityId(null);
    fly({
      ...globeView(),
      offset: panelOffset()
    }, 3200);
  }
  // The city pins are built once, inside the boot effect, so their clicks reach the current
  // chooseCity through a ref rather than the one that existed when the map loaded.
  const chooseRef = useRef(chooseCity);
  useEffect(() => {
    chooseRef.current = chooseCity;
  });

  // ── Boot the engine, fail soft to the SVG world ──
  useEffect(() => {
    let cancelled = false;
    // No WebGL is decided in the state's initial value, so there is nothing to boot.
    if (!webglAvailable()) return;
    const deadline = window.setTimeout(() => !cancelled && !map.current && setEngine('fallback'), LOAD_DEADLINE_MS);
    loadEngine().then(ml => {
      if (cancelled || !host.current) return;
      engineRef.current = ml;
      const m = new ml.Map({
        container: host.current,
        style: STYLE_URL,
        ...GLOBE_VIEW,
        attributionControl: {
          compact: true
        },
        cooperativeGestures: true,
        maxPitch: 70
      });
      map.current = m;
      m.on('style.load', () => {
        try {
          m.setProjection({
            type: 'globe'
          });
        } catch {
          /* older engines draw Mercator; still a map */
        }
        tint(m);
        m.addSource('route', {
          type: 'geojson',
          data: lineFeature([])
        });
        m.addSource('route-done', {
          type: 'geojson',
          data: lineFeature([])
        });
        m.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#6af0ff',
            'line-width': 1.6,
            'line-opacity': 0.55,
            'line-dasharray': [2, 2]
          }
        });
        m.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route-done',
          paint: {
            'line-color': '#6af0ff',
            'line-width': 8,
            'line-opacity': 0.14,
            'line-blur': 4
          }
        });
        m.addLayer({
          id: 'route-done',
          type: 'line',
          source: 'route-done',
          paint: {
            'line-color': '#6af0ff',
            'line-width': 2.4
          }
        });
        addCityMarkers(ml, m);
      });
      m.once('load', () => {
        window.clearTimeout(deadline);
        if (!moved.current) m.easeTo({
          ...globeView(),
          offset: panelOffset(),
          duration: 0
        });
        if (!cancelled) setEngine('live');
      });
      m.on('error', () => {
        /* a failed tile is not a failed map */
      });
      m.on('styleimagemissing', (e: MapStyleImageMissingEvent) => {
        if (!m.hasImage(e.id)) m.addImage(e.id, {
          width: 1,
          height: 1,
          data: new Uint8Array(4)
        });
      });
      m.on('dragstart', () => setPlaying(false));
      // Stop pins only mean something at city scale; zoomed out they pile onto one point.
      m.on('zoom', () => host.current?.classList.toggle('is-far', m.getZoom() < 9));
      m.on('zoomend', () => {
        const z = m.getZoom();
        setScale(z < 5 ? 'Globe' : z < 13.5 ? 'City' : 'Street');
      });
    }).catch(() => !cancelled && setEngine('fallback'));
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      window.clearTimeout(timer.current);
      map.current?.remove();
      map.current = null;
    };
    // Once per mount: the map is built a single time and everything after it moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = city ?? CITIES[0];
  return <section className="nm" id="day" aria-label="A day on the map">
      <div className="nm-stage">
        {/* Positioned inline: MapLibre's own `.maplibregl-map { position: relative }` lands on this
            element and outranks a class, which collapses the map to zero height. */}
        <div ref={host} className={`nm-canvas${engine === 'live' ? ' is-live' : ''}`} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />

        {engine === 'fallback' && <svg className="nm-world" viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <pattern id="nm-stipple" width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="0.9" fill="rgba(168,172,179,0.32)" />
              </pattern>
            </defs>
            <path d={WORLD_LAND_PATH} fill="url(#nm-stipple)" stroke="rgba(168,172,179,0.25)" strokeWidth="0.6" />
            {CITIES.map(c => {
          const p = projectToMap(c.center[1], c.center[0]);
          const on = c.id === cityId;
          return <g key={c.id} transform={`translate(${p.x} ${p.y})`} className={`nm-world-pin${on ? ' is-on' : ''}`}>
                  <circle r={on ? 9 : 6} className="nm-world-halo" />
                  <circle r="3" className="nm-world-dot" />
                  <text x="9" y="4">{c.name}</text>
                </g>;
        })}
          </svg>}

        <div className="nm-vignette" aria-hidden="true" />

        {engine === 'loading' && <div className="nm-status" role="status">
            <span className="nm-spinner" aria-hidden="true" />
            Loading the map…
          </div>}

        <div className="nm-hud">
          <span className="nm-scale">{engine === 'fallback' ? 'Overview' : scale}</span>
          <span className="nm-coord">{coordLabel(focus)}</span>
          {city && engine === 'live' && <button className="nm-chip" onClick={toGlobe}>
              Back to the globe
            </button>}
        </div>
        {engine === 'fallback' && <p className="nm-fallback-note">Live map unavailable here — showing the world overview.</p>}
      </div>

      <div className="nm-panel">
        <p className="nm-kicker">Illustrative day · real places</p>
        <h2 className="nm-title"><span>Press play</span> <span>on a day</span></h2>
        <p className="nm-body">
          Story mode flies the camera to each stop while a voice reads the day. The order is the plan; the timing is the forecast.
        </p>

        <div className="nm-cities" role="tablist" aria-label="Choose a day">
          {CITIES.map(c => <button key={c.id} role="tab" aria-selected={c.id === cityId} className="nm-city-tab" onClick={() => chooseCity(c.id)}>
              {c.name}
            </button>)}
        </div>

        <div className="nm-day-head">
          <span className="nm-day-place">
            {shown.name}, {shown.country}
          </span>
          <span className="nm-day-n">{shown.days}</span>
        </div>
        <ol className="nm-stops">
          {shown.stops.map((s, i) => {
          const on = !!city && i === beat;
          const past = !!city && beat >= 0 && i < beat;
          return <li key={s.name}>
                <button className={`nm-row${on ? ' is-on' : ''}${past ? ' is-past' : ''}`} aria-current={on ? 'step' : undefined} onClick={() => {
              if (!city) {
                setCityId(shown.id);
                overview(shown, 0);
              }
              setPlaying(false);
              setBeat(i);
            }}>
                  <span className="nm-row-time">{s.time}</span>
                  <span className="nm-row-text">
                    <span className="nm-row-name">{s.name}</span>
                    <span className="nm-row-note">{s.note}</span>
                  </span>
                  <span className="nm-row-mark" aria-hidden="true" />
                </button>
              </li>;
        })}
        </ol>

        <div className="nm-transport">
          <button className="nm-icon-btn" onClick={() => step(-1)} disabled={!city || beat <= 0} aria-label="Previous stop">
            ‹
          </button>
          <button className="nm-play" onClick={play} aria-pressed={playing}>
            <span>{playing ? 'Pause' : beat >= 0 ? 'Resume' : 'Play the day'}</span>
            <span aria-hidden="true">{playing ? '❚❚' : '▸'}</span>
          </button>
          <button className="nm-icon-btn" onClick={() => step(1)} disabled={!city || beat >= shown.stops.length - 1} aria-label="Next stop">
            ›
          </button>
          <span className="nm-progress" aria-live="polite">
            {city && beat >= 0 ? `Stop ${beat + 1} of ${city.stops.length}` : city ? 'Overview' : 'Whole world'}
          </span>
        </div>
      </div>

      <dl className="nm-stats">
        <div>
          <dt>Forecast horizon</dt>
          <dd>16 days</dd>
        </div>
        <div>
          <dt>Blue hour window</dt>
          <dd>20 min</dd>
        </div>
        <div>
          <dt>Ways to travel</dt>
          <dd>3 tiers</dd>
        </div>
      </dl>
    </section>;
}