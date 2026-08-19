# Testing TripMate on a Mac / iPhone

Why this document exists: nothing on the Windows dev machine can tell you how this app performs
in Safari. Playwright's WebKit build is a port with a software GL path and it does not even have
`OffscreenCanvas`, which Cesium requires. This app's entire cost is GPU — a WebGL globe plus large
`backdrop-filter` panels sampling it — and that is exactly what does not transfer between engine
ports. Safari numbers have to come from Safari.

There are two ways to do this. **Start with Option A**; it needs nothing installed on the Mac.

---

## Option A — serve from Windows, view on the Mac (5 minutes, nothing to install)

Both machines must be on the same Wi-Fi.

**On Windows:**

```bash
npm run build
npx next start -H 0.0.0.0 -p 3100
```

`-H 0.0.0.0` is the part that matters — without it Next binds to localhost only and the Mac
cannot reach it. Windows Firewall will likely prompt on first run: allow it for **Private**
networks. If no prompt appears and the Mac cannot connect, run this once in an **Administrator**
PowerShell:

```powershell
New-NetFirewallRule -DisplayName "TripMate dev 3100" -Direction Inbound -LocalPort 3100 -Protocol TCP -Action Allow -Profile Private
```

**On the Mac**, open Safari to (this machine's current LAN IP — re-check with `ipconfig` if it
has changed):

```
http://192.168.87.226:3100
```

## Option B — run it natively on the Mac

Only needed if you want to develop there. Requires Node 22 (`nvm use`), `npm install`
(rebuilds `better-sqlite3` for macOS), a `.env.local` carrying `NEXT_PUBLIC_CESIUM_ION_TOKEN`,
and note that `tripmate.db` does not travel — the Mac starts with no saved trips, so create one
before testing `/trip/[id]`.

---

## What to run

Open Safari's console: **Settings → Advanced → "Show features for web developers"**, then
**Develop → Show JavaScript Console** (or ⌥⌘C).

### 1. Does it work at all

Load `/`, `/trips`, `/profile`, and a real `/trip/[id]`. For each: does the globe appear, do the
frosted panels look right, and is the console clean? Dragging is only expected to work on `/` —
`/trip/[id]` sets `enableInputs = false` so the camera stays owned by the itinerary. A
`ReferenceError` mentioning `OffscreenCanvas` would mean the Safari version is below 16.4 and
Cesium cannot start — check **Safari → About Safari**.

### 2. Paint cost — scripted, on a production build

**Do not count `requestAnimationFrame`.** It ticks at a full 60/s on a page that paints nothing —
measured on `/`: 601 rAF ticks and **0** actual paints in the same 10 seconds. Counting rAF would
have called that "60fps idle" and been exactly wrong.

The honest signal is WebGL draw calls: a rAF tick during which the draw counter moved is a frame
that really painted. That works against `next start`, where `scripts/frame-probe.js` cannot —
it needs the `__tripmateViewer` handle, which is stripped from production builds.

Enable **Develop → Developer Settings → "Allow JavaScript from Apple Events"** once. Then paste
this in the console, or keep it in a file and inject it (below):

