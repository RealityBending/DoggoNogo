/**
 * @file Plain (non-gamified) level overrides, for the `?gamified=0` comparison condition.
 *
 * REMOVABLE: see the header of ./stimuli.js.
 *
 * Each table below is spread onto a plain level object whose PROTOTYPE is the real level (see
 * ./mode.js), so anything not named here resolves to the game's own implementation. Nothing in
 * this file touches trial scheduling, the adaptive threshold, scoring, phase progression or the
 * data log — those must be the same functions in both conditions, and ./mode.js asserts on load
 * that they still are.
 *
 * What the overrides remove, in one sentence each:
 *   - the whole decoration half of the render pipeline (`draw`)
 *   - the painted scenes (`drawBackground`)
 *   - the animated instruction screens (`showInstructionScreen`)
 *   - the phase-break celebration, keeping the break itself (`playBreakEffects`)
 *   - all trial-level feedback: bubbles, score deltas, the player's jump (`_handleTrialOutcomeFeedback` et al.)
 *   - the stimulus art (`drawStimulus` / `drawStimulusItem`)
 * Sound and artwork need no override at all: ./mode.js gives each plain level a nulled `assets`
 * object, and every consumer in the engine already guards against a missing asset.
 */

import { DoggoNogoInput } from "../input.js"
import { DoggoNogoPlainStimuli } from "./stimuli.js"
import { cancelPlainScoreScreen, drawPlainBreak, drawPlainInstructionFrame, PLAIN_THEME } from "./screens.js"

/** The red already used as Level 1's salience cue, and as the Illusion Game's segment colour. */
const PLAIN_FILL = "#e63946"

const noop = function () {}

/**
 * Params every plain level gets on top of a copy of the game level's own.
 *
 * Deliberately short: matching depends on the plain condition inheriting every timing, scoring and
 * phase parameter unchanged, so only what is genuinely about ink belongs here.
 */
export const plainParams = {
    backgroundColor: PLAIN_THEME.background,
}

/** Overrides shared by all five plain levels. */
export const sharedPlainOverrides = {
    /**
     * No assets to fetch, but the tail of the game's `load` is not optional: it derives the
     * stimulus and player boxes in pixels from the current canvas, and `placeStimulus` samples
     * position inside that stimulus box. Skipping it would leave the box at zero and change the
     * position distribution — see the note on Level 1's envelope below.
     */
    load: function (canvas) {
        this.initializeDimensions(canvas)
        this.placePlayer(canvas)
        return Promise.resolve()
    },

    /**
     * The whole render pipeline for a plain trial.
     *
     * The game's is `clearCanvas -> drawBackground -> drawProgressBar -> drawPlayer -> drawStimulus
     * -> drawScoreFeedback -> drawParticles -> drawFeedbackBubbles -> [overlays]`. Dropping the
     * six decoration layers here is what removes the HUD, the character and every particle,
     * whatever else is still wired up underneath.
     */
    draw: function () {
        this.clearCanvas()
        this.drawBackground()
        this.drawStimulus()
        if (this.state.inBreak) drawPlainBreak(this)
    },

    /** Flat mid-grey, the same pattern the illusion levels already fall back to. */
    drawBackground: function () {
        const ctx = this.state.ctx
        ctx.fillStyle = this.params.backgroundColor
        ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    /**
     * Driven through the base's own `runInstructionScreen`, so the screen is started and — crucially
     * — cancelled by exactly the same code as the game's (`beginLevel` -> `cancelInstructionScreen`).
     * Only the frame differs.
     */
    showInstructionScreen: function (canvas) {
        cancelPlainScoreScreen() // the previous level's end screen, if SPACE was never released on it
        this.runInstructionScreen(canvas, this.plainInstructions)
    },

    drawInstructionFrame: drawPlainInstructionFrame,

    /**
     * The "evolution" beat of a phase break: sprite swap, scene swap, sparkles, sound.
     *
     * Stubbed rather than removed from the break sequence, because `updateBreak` — which calls
     * this — also drives `breakState: "started" -> "effects" -> "ready"`, and `resumeFromBreak`
     * refuses to continue until it reads "ready". Stub the effects, never the state machine.
     */
    playBreakEffects: noop,

    /**
     * Trial-level feedback, in full: bubbles, cue sounds, the error flash, the fast-streak counter.
     *
     * Safe to drop wholesale — the fields it writes (`lastFastFeedback`, `lastTrialType`,
     * `flashUntil`) are read only when choosing which bubble to show. Nothing here is logged or
     * consulted by scoring.
     */
    _handleTrialOutcomeFeedback: noop,

    // Score text, bubbles and the player's reaction-time-proportional jump. `jump` is called from
    // inside `handleKeyDown` (which must stay the game's own function), so it is stubbed here
    // rather than edited out at the call site.
    showScoreDelta: noop,
    showScoreFeedback: noop,
    showFeedbackBubble: noop,
    jump: noop,

    // Belt and braces: `draw` above already skips these, but a level or a future base change that
    // calls one directly should still paint nothing.
    drawPlayer: noop,
    drawPlayerShadow: noop,
    drawScoreFeedback: noop,
    drawParticles: noop,
    drawFeedbackBubbles: noop,
    drawBreakOverlay: noop,
    drawEndOverlay: noop,
}

/**
 * Overrides shared by the three illusion levels (3-5).
 *
 * `composeStimulusItems` stays the game's, so the pair's lengths, angles, jitter and the signed
 * `TaskDifficulty` / `IllusionStrength` are drawn from identical distributions in both conditions;
 * only `drawStimulusItem` differs.
 */
const sharedIllusionPlainOverrides = {
    /**
     * As the game's, minus the exit fade. The stimulus disappears the moment it stops being
     * `visible`; the 200 ms `exiting` window carries on invisibly, because it is a response
     * refractory period (presses during it are silently dropped) rather than an animation.
     */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible) return
        stim.items.forEach((item) => this.drawStimulusItem(item))
    },
}

