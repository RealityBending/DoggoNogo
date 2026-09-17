/**
 * @file Shared logic for the illusion levels (3, 4, 5) — perceptual inference under visual illusions.
 *
 * Levels 3-5 are the same game with three different illusions: two stimuli appear either side of
 * Doggo and the player names the larger one with the matching arrow key (ArrowLeft / ArrowRight).
 * Unlike Levels 1 and 2, the answer is not given by *where* the stimulus is but by a perceptual
 * comparison, so accuracy is the primary measure and RT is secondary. What makes it an *inference*
 * task rather than plain psychophysics is the illusory context wrapped around the comparison. The
 * design is ported from the Illusion Game (https://github.com/RealityBending/IllusionGame;
 * https://github.com/RealityBending/Pyllusion; Makowski et al., psyarxiv/873th):
 *
 *   Level 3 — Vertical-horizontal   (game/levels/level3.js)
 *   Level 4 — Müller-Lyer           (game/levels/level4.js)
 *   Level 5 — Ebbinghaus            (game/levels/level5.js; placeholder without context circles yet)
 *
 * Two orthogonal parameters describe every trial, both sampled fresh in `placeStimulus` and logged
 * with the Illusion Game / Pyllusion sign conventions:
 *
 *  - `TaskDifficulty`: the objective difference between the two percepts, as a proportion of the
 *    smaller one. The SIGN gives the side of the correct response: positive = LEFT is larger,
 *    negative = RIGHT is larger. Magnitude is sampled log-uniformly across the phase's
 *    `difficultyRange`, so the hard (small-difference) end of a wide range is sampled as densely
 *    as the easy end (Weber-like spacing, as in the Illusion Game's exponentially spaced sets).
 *  - `IllusionStrength`: how strongly the illusory context distorts the comparison (units are the
 *    illusion's own manipulated quantity, e.g. degrees of tilt or of fin sweep). The SIGN gives
 *    congruence: negative = congruent/facilitating (the illusion inflates the truly larger side),
 *    positive = incongruent/interfering (it inflates the smaller side). Magnitude is sampled
 *    uniformly across the phase's `strengthRange`; which side it boosts is drawn independently of
 *    which side is truly larger, so both signs occur equally often.
 *
 * The three phases of each level ramp those two ranges rather than changing the task, configured
 * per level as `params.phases = [{ difficultyRange: [lo, hi], strengthRange: [lo, hi] }, ...]`:
 * Phase 1 = obvious differences + at most a weak illusion (learn the comparison), Phase 2 = still
 * obvious differences + the full illusion range (feel the illusion), Phase 3 = the full difficulty
 * range + the full illusion range (the measurement block). There is no adaptive staircase: the
 * design crosses difficulty with strength, and adapting difficulty to accuracy would confound the
 * two.
 *
 * The stimuli are drawn procedurally (see game/stimuli.js) rather than blitted from a PNG, because
 * size is the manipulated variable: a scaled sprite would deform its proportions and hand the
 * player a cue that is not extent, and no sprite can take an arbitrary fin angle or tilt. Two
 * further controls guard the measurement, applied per trial in `placeStimulus`:
 *
 *  - Roving standard: the base size is re-drawn every trial, so "how big it should be" cannot be
 *    learned and carried across trials — only the within-trial comparison survives.
 *  - Independent centre jitter: without it the two stimuli's near edges sit at almost the same
 *    place, and endpoint alignment is judged far more precisely than extent, so the player would
 *    be doing a vernier task instead of this one.
 *
 * Everything gameplay-shaped (physics, phase progression, progress bar, feedback bubbles, data
 * plumbing) comes from `DoggoNogoBaseLevel` (game/core.js); this object sits between it and the
 * concrete levels: `levelN -> DoggoNogoIllusionLevel -> DoggoNogoBaseLevel`. A concrete level
 * defines its `params`/`assets`/`state` plus the illusion-specific hooks:
 *
 *   levelNumber                      3 | 4 | 5 (drives labels and the window.levelNData global)
 *   illusion                         illusion name logged with every trial
 *   instructionTitle                 display title of the instruction screen
 *   instructionLines                 lines for the instruction screen
 *   drawInstructionDemo(ctx, canvas, midY)   example pair on the instruction screen, columns at
 *                                            x = 0.3 / 0.7 of the canvas (keycaps are drawn there)
 *   composeStimulusItems(cfg, trial) -> items   geometry of the pair, as canvas fractions
 *   drawStimulusItem(item)                      draws one item (called per frame)
 *   getStimulusLogFields(stim|null) -> object   per-illusion geometry columns for the data log
 *   getBreakOverlayLines()                      phase-break text (base default if omitted)
 *
 * Scoring (same shape as Level 2):
 *   Fast  (<= threshold)               : + minScore..maxScore (scaled by RT)
 *   Slow  (> threshold, before timeout): + minScore/2
 *   Error (named the smaller one)      : - minScore/2
 *   Early (before stimulus visible)    : - minScore
 *   Timeout (no response)              : 0
 *   Only correct fast/slow trials update the adaptive median RT.
 *
 * Phase targets are fixed: perPhaseTrials = ceil(trialsNumber/3); each phase target =
 * perPhaseTrials * minScore.
 *
 * Feedback bubbles and sounds are borrowed from Level 1 (see `borrowedLevel1Assets`), and so are the
 * player sprites until a level has its own: a level that sets `artFolder` (Level 3: `"level3"`) takes
 * its `player_1..3.webp` from that folder instead, and one that also sets `backgrounds` gets a scene
 * per phase rather than the flat backdrop. The stimuli themselves need no asset at all.
 */

