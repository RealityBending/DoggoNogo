# AGENTS.md — Code Navigation Guide for DoggoNogo

> Companion to `README.md`. The README explains the **science** (what the tasks measure and why);
> this file explains the **code** (how it's wired, where things live, and the gotchas) so an AI
> agent can act quickly and safely.

## What this project is

A dependency-free, build-step-free HTML5 `<canvas>` game implementing two gamified
neuropsychological tasks (Level 1 = Simple RT, Level 2 = Simon task). It runs either standalone
or embedded inside a jsPsych experiment. Everything is native ES modules — there is **no bundler,
no npm, no transpile step**. Serve the repo over HTTP and open the entry point in a browser.

## Entry points

| Entry | File | Notes |
|---|---|---|
| Standalone | `game/index.html` | Sizes the canvas and runs the `LEVELS` chain (L1 → L2 → L3) from an inline `<script type="module">`. |
| jsPsych embed | `example_jspsych.html` | Minimal example using the `DoggoNogo` integration object. |
| jsPsych API | `game/jspsych.js` | `DoggoNogo.level1(opts)` / `DoggoNogo.level2(opts)` build jsPsych trials; both need the instance from `initJsPsych()` passed as `opts.jsPsych`. |

## File map & responsibilities

| File | Exports | Responsibility |
|---|---|---|
| `game/engine.js` | `DoggoNogoEngine` | Orchestrator: asset preload, cover screen, intro, instruction screen, `requestAnimationFrame` loop, marker (photodiode) flash, end-of-level score screen. |
| `game/assets.js` | `DoggoNogoAssets` | Asset manifest consumed by `DoggoNogoCore.preloadAll`. |
| `game/game.js` | `DoggoNogoUI`, `DoggoNogoCore`, `DoggoNogoTrialTypes` | Shared UI (score screen, loading, `zScoreToQuantile`) + shared mechanics in `DoggoNogoCore` (progress bar, particles, feedback bubbles, tinted sprites, median, timers, `computeIES`). |
| `game/core.js` | `DoggoNogoBaseLevel` | Shared **level** logic (player physics, render scaffolding, phase progression, scoring helpers, input plumbing). Concrete levels set it as their prototype. |
| `game/intro.js` | `IntroRunner`, `DoggoNogoIntroAssets` | Generic step-sequenced cutscene player (`fill`/`text`/`image`/`sound`/`wait`). |
| `game/levels/level1.js` | `level1` | Simple RT task. Inherits `DoggoNogoBaseLevel`; defines only level-1 specifics. |
| `game/levels/level2.js` | `level2` | Simon task. Inherits `DoggoNogoBaseLevel`; defines only level-2 specifics. |
| `game/levels/level3.js` | `level3` | Barebones two-choice RT placeholder (grey background, bone left/right). Borrows Level 1 assets; standalone-only for now (no jsPsych wrapper). |
| `game/levels/intro.js` | `level1IntroSequence`, `level2IntroSequence` | Cutscene step definitions consumed by `IntroRunner`. |
| `game/jspsych.js` | `DoggoNogo` | jsPsych integration: builds the call-function trials that run a level. |

## The level interface (contract)

A concrete level is a plain object with three data sections — `params` (static config), `assets`
(preloaded `Image`/`Audio`), `state` (mutable runtime data) — that sets `DoggoNogoBaseLevel` as its
prototype: `Object.setPrototypeOf(levelX, DoggoNogoBaseLevel)`. The base supplies all shared
mechanics; a level overrides only what differs. The engine drives this uniform interface:

```
load(canvas, { assetBasePath })   -> Promise   // set asset .src, resolve when loaded
showInstructionScreen(canvas)                   // draw instructions
getInitialState() -> object                     // fresh mutable state (called on every start)
start(canvas, endGameCallback, opts)            // beginLevel() + level-specific setup, first trial
update(frameTimestamp)                          // per-frame schedule/physics (base; rAF timestamp)
placeStimulus()                                 // position/choose the stimulus for the next trial
onResponseTimeout()                             // response window closed with no response
draw()                                          // per-frame rendering (base; calls drawStimulus/drawPlayer/... )
handleResize()                                  // recompute sprite sizes/positions (base)
getPhaseTargets() -> [n,n,n]                     // used by the shared progress bar
startKeys -> string[]                            // keys that start the level (engine.waitForStart)
isResponseKey(key) -> bool                       // which keys count as responses (base, from startKeys)
```

### Adding a new level (e.g. Stop-signal / Go-NoGo / Stroop)

1. Create `game/levels/levelN.js` with `params`/`assets`/`getInitialState()` and only the
   level-specific overrides (`load`, `showInstructionScreen`, `start`, `startNewTrial`,
   `finishTrial`, `handleKeyDown`, `drawStimulus`, plus `startKeys`). Import what it needs from
   `../core.js` / `../game.js` / `../engine.js`, and `export` the level object.
2. End the file with `Object.setPrototypeOf(levelN, DoggoNogoBaseLevel)` followed by
   `levelN.state = levelN.getInitialState()`.
3. Import it where it should run and register it: add an entry to the `LEVELS` array in
   `game/index.html` (which chains the levels and preloads the remaining ones), and/or add a
   wrapper in `game/jspsych.js`.
4. Define `computePhaseTarget(i)` — the base's `getPhaseTargets`/`ensurePhaseTarget` build on it
   (Level 1 = adaptive, Level 2 = fixed). Only override those two for a genuinely different strategy.

Useful base override hooks: `updateStimulusMotion()`, `getBreakOverlayLines()`,
`getStimulusAspectImage()`, `endOverlayTitle`, plus standardized flash fields
`state.flashUntil` / `params.flashDuration` / `params.flashTintColor`. The phase break itself is
data-driven: `params.breakSparkles` (particle config + `count`), `params.breakEffectsDelay`,
`params.breakTextDelay`, `assets.soundEvolve`, and `assets.imgPlayer{1,2,3}` (swapped by phase).

## Control flow (one run)

```
index.html / jspsych.js
  └─ DoggoNogoEngine.run(canvas, level, options)
       ├─ DoggoNogoCore.preloadAll()        (one-time, global manifest; drives the loading bar)
       ├─ level.load()                       (level-specific assets; reports progress)
       ├─ background-preload otherLevels     (so transitions are instant; reports progress)
       ├─ showCoverScreen()                  (SPACE to start; first user gesture for audio)
       ├─ IntroRunner.run()                  (optional cutscene)
       ├─ level.showInstructionScreen()
       ├─ waitForStart()                     (level-specific start key)
       ├─ level.start(canvas, endCallback)
       └─ loop(): level.update(); level.draw(); drawMarkerIndicator(); rAF
            └─ on finish: compute IES → quantile → DoggoNogoUI.showScoreScreen → onFinish(state)
```

## Conventions

- **Native ES modules.** Every file declares its dependencies with `import` and its API with
  `export`, so the module graph fixes load order and the HTML entry points import only what they
  run. Dependency direction is `assets.js` → `game.js` → `core.js`/`intro.js` → `engine.js` →
  levels → `jspsych.js`; keep it acyclic (the engine takes levels as data via `otherLevels`, it
  never imports them).
- **Shared level logic lives in `core.js` (`DoggoNogoBaseLevel`)**; shared non-level helpers live in
  `game.js` (`DoggoNogoCore`). When fixing a mechanic, decide which of the two it belongs in, and
  remember both levels inherit the base.
- **One-time flags** (`globalPreloaded` / `otherLevelsPreloaded` in `engine.js`,
  `phaseCompleteAudio` in `game.js`) are plain module-scoped variables.
- **Reference resolution** uses `1792×1024` as the design canvas; fonts/positions scale from it.
- **Time** comes from `level.now()`, which uses the host jsPsych clock when the engine was given a
  `jsPsych` instance and otherwise falls back to `performance.now()` then `Date.now()`. Use it, not
  `Date.now()` directly, for RT consistency.
- **Trial timing is frame-driven, never `setTimeout`.** `startNewTrial()` records when the next
  stimulus is due; `updateTrialSchedule()` reveals it on the first frame at or after that deadline,
  then stamps `state.startTime` with the *following* frame's timestamp — the frame that actually
  puts it on screen. RT is `eventTime(e) - startTime`, both on the same clock. Per-frame animation
  should read `state.frameTime`, not `now()`.
- **Clocks.** requestAnimationFrame timestamps and `event.timeStamp` are on the performance clock;
  `now()` may be the jsPsych clock. `state.clockOffset` (set once per run in `beginLevel()`)
  converts between them — apply it to any raw timestamp before comparing it with level time.
- **Asset base path** is configurable (`assetBasePath`) so the game can be served from any directory;
  always build asset URLs as `base + relativePath`.
- **Asset failures are graded**: wait on assets with `DoggoNogoCore.loadAssets()` /
  `whenAssetReady()`, which hold until an image is decoded and audio is buffered to
  `canplaythrough`, retry once on a load error (the browser aborts media fetches on its own), then
  resolve audio anyway (the game runs without the cue) while rejecting images (a broken sprite
  throws on `drawImage` and poisons sizing). Never make a sound the reason a session cannot start,
  and never assume an asset is ready without going through these helpers.
- **Data logging**: each keypress appends a record to `level.state.data` (also exposed as
  `window.level1Data`). Field names are PascalCase (`RT`, `TrialType`, `Error`, `Points`, `Score`,
  `Phase`, `Threshold`, `ISI`, ...). Keep new fields consistent. `ISI` is the *realized* interval
  from scheduling to onset, so onset jitter can be checked offline.

## Gotchas / sharp edges

- **Serve over HTTP; never open `index.html` as a file.** On `file://` the browser refuses every
  media element ("MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check") while images load
  normally, so the game runs, looks right, and is completely silent -- which reads as an audio bug.
  `DoggoNogoCore` detects the scheme and says so once in the console.
- Audio cannot play before a user gesture, and a browser refuses by **rejecting the promise
  `play()` returns** -- a `try`/`catch` around the call never sees it, so the sound just goes
  missing. Every cue except the music is fired from inside `handleKeyDown`, which is a gesture
  context and therefore always allowed. The background music is not: it starts at the instruction
  screen, in a promise continuation. Route it through `DoggoNogoCore.startBackgroundMusic()` (and
  `stopBackgroundMusic()`), which catches the rejection and re-arms playback for the next real
  gesture; never call `soundBackground.play()` directly.
- Browsers pause requestAnimationFrame in hidden tabs, so a backgrounded game stops advancing
  instead of running trials the participant cannot see. That is deliberate — don't "fix" it by
  putting trial timing back on timers.
- `state` objects are per-level (own properties); only **methods** are shared via the prototype.
  Never put mutable state on `DoggoNogoBaseLevel`.
- `beginLevel()` replaces `state` wholesale, so anything that must survive a run belongs on the
  level object (`assets`, `params`), not in `state` — and anything holding the old `state` (a
  pending timer, a closure) has to be cleaned up before the swap.
- The base has no default phase strategy: every level must define `computePhaseTarget(i)`. Phase
  targets are cached (`state.phaseTargetsCache`) because the progress bar reads them every frame —
  write them through `setPhaseTarget`/`setPhaseTargets`, never straight into `phaseRequiredScores`.
- Level objects are module exports, not globals; the only deliberate globals are the debug data
  logs (`window.level1Data` / `window.level2Data`).
- Embedded in jsPsych, the instance is passed in explicitly (`DoggoNogo.level1({ jsPsych })` →
  engine → `level.jsPsych`). Don't reach for a global `jsPsych`: under jsPsych 8 that name resolves
  to a deprecation shim rather than the instance.

## How to run / test

No build. To run locally, serve the repo over HTTP (required for ES modules and asset loading), e.g.:

```powershell
# from the repo root
python -m http.server 8000
# then open http://localhost:8000/game/index.html
```

To work on a later level without playing through the earlier ones, append `?level=N` to that URL
(`?level=3` starts at Level 3, cover screen included). `START_LEVEL` in `game/index.html` is the
same switch without the query string; opening the page with no `level` param applies it and writes
it into the address bar. **`START_LEVEL` is currently 3 while Level 3 is being built — set it back
to 1 before shipping.**

There is no automated test suite; verification is manual (play through the levels, check
`window.level1Data` / `window.level2Data` / `window.level3Data` in the console for the data log).