/** Task instructions, in plain prose. See below for why they are longer than the game's. */
const instructionPrompt = () => (DoggoNogoInput.isTouch ? "Tap the screen to start" : "Press an arrow key to start")

export const plainLevelOverrides = {
    1: {
        plainInstructions: {
            title: "Task 1",
            lines: [
                "A red line will appear somewhere on the screen.",
                "Press the DOWN ARROW as fast as you can when it does.",
                "Do not press before it appears.",
            ],
            touchLines: [
                "A red line will appear somewhere on the screen.",
                "Tap the screen as fast as you can when it does.",
                "Do not tap before it appears.",
            ],
            prompt: () => (DoggoNogoInput.isTouch ? "Tap the screen to start" : "Press the DOWN ARROW to start"),
        },

        /**
         * The bone's placement envelope, unchanged.
         *
         * `params.stimulusHeight` is the SQUARE that holds the stimulus at any rotation, and
         * `placeStimulus` samples `Math.random() * (canvas.width - stimulus.width)` inside it — so
         * the envelope sets the distribution of stimulus positions. Deriving it from the bone, as
         * the game does, is what keeps that distribution identical here, and it is why the plain
         * params keep `boneOutlines` even though nothing draws an outline: the envelope maths reads
         * them. The drawn segment is simply smaller than the square it is placed in, exactly as the
         * bone is at most angles.
         */
        load: function (canvas) {
            this.params.stimulusHeight = this.getBoneEnvelopeFraction()
            this.initializeDimensions(canvas)
            this.placePlayer(canvas)
            return Promise.resolve()
        },

        drawStimulus: function () {
            const stim = this.state.stimulus
            if (!stim.visible) return
            const canvasHeight = this.state.canvas.height
            DoggoNogoPlainStimuli.drawSegment(this.state.ctx, {
                centerX: stim.x + stim.width / 2,
                centerY: stim.y + stim.height / 2,
                length: canvasHeight * this.params.stimulusLength,
                thickness: canvasHeight * this.params.stimulusThickness,
                angle: stim.angle,
                fill: PLAIN_FILL,
            })
        },
    },

    2: {
        plainInstructions: {
            title: "Task 2",
            lines: [
                "An arrow will appear on the screen.",
                "Press the LEFT or RIGHT arrow key matching the direction the arrow POINTS.",
                "Ignore where it appears: it may be on the left, the right, above or below.",
                "Respond as fast as you can without making mistakes.",
            ],
            touchLines: [
                "An arrow will appear on the screen.",
                "Tap the left or right half of the screen to match the direction the arrow POINTS.",
                "Ignore where it appears: it may be on the left, the right, above or below.",
                "Respond as fast as you can without making mistakes.",
            ],
            prompt: instructionPrompt,
        },

        /**
         * The arrow fills the same box the fishbone does: `getFishboneGeometry` is the game's own,
         * and the plain params keep `fishOutlines` so its outline-spill correction still applies
         * and the two stimuli span exactly the same extent.
         *
         * `stim.fill` is used rather than a constant so that `params.stimulusColorMode` keeps
         * working untouched — under "orthogonal" the colour varies per trial, independently of the
         * response, in this condition too.
         */
        drawStimulus: function () {
            const stim = this.state.stimulus
            if (!stim.visible) return
            const geom = this.getFishboneGeometry(stim.height)
            DoggoNogoPlainStimuli.drawArrow(this.state.ctx, {
                centerX: stim.x + stim.width / 2,
                centerY: stim.y + stim.height / 2,
                length: geom.length,
                height: geom.innerHeight,
                direction: stim.side === "right" ? 1 : -1,
                fill: stim.fill || this.params.fishFill,
            })
        },
    },

    3: {
        ...sharedIllusionPlainOverrides,
        plainInstructions: {
            title: "Task 3",
            lines: [
                "Two red lines will appear, one on each side of the screen.",
                "Press the LEFT or RIGHT arrow key pointing at the LONGER line.",
                "The lines may be tilted, and a line standing on its end can look longer than it is.",
                "The differences get smaller as the task goes on.",
            ],
            touchLines: [
                "Two red lines will appear, one on each side of the screen.",
                "Tap the side with the LONGER line.",
                "The lines may be tilted, and a line standing on its end can look longer than it is.",
                "The differences get smaller as the task goes on.",
            ],
            prompt: instructionPrompt,
        },

        /** The Illusion Game's vertical-horizontal stimulus: two plain red segments. */
        drawStimulusItem: function (item) {
            const canvas = this.state.canvas
            DoggoNogoPlainStimuli.drawSegment(this.state.ctx, {
                centerX: canvas.width * item.cxFrac,
                centerY: canvas.height * item.cyFrac,
                length: canvas.height * item.lengthFrac,
                thickness: canvas.height * this.params.stimulusThickness,
                angle: item.angle,
                fill: PLAIN_FILL,
            })
        },
    },

    4: {
        ...sharedIllusionPlainOverrides,
        plainInstructions: {
            title: "Task 4",
            lines: [
                "Two red lines will appear, one on each side of the screen,",
                "each with a pair of fins at both of its ends.",
                "Press the LEFT or RIGHT arrow key pointing at the LONGER line.",
                "Judge the line itself, not the fins.",
                "The differences get smaller as the task goes on.",
            ],
            touchLines: [
                "Two red lines will appear, one on each side of the screen,",
                "each with a pair of fins at both of its ends.",
                "Tap the side with the LONGER line.",
                "Judge the line itself, not the fins.",
                "The differences get smaller as the task goes on.",
            ],
            prompt: instructionPrompt,
        },

        /** The canonical Müller-Lyer figure; `finAngleDeg` is the game's own, 90 = neutral. */
        drawStimulusItem: function (item) {
            const canvas = this.state.canvas
            DoggoNogoPlainStimuli.drawMullerLyer(this.state.ctx, {
                centerX: canvas.width * item.cxFrac,
                centerY: canvas.height * item.cyFrac,
                length: canvas.height * item.lengthFrac,
                thickness: canvas.height * this.params.stimulusThickness,
                finAngleDeg: item.finAngleDeg,
                finLength: canvas.height * this.params.stringLength,
                fill: PLAIN_FILL,
            })
        },
    },

    5: {
        ...sharedIllusionPlainOverrides,
        plainInstructions: {
            title: "Task 5",
            lines: [
                "Two red circles will appear, one on each side of the screen,",
                "each surrounded by a ring of grey circles.",
                "Press the LEFT or RIGHT arrow key pointing at the LARGER red circle.",
                "Ignore the grey circles around them.",
                "The differences get smaller as the task goes on.",
            ],
            touchLines: [
                "Two red circles will appear, one on each side of the screen,",
                "each surrounded by a ring of grey circles.",
                "Tap the side with the LARGER red circle.",
                "Ignore the grey circles around them.",
                "The differences get smaller as the task goes on.",
            ],
            prompt: instructionPrompt,
        },

        /**
         * Geometry untouched — Level 5's figures are already plain discs, so this is the game's own
         * `_drawEbbinghausItem` with the two fills restyled (see `plainLevel5Params`).
         *
         * Target and inducers stay different colours rather than adopting the canonical
         * single-colour Ebbinghaus: making them identical would turn "judge the middle disc" into a
         * harder search, which would unmatch the task demand rather than just its appearance.
         */
        drawStimulusItem: function (item) {
            this._drawEbbinghausItem(this.state.ctx, this.state.canvas, item)
        },
    },
}

/** Per-level plain params, merged over a copy of the game level's own. */
export const plainLevelParams = {
    // Level 2 picks its stimulus colour through `state.fillPalette`, which `start()` fills from
    // these params — so recolouring the arrow means recolouring the source, not the draw call, and
    // `stimulusColorMode: "orthogonal"` keeps working untouched if it is ever switched on.
    // `fishOutlines` is deliberately NOT removed: nothing strokes it, but `fishboneBox` reads its
    // width to correct the stimulus extent, and dropping it would make the arrow longer than the
    // fishbone it stands in for.
    2: { fishFill: PLAIN_FILL },
    5: { ballFill: PLAIN_FILL, contextFill: "#4a4a4a" },
}