import { DoggoNogoBaseLevel } from "../core.js"
import { DoggoNogoCore, DoggoNogoUI, DoggoNogoTrialTypes as TrialTypes } from "../game.js"

/**
 * Sizes are logged as fractions of canvas height, not pixels: the same fraction means the same
 * stimulus on any display, and `CanvasHeight` in the same row recovers the pixel size.
 */
export const round4 = (v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : "NA")
export const round1 = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : "NA")

/**
 * Fresh copy of the params every illusion level shares. Levels spread this into their own
 * `params` and add their illusion-specific geometry plus the per-phase ranges on top; each level
 * gets its own object, so tuning one level never bleeds into another.
 */
export function illusionDefaultParams() {
    return {
        trialsNumber: 12,
        minTrialsPerPhase: 4,
        minISI: 500, // Floor (ms)
        maxISI: 3500, // Ceiling (ms)
        meanISIDecay: 1000, // Scale parameter (ms) for the pseudoexponential ISI distribution
        minScore: 100,
        maxScore: 200,
        gameDifficulty: 1,
        populationMean: 300,
        populationSD: 20,
        gravity: 0.5,
        maxJumpStrength: -8,
        minJumpStrength: -1,
        stimulusFallDistance: 0, // static stimulus (no falling animation in these levels)
        playerHeight: 0.2, // % of canvas height
        playerY: 0.5, // vertical centre of the canvas
        stimulusHeight: 0.1, // % of canvas height; only sizes the base class's bookkeeping box
        stimulusOffsetX: 0.25, // horizontal distance from centre, as a fraction of canvas width
        stimulusSizeJitter: 0.15, // roving standard: base size varies +-15% per trial
        stimulusJitterX: 0.04, // centre jitter (fraction of canvas width), breaks endpoint alignment
        stimulusJitterY: 0.08, // centre jitter (fraction of canvas height)

        flashDuration: 150, // ms duration of the red flash for errors/early presses
        flashTintColor: "255,0,0", // base RGB; alpha animated
        feedbackBubbleHeight: 0.2, // % of canvas height
        backgroundColor: "#808080", // plain grey backdrop (no background image yet)

        // Phase-break "evolution" sparkle burst (golden); consumed by the base `playBreakEffects`
        breakSparkles: {
            count: 50,
            speedMin: 2,
            speedMax: 7,
            sizeMin: 2,
            sizeMax: 6,
            lifeMin: 60,
            lifeMax: 140,
            colorFn: () => `hsl(${Math.random() * 60}, 100%, 85%)`,
        },
    }
}