```js
(() => {
  const S = (window.__tm = window.__tm || { draws: 0 });
  if (!S.patched) {
    for (const P of [WebGLRenderingContext, WebGL2RenderingContext])
      for (const m of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const o = P.prototype[m];
        P.prototype[m] = function (...a) { S.draws++; return o.apply(this, a); };
      }
    S.patched = true;
  }
  const loop = (ms, onTick, onEnd) => {
    S.result = null;
    let ticks = 0, painted = 0, last = S.draws, i = 0;
    const times = [], t0 = performance.now();
    const tick = (now) => {
      ticks++;
      if (S.draws > last) { painted++; times.push(now); last = S.draws; }
      onTick(++i);
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else {
        onEnd();
        const sec = (performance.now() - t0) / 1000;
        const g = times.slice(1).map((x, k) => x - times[k]).sort((a, b) => a - b);
        S.result = { seconds: +sec.toFixed(2), rafTicks: ticks, paintedFrames: painted,
          paintedFps: +(painted / sec).toFixed(1),
          medianGapMs: g.length ? +g[g.length >> 1].toFixed(1) : null,
          worstGapMs: g.length ? +g[g.length - 1].toFixed(1) : null };
      }
    };
    requestAnimationFrame(tick);
    return "started";
  };
  S.measure = (ms) => loop(ms, () => {}, () => {});
  S.drag = (ms) => {
    const c = document.querySelector(".cesium-widget canvas");
    if (!c) return "no globe on this route";
    const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, composed: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
      buttons: t === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
    ev("pointerdown", cx, cy);
    return loop(ms, (i) => ev("pointermove", cx + Math.round(160 * Math.sin(i / 14)),
      cy + Math.round(70 * Math.cos(i / 21))), () => ev("pointerup", cx, cy));
  };
  S.backdrop = (on) => {
    const id = "__tmKill"; let e = document.getElementById(id);
    if (on) { if (e) e.remove(); return "backdrop:on"; }
    e = document.createElement("style"); e.id = id;
    e.textContent = "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";
    document.head.appendChild(e); return "backdrop:off";
  };
  S.env = () => { const c = document.querySelector(".cesium-widget canvas");
    return JSON.stringify({ path: location.pathname, hidden: document.hidden, dpr: devicePixelRatio,
      canvasDevicePx: c ? c.width + "x" + c.height : null, draws: S.draws }); };
  S.get = () => (S.result ? JSON.stringify(S.result) : "");
  return "probe:ready";
})();
```

`__tm.measure(10000)` for idle, `__tm.drag(5000)` for a synthetic rotate-drag, `__tm.get()` to
read the result once it has settled, `__tm.backdrop(false)` to strip every `backdrop-filter` for
an A/B, `__tm.env()` for the canvas size and visibility. Each returns immediately; poll `get()`.

Driving it from the shell (a run is one `sleep` longer than the sample):

```bash
osascript -e 'set js to read POSIX file "/tmp/probe.js"' -e 'tell application "Safari" to do JavaScript js in front document'
osascript -e 'tell application "Safari" to do JavaScript "__tm.measure(10000)" in front document'
sleep 12
osascript -e 'tell application "Safari" to do JavaScript "__tm.get()" in front document'
```

**Three traps that silently void every number:**

- **Safari must be frontmost and unoccluded.** A covered window — even one merely sitting behind
  another Safari window of the same size — reports `document.hidden = true`, and Safari throttles
  rAF to roughly one tick per three seconds. Check `document.hidden` before *and* after every run;
  a run that ends hidden is garbage. This is the single easiest way to record a fake number.
- **Leave the Screenshots and Script instruments off** in Timelines. A 157-second recording with
  them on carried 155,238 `microtask-dispatched` records and reported 4.4fps — that is the
  instrumentation, not the app.
- **A Timelines export cannot answer "Painting or Compositing".** Exported `rendering-frame`
  records hold only `startTime` and `endTime`; the breakdown exists only in the live UI. To get at
  it without the UI, sweep the window size instead — see the fill-rate table below.

### 3. iPhone — scripted, over the cable

A real phone is the only place the mobile GPU and thermal behaviour exist; the Simulator runs on
the Mac's GPU and will happily report numbers that mean nothing. Drive the real device instead of
poking at it by hand:

```bash
brew install ios-webkit-debug-proxy
ios_webkit_debug_proxy -c null:9221,:9222-9322 &
curl -s localhost:9222/json          # inspectable pages on the phone
```

Then talk to it with `iosjs.mjs` below — `node iosjs.mjs file probe.js`, `... eval '__tm.env()'`,
and so on, exactly as on the desktop. No npm deps; Node 22+ has a global `WebSocket`.

