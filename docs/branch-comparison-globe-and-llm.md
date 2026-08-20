# Branch comparison — `dev-aryan` (Aryan) vs `feat/ui-optimization` (Zaid)

Written 2026-08-20, comparing `dev-aryan` @ `b727d49` against `origin/feat/ui-optimization`
@ `20eaf20`. Neither branch was modified to produce this; every claim below comes from
reading the two trees and their commit messages.

**Why this document exists.** The two branches solved overlapping problems independently.
`feat/ui-optimization` is 30 commits ahead of `dev-aryan` and 3 behind. A dry-run merge
(`git merge-tree`) conflicts in **15 files**. This records what each side actually did, so
the choice between them is made on evidence rather than on whichever branch merges first.

**Authorship.** All 30 commits on `feat/ui-optimization` are Zaid's
(`DiazSk <zaid07sk@gmail.com>`). All 3 commits on `dev-aryan` are Aryan's
(`i_amaryansingh`) — `f74fe7c`, `322eafe`, `b727d49`. The globe work described under
"Aryan" below is carried inside `f74fe7c`, a commit whose subject is about drag-and-drop.

---

## Part 1 — Map / globe rendering

### Where the two agree

Both diagnosed the same root cause and reached for the same two primary levers:

- `requestRenderMode: true` + `maximumRenderTimeChange: Infinity`, so the scene paints on
  demand rather than on a clock.
- Stop booting Cesium on surfaces that never show it.
- Delete the idle auto-rotation. (Aryan's branch later restored it in a scoped form — see
  below.)

### Where they differ

| Decision | Aryan (`dev-aryan`) | Zaid (`feat/ui-optimization`) |
|---|---|---|
| How the globe is gated | `isGlobeHiddenRoute(pathname)` plus a three-state `GlobeMode` (`off`/`static`/`live`) | `globeVisibility.ts` **deleted**; components declare `globeWanted` through `useGlobeOnScreen` (TripView, HomeView) |
| Viewer lifetime | Destroyed when the mode goes `off` | Built at most once, **never destroyed** — "a swap is unrecoverable" |
| `resolutionScale` cap | 2x (inherited, unmeasured) | **1.5x, measured**: 8.5MP → 4.8MP, 33.7fps → ~60fps |
| `targetFrameRate` | absent | 60 (down from uncapped display refresh) |
| Idle rotation | Deleted, then restored scoped to the landing reveal section via IntersectionObserver, 30fps, reduced-motion aware | Deleted outright as unreachable under the new gating |
| Backdrop for globe-less surfaces | `GlobePoster` — CSS earth limb, or the destination's photo | None; the surface simply has no globe |
| LOD tiers | 4 tiers; a 20km tier added at SSE 10 with `dynamicScreenSpaceError` off | Original 3 tiers, unchanged |
| Tile refinement under `requestRenderMode` | `tilesLoaded` keep-alive on `postRender`; `foveatedTimeDelay = 0` | No `tilesLoaded`, no `tileLoad` hook, no foveated handling |
| Hover behaviour | Hover peek: relative 2x zoom toward the hovered stop, 300ms dwell, restores on leave | none |

### Evidence quality

This is the asymmetry that matters, and it does not favour `dev-aryan`.

Zaid's branch carries measurements taken on production builds: `/profile` paying 5410ms of
long tasks across 32 tasks (~90% of the main thread) with a 2287KB Cesium chunk, 33
`/cesium/` asset requests, 1100KB of Google tiles and a live WebGL2 context; `/trips`
5457ms; steady state settling to 750ms/8s. It also ships a pixel-diff probe, an iPhone
measurement script, a pinned browserslist, and a per-frame `tileLoad` counter. The Aryan-side
globe work was built without the ability to measure GPU or frame cost at all, and says so.

**One finding on Zaid's branch has no counterpart on Aryan's, and reframes the problem:**
every glass panel in this app is a `backdrop-filter` sibling sitting directly over the
canvas, so a canvas that repaints every frame forces each panel to re-sample and re-blur its
backdrop every frame too. That coupling is what turned "the globe is heavy" into "the whole
UI is stuck" — and it means `requestRenderMode` and the `resolutionScale` cap each pay off
twice, on the globe and on the glass. The Aryan-side work optimised the globe without ever
identifying why it cost more than the globe.

### The three architectural incompatibilities

These are why the 15-file conflict is not hunk-by-hunk work — resolving the text means
choosing an architecture:

