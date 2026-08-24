# AGENTS.md — Code Navigation Guide for DoggoNogo

> Companion to `README.md`. The README explains the **science** (what the tasks measure and why);
> this file explains the **code** (how it's wired, where things live, and the gotchas) so an AI
> agent can act quickly and safely.

## What this project is

A dependency-free, build-step-free HTML5 `<canvas>` game implementing two gamified
neuropsychological tasks (Level 1 = Simple RT, Level 2 = Simon task). It runs either standalone
or embedded inside a jsPsych experiment. Everything is plain ES5/ES6 attached to `window` — there
is **no bundler, no npm, no transpile step**. Open the HTML file in a browser to run it.

## Entry points

| Entry | File | Notes |
|---|---|---|
| Standalone | `game/index.html` | Sizes the canvas, preloads levels, runs L1 → L2 via inline script. |
| jsPsych embed | `example_jspsych.html` | Minimal example using the `DoggoNogo` integration object. |
| jsPsych API | `game/jspsych.js` | `DoggoNogo.level1(opts)` / `DoggoNogo.level2(opts)` build jsPsych trials. |

## File map & responsibilities

| File | Global it defines | Responsibility |
|---|---|---|
| `game/engine.js` | `DoggoNogoEngine` | Orchestrator: asset preload, cover screen, intro, instruction screen, `requestAnimationFrame` loop, marker (photodiode) flash, end-of-level score screen. |
| `game/game.js` | `DoggoNogoUI`, `DoggoNogoCore`, `DoggoNogoTrialTypes` | Shared UI (score screen, loading, `zScoreToQuantile`) + shared mechanics in `DoggoNogoCore` (progress bar, particles, feedback bubbles, tinted sprites, median, timers, `computeIES`). |
| `game/core.js` | `DoggoNogoBaseLevel` | Shared **level** logic (player physics, render scaffolding, phase progression, scoring helpers, input plumbing). Concrete levels set it as their prototype. |
| `game/intro.js` | `IntroRunner`, `DoggoNogoIntroAssets` | Generic step-sequenced cutscene player (`fill`/`text`/`image`/`sound`/`wait`). |
| `game/levels/level1.js` | `level1` | Simple RT task. Inherits `DoggoNogoBaseLevel`; defines only level-1 specifics. |
| `game/levels/level2.js` | `level2` | Simon task. Inherits `DoggoNogoBaseLevel`; defines only level-2 specifics. |
| `game/levels/intro.js` | `level1IntroSequence` (+ L2) | Cutscene step definitions consumed by `IntroRunner`. |
| `game/jspsych.js` | `DoggoNogo`, `DoggoNogoAssets` | jsPsych integration + the asset manifest used for preloading. |

## The level interface (contract)

A concrete level is a plain object with three data sections — `params` (static config), `assets`
(preloaded `Image`/`Audio`), `state` (mutable runtime data) — that sets `DoggoNogoBaseLevel` as its
prototype: `Object.setPrototypeOf(levelX, DoggoNogoBaseLevel)`. The base supplies all shared
mechanics; a level overrides only what differs. The engine drives this uniform interface:

```
load(canvas, { assetBasePath })   -> Promise   // set asset .src, resolve when loaded
showInstructionScreen(canvas)                   // draw instructions
start(canvas, endGameCallback, opts)            // reset state, attach input, begin first trial
update()                                        // per-frame physics/timers (base; calls updateStimulusMotion hook)
draw()                                          // per-frame rendering (base; calls drawStimulus/drawPlayer/... )
handleResize()                                  // recompute sprite sizes/positions (base)
getPhaseTargets() -> [n,n,n]                     // used by the shared progress bar
startKeys -> string[]                            // keys that start the level (engine.waitForStart)
isResponseKey(key) -> bool                       // which keys count as responses (base, from startKeys)
```

### Adding a new level (e.g. Stop-signal / Go-NoGo / Stroop)

1. Create `game/levels/levelN.js` with `params`/`assets`/`state` and only the level-specific
   overrides (`load`, `showInstructionScreen`, `start`, `startNewTrial`, `finishTrial`,
   `handleKeyDown`, `drawStimulus`, plus `startKeys`).
2. End the file with `Object.setPrototypeOf(levelN, DoggoNogoBaseLevel)`.
3. Add its `<script>` tag after `core.js` in `game/index.html` and `example_jspsych.html`.
4. Override `computePhaseTarget`/`getPhaseTargets`/`ensurePhaseTarget` if it needs a custom phase
   strategy (Level 1 = adaptive, Level 2 = fixed); otherwise reuse one of those patterns.

Useful base override hooks: `updateStimulusMotion()`, `getBreakOverlayLines()`,
`getStimulusAspectImage()`, `endOverlayTitle`, plus standardized flash fields
`state.flashUntil` / `params.flashDuration` / `params.flashTintColor`.

## Control flow (one run)

```
index.html / jspsych.js
  └─ DoggoNogoEngine.run(canvas, level, options)
       ├─ DoggoNogoCore.preloadAll()        (one-time, global manifest)
       ├─ level.load()                       (level-specific assets)
       ├─ background-preload other levels    (so transitions are instant)
       ├─ showCoverScreen()                  (SPACE to start; first user gesture for audio)
       ├─ IntroRunner.run()                  (optional cutscene)
       ├─ level.showInstructionScreen()
       ├─ waitForStart()                     (level-specific start key)
       ├─ level.start(canvas, endCallback)
       └─ loop(): level.update(); level.draw(); drawMarkerIndicator(); rAF
            └─ on finish: compute IES → quantile → DoggoNogoUI.showScoreScreen → onFinish(state)
```

## Conventions

- **Globals, not modules.** Everything attaches to `window` via the IIFE pattern
  `;(function (global) { ... })(typeof window !== "undefined" ? window : globalThis)`. Load order in
  the HTML matters: `game.js` → `core.js` → `engine.js` → `intro.js` → levels.
- **Shared level logic lives in `core.js` (`DoggoNogoBaseLevel`)**; shared non-level helpers live in
  `game.js` (`DoggoNogoCore`). When fixing a mechanic, decide which of the two it belongs in, and
  remember both levels inherit the base.
- **Module-level singletons** are namespaced under `window.__DoggoNogo` (`globalPreloaded`,
  `otherLevelsPreloaded`, `phaseCompleteAudio`).
- **Reference resolution** uses `1792×1024` as the design canvas; fonts/positions scale from it.
- **Time** comes from `level.now()` which prefers `jsPsych.getTotalTime()`, falling back to
  `performance.now()` then `Date.now()`. Use it, not `Date.now()` directly, for RT consistency.
- **Asset base path** is configurable (`assetBasePath`) so the game can be served from any directory;
  always build asset URLs as `base + relativePath`.
- **Data logging**: each keypress appends a record to `level.state.data` (also exposed as
  `window.level1Data`). Field names are PascalCase (`RT`, `TrialType`, `Error`, `Points`, `Score`,
  `Phase`, `Threshold`, ...). Keep new fields consistent.

## Gotchas / sharp edges

- Audio cannot play before a user gesture; the cover screen exists partly to satisfy this. Don't
  move audio playback before `showCoverScreen()`/`waitForStart()`.
- `state` objects are per-level (own properties); only **methods** are shared via the prototype.
  Never put mutable state on `DoggoNogoBaseLevel`.
- Levels override `computePhaseTarget`/`getPhaseTargets`/`ensurePhaseTarget`; the base has no default
  phase strategy, so a new level must provide one.
- Top-level `const level1`/`level2` are global lexical bindings (accessible across scripts) but are
  **not** `window` properties; `level2.js` additionally sets `window.level2` for the engine.

## How to run / test

No build. To run locally, serve the repo over HTTP (needed for audio/asset loading), e.g.:

```powershell
# from the repo root
python -m http.server 8000
# then open http://localhost:8000/game/index.html
```

There is no automated test suite; verification is manual (play through both levels, check
`window.level1Data` / `window.level2Data` in the console for the data log).


