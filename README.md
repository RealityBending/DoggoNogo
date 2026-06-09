# Doggo/Nogo: The Neuropsychological Game

The game can be run as a standalone html or integrated within JsPsych.

Play the game:

- [**Standalone**](https://realitybending.github.io/DoggoNogo/game/)
- [**JsPsych**](https://realitybending.github.io/DoggoNogo/example_jspsych.html)


Studies:

- [**Validation 1**](https://github.com/RealityBending/DoggoNogoValidation)

## Details

### Overview

**Scientific summary**

DoggoNogo is a browser-based gamified neuropsychological battery designed to measure cognitive control constructs, such as processing speed, response inhibition, and conflict monitoring, through an engaging narrative game. The underlying paradigms (simple reaction time and a Simon-task variant) are well-established in experimental psychology. By embedding them inside a progression-based game with animated sprites, sound, and a points system, the battery aims to increase participant engagement and ecological validity compared to traditional lab tasks. The task is designed to be administered online as part of a larger *jsPsych* experiment or as a fully standalone web page.

**Technical summary**

The app is a pure client-side HTML5 application with no build step or server dependency. The rendering target is a `<canvas>` element that scales responsively to the viewport via CSS. The codebase is organized as follows:

| File | Role |
|---|---|
| `game/game.js` | Shared UI helpers: score-screen animation, `zScoreToQuantile`, loading screen, asset preloader (`DoggoNogoCore`), trial-type constants |
| `game/engine.js` | Central `DoggoNogoEngine` — orchestrates asset loading, cover screen, intro sequence, instruction screen, `requestAnimationFrame` game loop, marker (photodiode) support, and the end-of-level IES calculation |
| `game/intro.js` | `IntroRunner` — a generic step-sequenced cutscene player (fill / text / image / sound / wait steps) plus inline intro-asset loader |
| `game/levels/level1.js` | All logic for Level 1 (Simple RT) as a single self-contained `level1` object |
| `game/levels/level2.js` | All logic for Level 2 (Simon task) as a single self-contained `level2` object |
| `game/levels/intro.js` | Level-1 intro cutscene sequence definition |
| `game/jspsych.js` | Thin jsPsych integration layer: creates `jsPsychCallFunction` trials, manages canvas lifecycle inside the jsPsych display element, and serialises per-trial data back into jsPsych's data store |
| `game/index.html` | Standalone entry point |
| `example_jspsych.html` | Minimal jsPsych integration example |

Levels expose a uniform interface (`load`, `showInstructionScreen`, `start`, `update`, `draw`, `handleResize`) consumed by the engine. Asset paths are relative and accept a configurable `assetBasePath` so the game can be served from any directory. An optional **marker** square (for physiological synchronisation via a photosensor) can be enabled via `markerEnabled: true` and flashes on stimulus onset or keypress.



### Level 1

**Scientific summary**

Level 1 implements a **Simple Reaction Time (SRT) task**, one of the most fundamental measures in cognitive neuroscience. A single stimulus appears at a pseudo-random screen position after a variable inter-stimulus interval (ISI: 1 000–3 000 ms); the participant must press a single key (`ArrowDown`) as quickly as possible. Because there is only one possible stimulus and one possible response, the task requires no discrimination or selection: it measures the lower bound of sensorimotor processing speed free from decision conflict.

Responses are classified as:
- **Fast** (RT ≤ adaptive threshold): rewarded with scaled points (100–200).
- **Slow** (RT > threshold but before timeout): rewarded with 0 bonus points.
- **Early** (key pressed before stimulus): penalised (−minScore), recorded as a commission error reflecting response inhibition failure.
- **Timeout** (no response within 2 × median RT): 0 points.

The adaptive **median RT threshold** (initialised at 1 000 ms, updated after every valid trial using a running median) serves a dual purpose: it provides an individually-tailored difficulty parameter so the task remains challenging regardless of baseline speed, and it functions as the decision criterion separating fast from slow trials. The parameter `gameDifficulty` (default 1) divides the median to shift this threshold (> 1 makes it easier; < 1 makes it harder).

The end-of-level performance score is **IES** (Mean correct RT / (1 − Error Rate)), Z-scored against stored population parameters (`populationMean`, `populationSD`) and converted to a percentile, which is shown to the participant as a score-screen animation. Individual trial data including RT, trial type, and cumulative score are exported for downstream statistical analysis.

**Technical summary**

The level is structured as a plain JavaScript object (`level1`) with three top-level sections: `params` (static configuration), `assets` (preloaded `Image` and `Audio` objects), and `state` (all mutable runtime data). The game logic runs entirely inside the engine's `requestAnimationFrame` loop, which calls `level1.update()` (physics + timer management) and `level1.draw()` (canvas rendering) every frame.

Key implementation details:

- **Stimulus placement**: The stimulus spawns at a random horizontal position (left/right thirds of the canvas) and falls a small fixed distance (`stimulusFallDistance = 5 % of canvas height`) before the response window closes, providing a visual onset cue.
- **Physics**: On a valid keypress the player sprite performs a jump whose vertical velocity is linearly interpolated between `minJumpStrength` and `maxJumpStrength` based on normalised RT, giving faster responses a visually more impressive jump.
- **Trial count and adaptive phase targets**: The level is divided into **3 phases** separated by animated break sequences (tunnel-vision overlay + sprite evolution). `trialsNumber` is a *theoretical target*, not a hard cap — actual trial count depends on performance. At each phase break the score target for the next phase is recomputed: it distributes the remaining theoretical valid trials across remaining phases, assumes ~50 % will be fast (earning at least `minScore`), and takes the max of that estimate and the per-phase floor `max(minScore, (minTrialsPerPhase / 2) × minScore)`. A consistently fast player reaches targets slightly sooner (fewer actual trials); a slower/less accurate player needs more — but recomputing at each break nudges the total toward `trialsNumber`. Early presses and timeouts are excluded from the trial counter.
- **Sprite evolution**: At each phase break the player sprite (`imgPlayer1/2/3`) swaps, accompanied by a sparkle particle system and a sound effect, providing intrinsic gamification rewards.
- **Data log**: Every keypress (including early presses before stimulus onset) appends a record to `level1.state.data` (also exposed as `window.level1Data`). Fields include: `RT`, `TrialType` (`"fast"/"slow"/"early"/"timeout"`), `Error` (0/1), `Points`, `Score`, `Phase`, `StimulusX/Y`, `Threshold`.


### Level 2

**Scientific summary**

Level 2 implements a gamified **Simon task**, a canonical paradigm for measuring **inhibitory control** and **conflict monitoring**. Unlike Level 1, the stimulus can appear on either the left or right side of the screen (or, in Phase 2, above/below). The participant responds with a directional key (`ArrowLeft` / `ArrowRight`) that must match the *orientation* of the stimulus object (a fishbone pointing left or right) — not necessarily its spatial position. This creates a potential conflict between the automatic tendency to respond toward the side where the stimulus appears (the Simon effect) and the correct rule-based response based on stimulus direction.

The level progresses across three phases of increasing cognitive demand:

| Phase | Trial types | Cognitive demand |
|---|---|---|
| **Phase 1** (congruent only) | Stimulus position always matches required response direction | Baseline visuomotor compatibility; no conflict |
| **Phase 2** (congruent + neutral) | Adds vertically spawned stimuli (top/bottom) with no lateral position cue | Neutral condition; introduces spatial uncertainty without direct conflict |
| **Phase 3** (congruent + incongruent) | Adds horizontally spawned stimuli where position opposes required response direction | Maximal Simon interference; requires active response inhibition |

Incongruent trials in Phase 3 are expected to produce longer RTs and higher error rates than congruent trials — the **Simon effect** — quantifying the efficiency of the participant's inhibitory control. Errors (incorrect direction key) are penalised (`−minScore/2`) and logged with `difficulty: "incongruent"/"congruent"/"neutral"` for downstream contrast analysis (e.g., congruency effect = RT_incongruent − RT_congruent). The `neutralProportionPhase2` and `incongruentProportionPhase3` parameters allow researchers to adjust the conflict load without changing game structure.

**Technical summary**

Level 2 shares the same object interface and engine as Level 1 but adds the following mechanisms:

- **Trial count and phase targets**: `trialsNumber` uses a simpler fixed-target scheme than Level 1. At level start: `perPhaseTrials = ceil(trialsNumber / 3)` and every phase gets the same constant target `perPhaseTrials × minScore`. There is no adaptive recomputation between phases. As in Level 1, early presses do not increment the trial counter, so participants who make many commission errors will see more stimulus presentations to accumulate the required score.
- **Stimulus-side assignment**: At level start, the two stimulus image variants (`stimulus_1.png`, `stimulus_2.png` — fishbones facing different directions) are randomly assigned to left/right sides once, counter-balancing across participants.
- **Spawn regions**: On each trial a region (`"left"`, `"right"`, `"top"`, `"bottom"`) is drawn stochastically based on the current phase's conflict proportions. Left/right spawns place the stimulus at a fixed horizontal edge; top/bottom spawns (`stimulusLocationTopY`, `stimulusLocationBottomY`) are the neutral condition, carrying no lateral position cue.
- **Congruency logic**: For a left/right spawn, the stimulus image is chosen to be either congruent (fish points toward the spawn side) or incongruent (fish points away) based on `incongruentProportionPhase3`. For top/bottom spawns the response is always determined purely by the image direction (neutral by definition).
- **Player mirroring**: The `playerFacing` state (`"left"` / `"right"`) is updated on each correct response and the sprite is horizontally flipped via `ctx.scale(-1, 1)`, reflecting the direction of the last correct response.
- **Error handling**: An incorrect key direction triggers an error flash (red sprite tint), plays `sound_error.mp3`, and deducts points — providing salient negative feedback without ending the trial prematurely.
- **Phase instructions**: Each inter-phase break overlay shows phase-specific instructional text (e.g., introducing vertical spawns in Phase 2) so participants understand the evolving task rules.
- **Data log fields** (per trial): `RT`, `TrialType`, `Error`, `Points`, `Score`, `Phase`, `StimulusRegion` (`"left"/"right"/"top"/"bottom"`), `StimulusDifficulty` (`"congruent"/"neutral"/"incongruent"`), `ResponseKey`, `Threshold`.