1. **Gating.** Zaid's argument defeats the pathname approach directly: a pathname cannot
   express the predicate, because `/trip/<unknown-id>` renders `not-found.tsx` — a glass card
   that wants no globe — on a path indistinguishable from a real trip's, and `/` serves
   landing, plan and result from local state. `isGlobeHiddenRoute` has no answer to that.
2. **Destruction.** Aryan's `off` state destroys the viewer to return GPU memory; Zaid's
   never does, on the grounds that a swap is unrecoverable.
3. **Rotation.** Aryan's branch has a scoped drift; Zaid's has none, having removed the
   architecture that made one reachable.

### What only Aryan's side has

- The **hover peek** (a feature request, not an optimisation) — entirely additive, no
  counterpart to conflict with.
- **Tile-refinement fixes** for a real reported symptom: a stop flown to stayed coarse
  because refinement is a multi-frame conversation that stalls when the camera stops. Zaid's
  branch has `requestRenderMode` with no `tilesLoaded` keep-alive and no foveated handling,
  so **it is likely to carry that bug** — his commits assert that Cesium re-renders itself on
  tile loads, which is the opposite conclusion. **This is the one open question in this
  document and it can only be settled by measurement**, which is a rig only Zaid's branch has.

---

## Part 2 — LLM / itinerary generation

Both branches also changed the prompt surface, so the collision is not confined to the map.

### Aryan — `322eafe`, "Close the itinerary-quality gaps the rubric audit found"

An audit of 29 quality criteria against what generated plans actually do (recorded in
[`itinerary-quality.md`](./itinerary-quality.md)): 3 handled, 15 partial, 11 missing. 1,393
insertions across 26 files. Two findings drove it — the skill on disk was not the skill that
produced any sample in `llm_traces`, and coverage was strongest exactly where a real fetch
exists. Concretely: the "about N stops per day" target was counting meals toward N and saying
nothing about the day's span (measured: Sonnet 5 returning 9:00/11:00/1:00PM days while fully
compliant), fixed in both `travelerProfilePrompt.ts` and skill §9; `dietary` was collected and
then silently dropped by the staged pipeline; `logistics` fed skill §4e, which had no input at
all; accessibility is now asked rather than inferred from energy.

### Zaid — `20eaf20`, "Ask who is going and when the trip actually starts"

Four gaps in the plan form: the trip's length was computed but never rendered, nothing asked
how the traveller arrived or left (so a 20:15 arrival still got a full first day), "who's
going" had three answers that fitted neither five friends nor a work offsite, and "family with
kids" carried no ages. Writes skill **§4c-bis**, which `git log -S"4c-bis"` shows had never
existed despite `usableSlot()` and `TRANSFER_BUFFER_MIN = 90` scoring models against it all
along. Also `e4ca848`, which moves `/`, `/trips`, `/profile` and `/trip/[id]` to reading their
data in a server component instead of a client fetch on mount.

### The collision worth knowing about

**Both branches independently fixed the same latent `BenchLogistics` / `UserAnswers` type
error**, in different ways. Aryan's closed it "by adopting its names" in `userAnswers.ts`;
Zaid's moved the shape into `types.ts` (gaining the arrival/departure *points* the bench
version lacked) and had the bench re-export it. Both also edited
`.claude/skills/itinerary-planner/SKILL.md` — Aryan §9, Zaid §4c-bis — which is why that file
is among the 15 conflicts. The two edits are to different sections and are compatible in
substance; only the text collides.

---

## Merge cost, and the recommended path

A straight merge conflicts in 15 files, including every globe file and the skill. Because the
disagreements are architectural rather than textual, resolving them hunk-by-hunk would mean
picking an architecture while editing merge markers — the worst place to make that decision.

**Recommended:** take `feat/ui-optimization` as the base for the globe and rendering work,
since it is the measured implementation and it found the `backdrop-filter` coupling. Then
re-apply on top of it only what is genuinely additive and absent there:

1. The **hover peek** — new feature, no overlap.
2. The **tile-refinement fixes** (`tilesLoaded` keep-alive, `foveatedTimeDelay = 0`, the 20km
   LOD tier), *conditional on the blurry-arrival symptom reproducing on that branch*. Check
   first; do not port on faith.
3. The **scoped rotation**, only if the landing story still wants it under Zaid's gating.

On the LLM side the two are largely complementary — an audit-driven prompt correction and a
form/skill extension — so those merge on their own terms once the `BenchLogistics` shape is
reconciled to one definition (Zaid's is the superset: it carries arrival/departure points).

This turns a 15-file architectural conflict into two or three small, independently reviewable
patches.
