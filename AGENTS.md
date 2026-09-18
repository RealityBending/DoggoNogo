# AGENTS.md — Code Navigation Guide for DoggoNogo

> Companion to `README.md`. The README explains the **science** (what the tasks measure and why);
> this file explains the **code** (how it's wired, where things live, and the gotchas) so an AI
> agent can act quickly and safely.

## What this project is

A dependency-free, build-step-free HTML5 `<canvas>` game implementing two gamified
neuropsychological tasks (Level 1 = Simple RT, Level 2 = Simon task). It runs standalone; a jsPsych
embed also exists but is **parked** (see the note under Entry points). Everything is native ES
modules — there is **no bundler, no npm, no transpile step**. Serve the repo over HTTP and open the
entry point in a browser.

## Entry points

| Entry | File | Notes |
|---|---|---|
| Standalone | `game/index.html` | Sizes the canvas and runs the `LEVELS` chain (L1 → L2 → L3 → L4 → L5) from an inline `<script type="module">`. |
| jsPsych embed | `example_jspsych.html` | Minimal example using the `DoggoNogo` integration object. |
| jsPsych API | `game/jspsych.js` | `DoggoNogo.level1(opts)` / `DoggoNogo.level2(opts)` build jsPsych trials; both need the instance from `initJsPsych()` passed as `opts.jsPsych`. |

> **The jsPsych path is a stale, parked project — do not maintain it.** `game/jspsych.js` and
> `example_jspsych.html` were written for Levels 1–2 and have not kept up: Levels 3–5 have no
> wrapper, and nothing is verified through that path. Treat the standalone `game/index.html` as the
> only supported entry point. Concretely: don't add jsPsych wrappers for new levels, don't extend or
> repair the integration as a side errand while changing something else, don't let it constrain a
> change to the standalone game, and don't report it as broken — it is expected to be. Whether it
> gets revived or deleted is an open decision for later, so leave the files in place rather than
> tidying them away. The hooks it needs *are* still live code and stay as they are: `level.jsPsych`,
> the `now()` clock switch and `state.clockOffset` (see Conventions).

## File map & responsibilities

| File | Exports | Responsibility |
|---|---|---|
| `game/engine.js` | `DoggoNogoEngine` | Orchestrator: asset preload, cover screen, cutscene, instruction screen, `requestAnimationFrame` loop, marker (photodiode) flash, end-of-level score screen. |
| `game/assets.js` | `DoggoNogoAssets` | Asset manifest consumed by `DoggoNogoCore.preloadAll`. |
| `game/game.js` | `DoggoNogoUI`, `DoggoNogoCore`, `DoggoNogoTrialTypes` | Shared UI (score screen, loading, `zScoreToQuantile`) + shared mechanics in `DoggoNogoCore` (progress bar, particles, feedback bubbles, tinted sprites, median, timers, `computeIES`). |
| `game/stimuli.js` | `DoggoNogoStimuli` | Task stimuli, traced in code (bone, fishbone) plus the `*Box` helpers that make a stimulus fill its logged box. No level loads a stimulus image. |
| `game/input.js` | `DoggoNogoInput` | Touch adapter: turns a tap into the synthetic `KeyboardEvent` the rest of the game already listens for, so no screen has its own pointer handling. See **Touch / mobile** below. |
| `game/core.js` | `DoggoNogoBaseLevel` | Shared **level** logic (player physics, render scaffolding, phase progression, scoring helpers, input plumbing). Concrete levels set it as their prototype. |
| `game/cutscene.js` | `CutsceneRunner`, `DoggoNogoCutsceneAssets` | Generic step-sequenced cutscene player (`fill`/`text`/`image`/`sound`/`wait`). Each frame is repainted from the persistent layers (fill or background, sprite, narration lines); a `text` step ADDS a line at its `y`, so give successive lines different heights and they stack. A `fill` or a new background clears them. |
| `game/levels/level1.js` | `level1` | Simple RT task. Inherits `DoggoNogoBaseLevel`; defines only level-1 specifics. |
| `game/levels/level2.js` | `level2` | Simon task. Inherits `DoggoNogoBaseLevel`; defines only level-2 specifics. |
| `game/levels/illusion.js` | `DoggoNogoIllusionLevel`, `illusionDefaultParams`, `borrowedLevel1Assets` | Shared logic for the illusion levels (3–5): the 2AFC size-comparison task ported from the Illusion Game, the two signed per-trial parameters (`TaskDifficulty` = objective difference, sign → correct side; `IllusionStrength` = illusion magnitude, sign → congruent −/incongruent +), the 3-phase difficulty/strength ramp, and the shared instruction screen (on the base's animated frame; each level supplies `instructionTitle`, `instructionLines` and a `drawInstructionDemo` laid out at x = 0.3 / 0.7). Sits between `DoggoNogoBaseLevel` and the concrete levels; see its header for the per-level hooks. |
| `game/levels/level3.js` | `level3` | Vertical–horizontal illusion (tilted vs horizontal bone). Inherits `DoggoNogoIllusionLevel`; the only illusion level with art of its own so far — `artFolder: "level3"` (its own evolution sheet) plus `backgrounds` (one scene per phase), both consumed by the shared `load`, and `params.boneOutlines` so a white bone keeps its edge over painted scenery. Standalone-only for now (no jsPsych wrapper). |
| `game/levels/level4.js` | `level4` | Müller-Lyer illusion on **tied sausages** (`DoggoNogoStimuli.drawSausage`): a string knotted around each end, its two loose ends splayed at the illusion angle are the fins. Inherits `DoggoNogoIllusionLevel`; standalone-only for now. The level's text, cutscene and planned art still describe the earlier ribboned-bone stimulus and are marked `TODO (narrative rework)`. |
| `game/levels/level5.js` | `level5` | Ebbinghaus illusion (target discs in rings of context discs; geometry ported from Pyllusion — note its `TaskDifficulty` is an AREA proportion, unlike the length proportions of L3/L4). Plain circles pending assets/narrative. Inherits `DoggoNogoIllusionLevel`; standalone-only for now. |
| `game/levels/cutscenes.js` | `level1Cutscene` … `level5Cutscene` | Cutscene step definitions consumed by `CutsceneRunner`. Levels 4–5 are tentative: minimal text with `[ ART: ... ]` text steps standing in for artwork to be made (Level 3's two panels are made and wired in). |
| `game/jspsych.js` | `DoggoNogo` | jsPsych integration: builds the call-function trials that run a level. **Parked/stale** — see the note under Entry points. |

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
getStimulusAspectImage() -> {naturalWidth, naturalHeight}  // stimulus box aspect ratio
```

Only the *ratio* of `getStimulusAspectImage()` is read. Every level draws its stimulus procedurally
and returns its declared proportions as a plain object; the base's sprite fallback exists for a level
that blits one, but a sprite's box is its bounding box including transparent padding, so
`params.stimulusHeight` would then size the padding rather than the stimulus.

### Adding a new level (e.g. Stop-signal / Go-NoGo / Stroop)

1. Create `game/levels/levelN.js` with `params`/`assets`/`getInitialState()` and only the
   level-specific overrides (`load`, `showInstructionScreen`, `start`, `startNewTrial`,
   `finishTrial`, `handleKeyDown`, `drawStimulus`, plus `startKeys`). Import what it needs from
   `../core.js` / `../game.js` / `../engine.js`, and `export` the level object.
2. End the file with `Object.setPrototypeOf(levelN, DoggoNogoBaseLevel)` followed by
   `levelN.state = levelN.getInitialState()`.
3. Import it where it should run and register it: add an entry to the `LEVELS` array in
   `game/index.html` (which chains the levels and preloads the remaining ones). That is the whole
   registration — no jsPsych wrapper, that path is parked (see the note under Entry points).
4. Define `computePhaseTarget(i)` — the base's `getPhaseTargets`/`ensurePhaseTarget` build on it
   (Level 1 = adaptive, Level 2 = fixed). Only override those two for a genuinely different strategy.
5. Draw the stimulus, don't blit it: add its shape to `game/stimuli.js`, override
   `getStimulusAspectImage()` with its aspect ratio, and derive the draw geometry from the current
   box height on every frame so a resize and the catch animation both stay proportional. The
   rationale (extent, contrast, redundant cues) is in that file's header.

### UI / visual layer

All "juice" (screens, overlays, HUD) shares one visual language defined in `game/game.js`:
`DoggoNogoUI.theme` (colors/fonts) and `DoggoNogoUI.fx` (canvas helpers: `drawPanel`,
`drawKeycap`, `drawPromptRow`, `drawGlowText`, `drawVignette`, easing, `pulse01`). Instruction
screens are **animated**: a level's `showInstructionScreen(canvas)` calls
`this.runInstructionScreen(canvas, config)` (base, `core.js`), which runs a private rAF loop
drawing `drawInstructionFrame` (badge pill, title, instruction panel, per-level
`config.drawVisual`, pulsing prompt). `beginLevel()` cancels that loop via
`cancelInstructionScreen()` — any new screen animated outside the game loop must likewise be
cancelled before gameplay draws. The progress bar smooths its fill via `state._barDisplayScore`
and the score delta animates from `state.scoreTextShownAt` — both visual-only; scoring is
untouched. The end-of-level `DoggoNogoUI.showScoreScreen` loops indefinitely (confetti/pulse)
until `cancelScoreScreen()`. Title-style text goes through a sprite cache in `game.js`
(`getTextSprite`): glow text is rasterized once per (text, size, style) and blitted per frame —
animate its size with `opts.scale`, never by varying `px` per frame (that defeats the cache and
re-shapes the font every frame, which is what made the phase banner stutter). It also bakes the
optional arcade extras (`outline`/`outlineWidth`, `hardShadow`/`hardShadowDx`/`hardShadowDy`)
into the sprite, and `fx.measureGlowText` reports a string's drawn width so a lockup can be
fitted to the canvas rather than sized by guesswork — the retro faces and their system
fallbacks have very different metrics.

The title screen (`engine.showCoverScreen`) is drawn entirely in code over `assets/cover.webp`:
there is no title image. The DOGGO/NOGO wordmark, its subtitle, the rule and the light sweep all
live in that one function, laid out from measured text so they stay in the open sky between the
two characters at any canvas size. The artwork is generated without lettering (see the `cover`
spec in `prompts/make_prompts.py`).

Cutscene input (`cutscene.js`): tapping SPACE (release before ~800 ms) advances one step
(`advanceStep`: bumps `stepSeq` to kill the running step animation; `nextStep()` runs
`_commitCurrent` to lock in a mid-fade image/text — this commit also covers natural advancement,
where the step timer routinely beats the fade's last frame); holding SPACE charges the ghost
"SPACE to skip" button in the bottom letterbox bar and skips the whole cutscene. The engine option `browserFullscreen: true` (set by
`game/index.html`) requests browser fullscreen on the cover screen's SPACE press. The
end-of-level "View data (JSON)" button (`engine._showDataButton`) is **temporary** scaffolding
for auditing the data schema — remove once the schema is settled.

Useful base override hooks: `updateStimulusMotion()`, `getBreakOverlayLines()`,
`getStimulusAspectImage()`, `endOverlayTitle`, plus standardized flash fields
`state.flashUntil` / `params.flashDuration` / `params.flashTintColor`. The phase break itself is
data-driven: `params.breakSparkles` (particle config + `count`), `params.breakEffectsDelay`,
`params.breakTextDelay`, `assets.soundEvolve`, `assets.imgPlayer{1,2,3}` (swapped by phase) and, when a level defines them, `assets.imgBackground{1,2,3}` (Level 3's terrace / kitchen door / kitchen; the swap also updates `DoggoNogoUI.ambient`).

### Touch / mobile

Every screen in the game waits on a `keydown`, and that stayed true: `game/input.js` translates a
tap into a synthetic `KeyboardEvent` dispatched on `document`, so the seven listener sites are
untouched and touch is understood in exactly one place.

- **Declare what a tap means** with `DoggoNogoInput.setMode()` — `{ keys: ["Space"] }` for any
  "carry on" screen, `{ keys: [...startKeys] }` for a level. Two keys split the stage down the
  middle of the canvas: left half → first key, right half → second (so `startKeys` order is
  load-bearing on Levels 2–5). A **function** may be passed instead and is re-read at each tap,
  which is what `attachInput` (core.js) does, because a tap means SPACE during a phase break and
  the response key during a trial.
- `DoggoNogoInput.suspended` swallows taps without disturbing the mode; the host page's rotate
  prompt is its only user.
- **Wording**: `drawKeycap` renames `SPACE`/`▼` to `TAP` on touch and `drawPromptRow` drops a
  leading `{t:"Press"}`, so most prompts need nothing. A row or an instruction line that needs
  more than a renamed cap supplies `touchPromptSegments` / `touchInstructionLines` beside its
  keyboard version. Repeated phrases live in `DoggoNogoUI.words`.
- `?touch=1` / `?touch=0` force the adapter on or off, for looking at either presentation without
  the matching hardware.

### Plain (non-gamified) mode — TEMPORARY, REMOVABLE

`?gamified=0` runs a barebones version of the same five tasks, for a study comparing DoggoNogo
against a standard experimental presentation. It lives entirely in `game/plain/` (`mode.js`,
`levels.js`, `screens.js`, `stimuli.js`) plus three small seams, and is meant to be deleted whole
once the study is done. **Do not let it leak into the game code**: nothing in `game/plain/` is
imported by anything outside it, and nothing outside it names the plain condition except the seams
below.

- A plain level is a **subclass** of the real level: `Object.create(level1)` with presentation
  methods shadowed as own properties (`mode.js`). Every task-logic method therefore resolves
  through the prototype to the game's own and is literally the same function object.
  `assertTaskLogicShared` checks exactly that on load, for a named list of methods and params, and
  logs a `console.error` if a future edit shadows one — a broken comparison is otherwise invisible.
- Sound and artwork are removed by giving the plain level a **nulled `assets` object**, not by
  editing call sites: `safePlay`, `startBackgroundMusic`, `stopBackgroundMusic` and
  `drawImageCover` all already bail on a missing asset. That is what silences the
  `safePlay(soundFast)` calls sitting inside each level's `handleKeyDown`.
- What deliberately keeps running, invisibly, or the conditions stop being matched: the score and
  the phase progression it gates (and so how many trials a level lasts), the adaptive threshold,
  the 200 ms post-response refractory (`exitDuration` — a response window, not an animation), the
  `breakEffectsDelay`/`breakTextDelay` pacing of the rest between phases, and the photodiode marker.
- Stimuli are the abstract counterparts of the game's, drawn from the *same* geometry
  `placeStimulus`/`composeStimulusItems` computed: red segment (L1, L3), red arrow (L2), canonical
  Müller-Lyer (L4), the existing discs restyled (L5). Two params look redundant but are not —
  `boneOutlines` (L1) and `fishOutlines` (L2) are kept in the plain params because the placement
  envelope and the extent correction read their widths; dropping them would change where the
  stimulus lands and how long it is.
- Plain screens repaint every frame like the game's. They must: `sizeCanvas()` resets the canvas
  backing store on every resize, so a once-painted screen is wiped by the fullscreen transition the
  start screen itself triggers.

The three seams, which are the whole removal checklist besides the folder:

| File | Seam |
|---|---|
| `game/index.html` | the `?gamified` block (dynamic `import`, so a normal run never fetches the module) and the `...conditionOptions` spread in `runLevel`. |
| `game/engine.js` | three options — `coverScreen`, `scoreScreen` (+ `dataButton`), `assetManifest` — and `gamified` in the `gameParams` snapshot. The `performance`/`gameParams` block was also moved out of `if (DoggoNogoUI.showScoreScreen)`, which is an improvement worth keeping either way: the summary is data, not display. |
| `AGENTS.md` | this section. |

No level file, `core.js`, `game.js` or `stimuli.js` change is involved.

## Control flow (one run)

```
index.html / jspsych.js
  └─ DoggoNogoEngine.run(canvas, level, options)
       ├─ DoggoNogoCore.preloadAll()        (one-time, global manifest; drives the loading bar)
       ├─ level.load()                       (level-specific assets; reports progress)
       ├─ background-preload otherLevels     (so transitions are instant; reports progress)
       ├─ showCoverScreen()                  (SPACE / tap to start; first user gesture for audio,
       │                                      fullscreen and the phone's orientation lock)
       ├─ CutsceneRunner.run()                  (optional cutscene)
       ├─ level.showInstructionScreen()
       ├─ waitForStart()                     (level-specific start key)
       ├─ level.start(canvas, endCallback)
       └─ loop(): level.update(); level.draw(); drawMarkerIndicator(); rAF
            └─ on finish: compute IES → quantile → DoggoNogoUI.showScoreScreen → onFinish(state)
```

## Conventions

- **Native ES modules.** Every file declares its dependencies with `import` and its API with
  `export`, so the module graph fixes load order and the HTML entry points import only what they
  run. Dependency direction is `assets.js` → `game.js` → `core.js`/`cutscene.js` → `engine.js` →
  levels → `jspsych.js`; keep it acyclic (the engine takes levels as data via `otherLevels`, it
  never imports them).
- **Shared level logic lives in `core.js` (`DoggoNogoBaseLevel`)**; shared non-level helpers live in
  `game.js` (`DoggoNogoCore`). When fixing a mechanic, decide which of the two it belongs in, and
  remember both levels inherit the base.
- **One-time flags** (`globalPreloaded` / `otherLevelsPreloaded` in `engine.js`,
  `phaseCompleteAudio` in `game.js`) are plain module-scoped variables.
- **Reference resolution** uses `1920×1080` (16:9) as the design canvas; fonts/positions scale from it. Backgrounds are still generated at the image model's 7:4 and drawn with `fx.drawImageCover` (crop, never stretch); on screens of another shape `game/index.html` fills the letterbox with a blurred copy of the scene that the engine announces through `DoggoNogoUI.ambient`.
- **Time** comes from `level.now()`, which uses the host jsPsych clock when the engine was given a
  `jsPsych` instance and otherwise falls back to `performance.now()` then `Date.now()`. Use it, not
  `Date.now()` directly, for RT consistency.
- **Trial timing is frame-driven, never `setTimeout`.** `startNewTrial()` records when the next
  stimulus is due; `updateTrialSchedule()` reveals it on the first frame at or after that deadline,
  then stamps `state.startTime` with the *following* frame's timestamp — the frame that actually
  puts it on screen. RT is `eventTime(e) - startTime`, both on the same clock. Per-frame animation
  should read `state.frameTime`, not `now()`.
- **A press just after a timeout is not an early press.** When the response window closes,
  `updateTrialSchedule()` stamps `state.responseWindowClosedAt`; a response key arriving within
  `params.lateResponseGrace` ms of it (default 500, below the ISI floor) is the belated answer to
  the trial that just timed out, and every level's `handleKeyDown` ignores it via the base
  `isBelatedResponse(e)` *before* its early-press branch. Without that check the press was logged
  as `Early` (with the penalty) for the *next* trial — common in Levels 3–5, where a perceptual
  comparison can outlast the `2 × median RT` window.
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
- **A tapped response is not a pressed one.** Touch sampling, scan-out and coalescing all differ
  by handset, so mobile RTs are slower and noisier than keyboard RTs and the two should not be
  pooled. Each level's `gameParams` records `inputModality` and the `viewport` it ran at — once per
  level, not per trial, because it cannot change mid-run. Relatedly, a *dispatched* event's `timeStamp` is the moment of dispatch, not of the
  touch, so the adapter carries the pointer timestamp on `doggoSourceTime` and `eventTime()`
  prefers it — keep that preference if you touch either end.
- **The stage cannot be rotated for the participant on an iPhone.** Safari there supports neither
  the Fullscreen API nor `screen.orientation.lock`, so `_lockLandscape()` (engine.js) silently
  fails and the host page's `#rotate` prompt is the only thing keeping a 16:9 stage off a portrait
  screen. It suspends input while it is up, but it does **not** pause a running level: a
  participant who rotates mid-block will time trials out rather than have them held.
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
  logs (`window.level1Data` … `window.level5Data`).
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
(`?level=4` starts at Level 4, cover screen included, and carries on to the end). `START_LEVEL` in
`game/index.html` is the same switch without the query string; opening the page with no `level`
param applies it and writes it into the address bar. Leave `START_LEVEL` at 1 when shipping; bump it
only while working on a later level, and put it back.

`?levels=` runs **only** the levels listed, in the order given, and then finishes: a range
(`?levels=1-3`), a comma-separated list (`?levels=1,3`), or a mix (`?levels=1-2,5`). Use it to ship
or test a cut of the game that stops short of the unfinished levels - `?levels=1-3` is the current
playable set. It is the more specific of the two switches, so it wins and `?level=` is ignored when
both are given; out-of-range or unparseable entries are dropped with a console warning rather than
failing the page. Both parameters only pick from `ALL_LEVELS` in `game/index.html`; `game/jspsych.js`
builds its own chain in code and reads no query string.

`?trials=N` shortens every level in the chain to N trials for a quick pass through it
(`?trials=3&levels=1-3` combines the two), which is what the short links in README.md point at. It also
lowers `minTrialsPerPhase`, the floor under the phase target, since otherwise a 3-trial level still
demands two fast trials per phase; it never raises either value, so a long run keeps the level's own
numbers. It is a testing and demo switch — a session run that way is not data.

`?gamified=0` runs the barebones comparison condition (see **Plain (non-gamified) mode** above); it
combines with the switches above, e.g. `?gamified=0&levels=1-3&trials=3`. Every data file records
which condition it came from in `gameParams.gamified`.

There is no automated test suite; verification is manual (play through the levels, check
`window.level1Data` … `window.level5Data` in the console for the data log).

> Driving the game from the desktop app's Browser pane: when that pane is **hidden** the page
> reports a `0x0` viewport, so `sizeCanvas()` leaves the canvas at its default 300x150, and
> `getImageData` readbacks come back blank even though the canvas is rendering (screenshots still
> show the real frames). Define fixed `clientWidth`/`clientHeight` on `document.documentElement` and
> dispatch a `resize` before driving, and trust screenshots over pixel readback.