**The protocol gotcha that costs an afternoon:** on iOS 12.2+ the top-level domains are not
addressable. `Runtime.evaluate` sent directly comes back `'Runtime' domain was not found`. Every
command must be wrapped in `Target.sendMessageToTarget`, and replies arrive wrapped in
`Target.dispatchMessageFromTarget`. The `targetId` is announced by a `Target.targetCreated` event
on connect and changes on every page load, so read it off the socket rather than caching it:

```js
const command = (wsUrl, method, params) => new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  let outer = 0, targetId = null, sent = false;
  const done = (fn, v) => { ws.close(); fn(v); };
  ws.onerror = (e) => done(reject, new Error(e.message || e));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === "Target.targetCreated" && !sent) {
      targetId = msg.params.targetInfo.targetId;
      sent = true;
      return ws.send(JSON.stringify({ id: ++outer, method: "Target.sendMessageToTarget",
        params: { targetId, message: JSON.stringify({ id: 1, method, params }) } }));
    }
    if (msg.method !== "Target.dispatchMessageFromTarget") return;
    const inner = JSON.parse(msg.params.message);
    if (inner.id !== 1) return;
    inner.error ? done(reject, new Error(JSON.stringify(inner.error))) : done(resolve, inner.result);
  };
});
```

**Four things that block the connection, in the order they bit:**

- **Safari's own Web Inspector must be CLOSED.** One client owns a page; with the inspector
  attached the proxy logs `Taking page … from remote` on a loop and the phone answers nothing at
  all — not an error, silence.
- **The phone must actually be on the Mac's network.** Joining "the wifi" is not enough if it is a
  different SSID or band. Check from the Mac: `ping -c3 192.168.87.255` then `arp -a` — if the
  phone is not in that list it cannot reach the server, whatever the phone's settings screen says.
- **Prefer the `.local` name over the USB link-local IP.** Plugging in an iPhone creates a network
  interface (`en8` here) whose `169.254.x.x` address *renegotiates* — ours moved mid-session and
  killed a URL that had worked minutes earlier. `http://$(scutil --get LocalHostName).local:3100`
  survives that, and works over the cable with no Wi-Fi at all.
- **Keep the phone unlocked with Safari frontmost.** A locked screen suspends rAF, and an idle
  measurement will read a perfect, meaningless zero.

**Drag with a real finger, not synthetic events.** `__tm.drag()` dispatches synthetic
`PointerEvent`s, which bypass the touch pipeline a device test exists to measure. Arm the probe on
a real `touchstart` instead and let the human drag — it also removes any need to synchronise a
stopwatch with a person:

```js
__tm.armed = (ms) => { const c = document.querySelector(".cesium-widget canvas");
  c.addEventListener("touchstart", () => __tm.measure(ms), { once: true }); return "armed"; };
```

Battery temperature, for the thermal run, comes from `idevicediagnostics ioregentry
AppleSmartBattery` (centi-Celsius, so divide by 100). Note the cable keeps the phone *charging*,
which adds heat — a thermal test this way is harsher than pocket use, not gentler.

---

## Baseline — 2026-08-18

Production build, Safari 26.5 / macOS 26.5.1, MacBook Air M4 (`Mac16,12`), 16 GB. Re-run the probe
and compare against these; report the delta, not a fresh essay.

**Idle: zero paints, on both globe routes.** This is the number the render-on-demand work exists
for. Anything above 0 is a regression.

| Route | Sample | rAF ticks | Painted frames |
|---|---|---|---|
| `/` | 10.0s | 601 | **0** |
| `/trip/[id]` | 10.0s | 596 | **0** |

**`backdrop-filter` costs nothing measurable.** Same drag at 2565×1531, panels forced to
`backdrop-filter: none`:

| | Painted fps | Median frame |
|---|---|---|
| Panels on | 36.1 | 26 ms |
| Panels off | 36.6 | 27 ms |

The frosted panels were the thing most expected to diverge on Safari. They don't — so a slow drag
is not the glass, and stripping blur is not the fix.

