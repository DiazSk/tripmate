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

Load `/`, `/trips`, `/profile`, and a real `/trip/[id]`. For each: does the globe appear, does it
drag, do the frosted panels look right, and is the console clean? A `ReferenceError` mentioning
`OffscreenCanvas` would mean the Safari version is below 16.4 and Cesium cannot start — check
**Safari → About Safari**.

### 2. Idle frame cost — the headline number

This is the one that proves the render-on-demand work. Paste into the console, then **do not
touch the page or move the mouse** for ~10 seconds:

```js
(() => {
  const v = document.querySelector(".cesium-widget canvas");
  if (!v) return console.warn("no globe on this route");
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
    else console.log(`rAF ticks in 1s: ${n} (this is NOT paints — see step 3)`); };
  console.log("settling 8s, hands off…");
  setTimeout(() => requestAnimationFrame(tick), 8000);
})();
```

For real painted frames rather than rAF ticks, use the dev build (`npm run dev`), where the
`__tripmateViewer` handle exists, and run `scripts/frame-probe.js`. In a production build that
handle is deliberately stripped, so the honest idle measurement in production is Safari's own
**Develop → Show Web Inspector → Timelines → Rendering Frames**: record 10 seconds untouched.
Expected: essentially no frames. Before this work it was pinned at the display refresh rate.

### 3. Interaction cost — where Safari differs most

In **Timelines**, hit record, then drag the globe steadily for ~5 seconds and stop.

Read off: the average frame rate while dragging, and whether "Painting" or "Compositing"
dominates. On Windows/Chromium this was fill-rate bound at 33.7fps before `resolutionScale` was
capped to 1.5×. Safari's `backdrop-filter` implementation differs enough that this number is
genuinely unknown — it is the main thing worth learning.

### 4. iPhone

Same URL over Wi-Fi. To see its console: connect by cable, enable **Settings → Safari →
Advanced → Web Inspector** on the phone, then on the Mac **Develop → [your iPhone] → the page**.
This is the harshest case — mobile GPU, a full-bleed panel on small screens, and a device that
throttles when warm.

---

## What to send back

Short is fine. These five lines are the whole point:

1. Safari version (**About Safari**) and Mac model / chip.
2. Does the globe render and drag on every route — and is the console clean?
3. Idle: frames recorded in 10 seconds of not touching it.
4. Dragging: average fps, and whether Painting or Compositing dominates.
5. Anything that looks visually wrong versus Chrome — especially the frosted panels, which is
   where Safari most plausibly diverges.

If something is broken, the console text and the route it happened on is enough to work from.