/**
 * Fresh set of the Level 1 assets the illusion levels borrow. Feedback bubbles and sounds stay
 * borrowed (there is no illusion-level feedback art yet); the player sprites are only a stand-in for
 * a level with no sheet of its own — set `artFolder` once its sheet is generated (art/make_prompts.py
 * prompts one evolution sheet per level) and cut into assets/level{3,4,5}/. A level with per-phase
 * scenes adds its own `imgBackground` / `imgBackground1..N` images (see level3.js), since the levels
 * without art draw the plain `params.backgroundColor` instead.
 */
export function borrowedLevel1Assets() {
    return {
        imgPlayer: new Image(), // current sprite used for drawing
        imgPlayer1: new Image(),
        imgPlayer2: new Image(),
        imgPlayer3: new Image(),
        imgFeedbackSlow: new Image(),
        imgFeedbackLate: new Image(),
        imgFeedbackEarly: new Image(),
        imgFeedbackError: new Image(),
        imgFeedbackFast1: new Image(),
        imgFeedbackFast2: new Image(),
        imgFeedbackFast3: new Image(),
        soundFast: new Audio(),
        soundSlow: new Audio(),
        soundError: new Audio(),
        soundEvolve: new Audio(),
        soundLevelUp: new Audio(),
        soundStart: new Audio(),
        // Cover screen art (shared); the title itself is drawn in code by the engine.
        imgCover: new Image(),
    }
}