**Drag is mostly not fill-rate.** Warm, window resized between runs:

| Canvas device px | MP | Painted fps | Median frame |
|---|---|---|---|
| 900×522 | 0.47 | 58.7 | 17 ms |
| 1500×972 | 1.46 | 54.4 | 17 ms |
| 2520×1422 | 3.58 | 44.3 | 21 ms |

fps does scale with pixels, so fill rate is real — but 7.6× fewer pixels bought only ~1.3× faster
frames, and the two smaller sizes sit on the 16.7ms vsync ceiling. A large fixed per-frame cost
survives any canvas shrink: Cesium scene traversal and 3D-tile selection, on the CPU. So
`MAX_RENDER_PIXEL_RATIO` (1.5, in `GlobeBackground.tsx`) buys less than it looks like — order 3ms
a frame at full size. Worth revisiting if crispness matters more than ~5fps.

**Cold 36–37fps vs warm 44–45fps.** The gap is Google 3D tile streaming. Measure warm, or say which
you measured — this is what made the first hand-driven recording look catastrophic.

**Routes.** `/`, `/trips`, `/profile`, `/trip/[id]` all clean: no JS errors, no failed
subresources, globe canvas 1920×1122 on each. The globe is deliberately non-interactive on
`/trip/[id]` (`enableInputs = false` — the camera is driven by the itinerary), so "does it drag"
only applies on `/`.

**Versus Chrome.** All four frosted-panel recipes resolve to identical computed values in both
engines — `blur(12px)`, `blur(20px) saturate(1.8)`, `blur(56px) saturate(1.8)`, matching
backgrounds and borders; only `oklab` float precision differs in serialization. That is a
CSS-level match, not a pixel-level one — a real pixel diff still needs eyes, or Screen Recording
permission for `screencapture`.

## iPhone baseline — 2026-08-18

iPhone 16 Pro (`iPhone17,1`), iOS 26.6, production build over the USB link. Canvas **603×1071**
for a 402×714 viewport: DPR 3 capped to 1.5×, so `resolutionScale` is 0.5 here against the Mac's
0.75. That is 0.65 MP versus the Mac's 3.58 MP, and it is why the phone is *faster* than the
laptop at this.

| Condition | Painted fps | Median | Worst frame |
|---|---|---|---|
| Idle, 10s | **0 painted / 600 rAF** | — | — |
| Drag, tiles cached | **58.5** | 17 ms | 36 ms |
| Drag, new ground | 51 | 17 ms | **311 ms** |
| Drag, after 5 min sustained | 30–47 | 22–33 ms | 92–221 ms |
| Drag, after 2 min rest | **58.2** | 17 ms | 36 ms |

The expectation this document was written with — that a phone would be the harsh case, fill-rate
bound, with `backdrop-filter` the likely culprit — is wrong on every count. Warm, the phone runs
at the refresh rate and beats the MacBook's 44 fps, because the DPR cap leaves it 5.5× fewer
pixels to fill.

**The only real jank is first-visit 3D-tile streaming**, and it is a main-thread block, not GPU
cost: on new ground rAF itself drops to 55.7/s and one frame took 311 ms. Re-drag the same area
and it is 36 ms. Anything spent here should go on keeping tile work off the main thread; there is
nothing left to win in fill rate or glass.

**It throttles, and that is not the app's fault.** Under five minutes of continuous dragging,
battery temperature rose 41.1 → 43.6 °C and the frame rate became unstable from ~90 s, repeatedly
halving to exactly 30 fps (33 ms median). But rAF ticks fall in lockstep — painted ÷ rAF stays
near 1.0 throughout — so the app is painting nearly every frame iOS offers; iOS is simply offering
fewer. Two minutes of rest restored 58.2 fps in full. Measure thermals *after* stating how long
the device has been under load, or the number means nothing.

If something is broken, the console text and the route it happened on is enough to work from.