export const DoggoNogoIllusionLevel = {
    startKeys: ["ArrowLeft", "ArrowRight"],
    endOverlayTitle: "Level Complete",

    /** Builds a clean runtime state, so a re-run of the level never inherits stale data. */
    getInitialState: function () {
        return {
            gameState: "playing", // "playing" | "done"
            score: 0,
            trials: 0,
            reactionTimes: [],
            particles: [],
            feedbackBubbles: [],
            data: [], // per-keypress data log; exposed as window.level<N>Data
            lastTrialType: null,
            lastFastFeedback: 0, // 0 = no streak, 1 = fast1, 2 = fast2, 3 = fast3
            flashUntil: 0, // timestamp until which the player sprite flashes (early/error feedback)
            tintedSpriteCache: {},

            player: { x: 0, y: 0, width: 100, height: 100, velocityY: 0, jumping: false, originalY: 0 },

            stimulus: {
                x: 0,
                y: 0,
                width: 50,
                height: 50,
                visible: false,
                exiting: false,
                exitType: "catch", // "catch" | "timeout"
                exitDuration: 200, // ms
                exitStartTime: 0,
                exitInitialX: 0,
                exitInitialY: 0,
                initialY: 0,
                exitInitialWidth: 0,
                exitInitialHeight: 0,

                // The pair itself. Geometry is stored as canvas fractions and converted to pixels
                // at draw time, so a resize mid-trial rescales the pair instead of stranding it.
                items: [], // [{ side, cxFrac, cyFrac, ...per-illusion geometry }]
                longerSide: null, // "left" | "right" — the correct answer
                boostedSide: null, // side the illusion inflates (null when no illusion this trial)
                taskDifficulty: 0, // signed; see the file header
                illusionStrength: 0, // signed; see the file header
            },

            // Trial timing, all in the level clock (see core.js)
            frameTime: 0,
            clockOffset: 0,
            startTime: 0,
            stimulusScheduledTime: 0,
            stimulusDueTime: null,
            responseDeadline: null,
            responseWindowClosedAt: null, // frame time of the last timeout (see isBelatedResponse)
            onsetPending: false,

            medianRT: 1000,
            maxRT: 2000,

            // Score feedback text
            scoreText: "",
            scoreTextVisible: false,
            scoreTextTimeout: null,
            scoreTextPoints: 0,

            // Phase progression state (3 phases with 2 breaks)
            phaseIndex: 0,
            inBreak: false,
            breakState: "idle",
            breakStartTime: 0,
            showBreakText: false,
            phaseRequiredScores: [0, 0, 0],
            phaseTargetsCache: null,
            phaseFloorScore: 0,

            canvas: null,
            ctx: null,

            // End overlay/button
            endOverlayVisible: false,
            endButtonRect: { x: 0, y: 0, w: 0, h: 0 },
            showContinueButton: false,
            continueLabel: "Continue",
        }
    },

    /**
     * Loads the level's assets and resolves once ready, then computes dimensions.
     *
     * The feedback art and the sounds are Level 1's for every illusion level. The player sprites
     * come from `this.artFolder` when the level has a sheet of its own (Level 3) and from Level 1
     * otherwise, and `this.backgrounds` — one path per phase — is loaded into
     * `assets.imgBackground1..N`, which the base `playBreakEffects` swaps at each break. The first
     * scene is made current here rather than in `start`, so the instruction screen and the engine's
     * ambient surround already show the level's own artwork.
     */
    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        const sprites = this.artFolder || "level1"
        this.assets.imgPlayer1.src = `${base}${sprites}/player_1.webp`
        this.assets.imgPlayer2.src = `${base}${sprites}/player_2.webp`
        this.assets.imgPlayer3.src = `${base}${sprites}/player_3.webp`
        this.assets.imgFeedbackSlow.src = base + "level1/feedback_slow1.png"
        this.assets.imgFeedbackLate.src = base + "level1/feedback_late1.png"
        this.assets.imgFeedbackEarly.src = base + "level1/feedback_early1.png"
        this.assets.imgFeedbackError.src = base + "level1/feedback_early1.png" // placeholder: no illusion-level error art yet
        this.assets.imgFeedbackFast1.src = base + "level1/feedback_fast1.png"
        this.assets.imgFeedbackFast2.src = base + "level1/feedback_fast2.png"
        this.assets.imgFeedbackFast3.src = base + "level1/feedback_fast3.png"
        this.assets.soundFast.src = base + "level1/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level1/sound_slow.mp3"
        this.assets.soundError.src = base + "level1/sound_early.mp3"
        this.assets.soundEvolve.src = base + "level1/sound_evolve.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3"
        this.assets.imgCover.src = base + "cover.webp"

        // Per-phase scenes, when the level has them. Missing `imgBackgroundN` images would mean the
        // level listed more scenes than it declared in `assets`, which is a wiring mistake worth
        // hearing about rather than a silently grey phase.
        const backgrounds = (this.backgrounds || []).map((file, i) => {
            const img = this.assets["imgBackground" + (i + 1)]
            if (!img) throw new Error(`level ${this.levelNumber}: no assets.imgBackground${i + 1} for ${file}`)
            img.src = base + file
            return img
        })

        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgFeedbackSlow,
            this.assets.imgFeedbackLate,
            this.assets.imgFeedbackEarly,
            this.assets.imgFeedbackError,
            this.assets.imgFeedbackFast1,
            this.assets.imgFeedbackFast2,
            this.assets.imgFeedbackFast3,
            this.assets.soundFast,
            this.assets.soundSlow,
            this.assets.soundError,
            this.assets.soundEvolve,
            this.assets.soundLevelUp,
            this.assets.soundStart,
            this.assets.imgCover,
            ...backgrounds,
        ]
        return DoggoNogoCore.loadAssets(assetRefs, options && options.onProgress).then(() => {
            if (backgrounds.length) this.assets.imgBackground = backgrounds[0]
            this.initializeDimensions(canvas)
            this.placePlayer(canvas)
        })
    },

    /**
     * The level's current scene when it declared any (`backgrounds`, swapped per phase by
     * `playBreakEffects`), otherwise the plain grey backdrop the illusion levels started with.
     */
    drawBackground: function () {
        const ctx = this.state.ctx
        const bg = this.assets.imgBackground
        if (bg && bg.complete && bg.naturalWidth) {
            DoggoNogoUI.fx.drawImageCover(ctx, bg, 0, 0, this.state.canvas.width, this.state.canvas.height)
            return
        }
        ctx.fillStyle = this.params.backgroundColor
        ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    /**
     * Instruction screen, on the shared animated frame (badge, title, panel, pulsing prompt; see
     * `drawInstructionFrame` in core.js) so these levels look like Levels 1 and 2. The visual is
     * an example pair drawn by the level's `drawInstructionDemo` - which uses the same stimulus
     * code path as the task, so the demonstration cannot drift away from what the player is about
     * to see - with the matching arrow keycap under each side.
     */
    showInstructionScreen: function (canvas) {
        const { fx } = DoggoNogoUI
        this.runInstructionScreen(canvas, {
            badge: `LEVEL ${this.levelNumber}`,
            title: this.instructionTitle || `Level ${this.levelNumber}`,
            lines: this.instructionLines || [],
            promptSegments: [{ t: "Press" }, { k: "◀" }, { t: "or" }, { k: "▶" }, { t: "to start" }],
            drawVisual: (ctx, layout) => {
                // The demos are laid out at x = 0.3 / 0.7 of the canvas; the keycaps sit under
                // those same columns, just below the visual band, clear of the tallest demo.
                const demoY = layout.top + (layout.bottom - layout.top) * 0.45
                this.drawInstructionDemo(ctx, canvas, demoY)
                const capH = layout.h * 0.048
                const capY = layout.bottom + layout.h * 0.015
                fx.drawKeycap(ctx, layout.w * 0.3, capY, capH, "◀")
                fx.drawKeycap(ctx, layout.w * 0.7, capY, capH, "▶")
            },
        })
    },

    start: function (canvas, endGameCallback, options) {
        this.beginLevel(canvas, endGameCallback, options)
        this.state.maxRT = 2 * this.state.medianRT
        const targetPerPhase = this.computePhaseTarget()
        this.setPhaseTargets([targetPerPhase, targetPerPhase, targetPerPhase])
        window[`level${this.levelNumber}Data`] = this.state.data
        this.assets.imgPlayer = this.assets.imgPlayer1
        // A re-run starts at phase 1, so the scene has to go back with the sprite.
        if (this.assets.imgBackground1) this.assets.imgBackground = this.assets.imgBackground1
        this.startNewTrial()
    },

    /** Fixed per-phase target = ceil(trialsNumber/3) * minScore. */
    computePhaseTarget: function () {
        const perPhaseTrials = Math.ceil(this.params.trialsNumber / 3)
        return perPhaseTrials * this.params.minScore
    },

    /** Difficulty/strength ranges of the current phase (see `params.phases`). */
    getPhaseConfig: function () {
        const phases = this.params.phases
        return phases[Math.min(this.state.phaseIndex, phases.length - 1)]
    },

    /**
     * The base class derives its bookkeeping box from a stimulus image's aspect ratio, and these
     * levels have no stimulus image. A 1:1 stand-in keeps that box square and finite; nothing is
     * drawn from it, because `drawStimulus` works off `stimulus.items` instead.
     */
    getStimulusAspectImage: function () {
        return { naturalWidth: 1, naturalHeight: 1 }
    },

    /** Jittered centre for one side's stimulus, as canvas fractions. */
    sampleItemCentre: function (side) {
        const p = this.params
        const jitter = (span) => (Math.random() * 2 - 1) * span
        return {
            cxFrac: 0.5 + (side === "left" ? -p.stimulusOffsetX : p.stimulusOffsetX) + jitter(p.stimulusJitterX),
            cyFrac: 0.5 + jitter(p.stimulusJitterY),
        }
    },

    /**
     * Hook (called by the base schedule): compose the pair for the trial that is starting.
     *
     * Everything random is drawn here, once. Three draws are independent — which side is truly
     * larger, the difficulty magnitude, and which side the illusion boosts (with its strength
     * magnitude) — which is what makes `TaskDifficulty` and `IllusionStrength` orthogonal in the
     * logged data (see the file header for both sign conventions).
     */
    placeStimulus: function () {
        const stim = this.state.stimulus
        const canvas = this.state.canvas
        const cfg = this.getPhaseConfig()

        // Log-uniform difficulty: equal sampling density per log-unit of difference.
        const [dMin, dMax] = cfg.difficultyRange
        const difficultyAbs = Math.exp(Math.log(dMin) + Math.random() * (Math.log(dMax) - Math.log(dMin)))
        const longerSide = Math.random() < 0.5 ? "left" : "right"

        const [sMin, sMax] = cfg.strengthRange
        const hasIllusion = sMax > 0
        const strengthAbs = hasIllusion ? sMin + Math.random() * (sMax - sMin) : 0
        const boostedSide = hasIllusion ? (Math.random() < 0.5 ? "left" : "right") : null

        stim.longerSide = longerSide
        stim.boostedSide = boostedSide
        stim.taskDifficulty = longerSide === "left" ? difficultyAbs : -difficultyAbs
        stim.illusionStrength = hasIllusion ? (boostedSide === longerSide ? -strengthAbs : strengthAbs) : 0
        stim.items = this.composeStimulusItems(cfg, { difficultyAbs, longerSide, strengthAbs, boostedSide })

        // The base class tracks one nominal box for exit/resize bookkeeping; centre it on the pair.
        stim.x = canvas.width / 2 - stim.width / 2
        stim.y = canvas.height / 2 - stim.height / 2
        stim.initialY = stim.y
    },

    /** Draws the pair via the level's `drawStimulusItem`; fades it out during the exit animation. */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return
        const ctx = this.state.ctx
        ctx.save()
        if (stim.exiting) {
            const progress = Math.min((this.state.frameTime - stim.exitStartTime) / stim.exitDuration, 1)
            ctx.globalAlpha = 1 - progress
        }
        // Geometry fractions are converted to pixels inside `drawStimulusItem` on every frame, so
        // a resize mid-trial moves and rescales the pair instead of leaving it at the old canvas's
        // pixel coordinates.
        stim.items.forEach((item) => this.drawStimulusItem(item))
        ctx.restore()
    },

    /** Hook (called by the base schedule): the response window closed with no press. */
    onResponseTimeout: function () {
        this.finishTrial({
            type: TrialTypes.TIMEOUT,
            points: 0,
            includeInMedian: false,
            timestamp: new Date().toISOString(),
        })
    },

    handleKeyDown: function (e) {
        if (this.state.gameState !== "playing") return

        // Dev/Test shortcut: 's' to skip the remainder of the level
        if (e.key === "s" || e.key === "S") {
            DoggoNogoCore.clearTrialSchedule(this.state)
            this.endLevel()
            return
        }

        // During breaks, only SPACE resumes (when ready)
        if (this.state.inBreak) {
            const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar"
            if (isSpace) this.resumeFromBreak()
            return
        }

        if (!this.isResponseKey(e.key)) return

        // Early press: before the stimulus, or before the frame carrying it reached the screen
        if ((!this.state.stimulus.visible || this.isAwaitingStimulusOnset()) && !this.state.stimulus.exiting) {
            // ...unless it is the late answer to the trial that just timed out (see core.js). In
            // these levels the comparison can outlast the 2 x median response window, so this is
            // the common case rather than a corner case.
            if (this.isBelatedResponse(e)) return
            this.cancelPendingStimulus()
            DoggoNogoCore.clearTrialSchedule(this.state)
            DoggoNogoCore.safePlay(this.assets.soundError)
            this.finishTrial({
                type: TrialTypes.EARLY,
                points: -this.params.minScore,
                includeInMedian: false,
                timestamp: new Date().toISOString(),
                thresholdUsed: this.getEffectiveThreshold(),
                responseKey: e.key,
            })
            this.state.flashUntil = this.state.frameTime + this.params.flashDuration
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.eventTime(e) - this.state.startTime
            this.state.responseDeadline = null
            DoggoNogoCore.startStimulusExit(this.state, () => this.state.frameTime, "catch")
            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT
            const correct =
                (e.key === "ArrowLeft" && this.state.stimulus.longerSide === "left") ||
                (e.key === "ArrowRight" && this.state.stimulus.longerSide === "right")

            if (!correct) {
                DoggoNogoCore.safePlay(this.assets.soundError)
                this.finishTrial({
                    type: TrialTypes.ERROR,
                    points: -this.params.minScore / 2,
                    includeInMedian: false,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    responseKey: e.key,
                    correct: false,
                })
                this.state.flashUntil = this.state.frameTime + this.params.flashDuration
                return
            }

            if (reactionTime > threshold) {
                DoggoNogoCore.safePlay(this.assets.soundSlow)
                this.finishTrial({
                    type: TrialTypes.SLOW,
                    points: this.params.minScore / 2,
                    rt: reactionTime,
                    includeInMedian: reactionTime <= trialMaxRT,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    responseKey: e.key,
                    correct: true,
                })
                return
            }

            const clampedRT = Math.min(reactionTime, trialMaxRT)
            const nRT = 1 - clampedRT / Math.max(1, trialMaxRT)
            const points = this.params.minScore + nRT * (this.params.maxScore - this.params.minScore)
            DoggoNogoCore.safePlay(this.assets.soundFast)
            this.jump(reactionTime)
            this.finishTrial({
                type: TrialTypes.FAST,
                points,
                rt: reactionTime,
                includeInMedian: true,
                timestamp: new Date().toISOString(),
                thresholdUsed: threshold,
                responseKey: e.key,
                correct: true,
            })
        }
    },

    /** Updates score, feedback, RT stats and the data log, then advances the phase/level. */
    finishTrial: function (outcome) {
        this.state.score += outcome.points
        if (typeof this.state.phaseFloorScore === "number") this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        DoggoNogoCore.showScoreDelta(this, outcome.points)
        this._handleTrialOutcomeFeedback(outcome)
        if (outcome.includeInMedian && typeof outcome.rt === "number" && outcome.correct !== false) {
            this.state.reactionTimes.push(outcome.rt)
            this.state.medianRT = this.computeMedian(this.state.reactionTimes)
        }
        this._logTrialData(outcome)
        this.state.lastTrialType = outcome.type
        this._checkForPhaseOrLevelEnd()
    },

    /** Shows feedback bubbles based on the trial outcome. */
    _handleTrialOutcomeFeedback: function (outcome) {
        const bubbleX = this.state.player.x + this.state.player.width / 2
        const bubbleY = this.state.player.y
        if (outcome.type === TrialTypes.FAST) {
            if (this.state.lastTrialType === TrialTypes.FAST) {
                this.state.lastFastFeedback = (this.state.lastFastFeedback % 3) + 1
            } else {
                this.state.lastFastFeedback = 1
            }
            this.showFeedbackBubble(`fast${this.state.lastFastFeedback}`, bubbleX, bubbleY)
            return
        }
        this.state.lastFastFeedback = 0
        const bubbleByType = {
            [TrialTypes.SLOW]: "slow",
            [TrialTypes.TIMEOUT]: "late",
            [TrialTypes.EARLY]: "early",
            [TrialTypes.ERROR]: "error",
        }
        const bubble = bubbleByType[outcome.type]
        if (bubble) this.showFeedbackBubble(bubble, bubbleX, bubbleY)
    },

    /** Logs the data record for the completed trial. */
    _logTrialData: function (outcome) {
        if (!outcome.timestamp) return
        const isError = outcome.type === TrialTypes.EARLY || outcome.type === TrialTypes.TIMEOUT || outcome.type === TrialTypes.ERROR
        // An early press beats the pair onto the screen, so no stimulus was ever seen: reporting
        // the geometry that was queued (or the previous trial's) would invent a presentation.
        const stim = outcome.type === TrialTypes.EARLY ? null : this.state.stimulus
        this.state.data.push({
            Level: `level ${this.levelNumber}`,
            Phase: this.state.phaseIndex + 1,
            TrialType: this.getTrialTypeLabel(outcome.type),
            Time: outcome.timestamp,
            Trial: this.state.trials,
            RT: isError || typeof outcome.rt !== "number" ? "NA" : outcome.rt,
            Error: isError ? 1 : 0,
            Threshold: typeof outcome.thresholdUsed === "number" ? outcome.thresholdUsed : this.getEffectiveThreshold(),
            ISI: this.getRealizedISI() ?? "NA",
            Score: this.state.score,
            ScoreChange: outcome.points,
            Illusion: this.illusion,
            // The two design parameters; both signed, see the file header.
            TaskDifficulty: stim ? round4(stim.taskDifficulty) : "NA",
            IllusionStrength: stim ? round4(stim.illusionStrength) : "NA",
            // Per-illusion geometry columns (the raw on-screen values).
            ...this.getStimulusLogFields(stim),
            ResponseKey: outcome.responseKey || "NA",
            Correct: typeof outcome.correct === "boolean" ? (outcome.correct ? 1 : 0) : "NA",
            CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
            CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
        })
    },
}

// The illusion base itself inherits the shared gameplay mechanics.
Object.setPrototypeOf(DoggoNogoIllusionLevel, DoggoNogoBaseLevel)
