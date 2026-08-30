/**
 * @file Level 3 — Length discrimination (perceptual two-alternative forced choice).
 *
 * Two bones appear either side of Doggo and the player names the longer one with the matching
 * arrow key (ArrowLeft / ArrowRight). Unlike Levels 1 and 2, the answer is not given by *where* the
 * stimulus is but by a perceptual comparison, so accuracy is the primary measure and RT is
 * secondary.
 *
 * The bones are drawn procedurally (see game/stimuli.js) rather than blitted from a PNG, because
 * length is the manipulated variable: a scaled sprite would deform its end lobes and a stretched
 * middle slice would smear the artwork's texture, and either one hands the player a cue that is not
 * length. Drawing in code keeps thickness, lobe size and outline weight fixed while length varies.
 *
 * Three controls guard the measurement, all applied per trial in `placeStimulus`:
 *
 *  - Roving standard: the base length is re-drawn every trial, so "how long a bone should be"
 *    cannot be learned and carried across trials — only the within-trial comparison survives.
 *  - Independent centre jitter: without it the two bones' near ends sit at almost the same place,
 *    and endpoint alignment is judged far more precisely than length, so the player would be doing
 *    a vernier task instead of this one.
 *  - One shared orientation per trial (plus a small independent jitter): rotation is what stops
 *    screen-axis strategies, but orientation *differences* within a pair would import the
 *    horizontal-vertical illusion, which is about as large as the length differences being tested.
 *
 * Difficulty adapts by a 2-down/1-up staircase on the length difference (see `_updateDifficulty`),
 * which converges near 71% correct. Set `params.deltaStepFactor` to 1 to pin the difference instead.
 *
 * Everything else (physics, phase progression, progress bar, feedback bubbles, data plumbing) comes
 * from `DoggoNogoBaseLevel` (game/core.js). Sprites and sounds are borrowed from Level 1 — no
 * `assets/level3/` folder exists yet, and the stimulus needs no asset at all.
 *
 * Scoring (same shape as Level 2):
 *   Fast  (<= threshold)               : + minScore..maxScore (scaled by RT)
 *   Slow  (> threshold, before timeout): + minScore/2
 *   Error (named the shorter bone)     : - minScore/2
 *   Early (before stimulus visible)    : - minScore
 *   Timeout (no response)              : 0
 *   Only correct fast/slow trials update the adaptive median RT.
 *
 * Phase targets are fixed: perPhaseTrials = ceil(trialsNumber/3); each phase target =
 * perPhaseTrials * minScore.
 */

import { DoggoNogoBaseLevel } from "../core.js"
import { DoggoNogoCore, DoggoNogoTrialTypes as TrialTypes } from "../game.js"
import { DoggoNogoStimuli } from "../stimuli.js"

/**
 * Lengths are logged as fractions of canvas height, not pixels: the same fraction means the same
 * stimulus on any display, and `CanvasHeight` in the same row recovers the pixel size.
 */
const round4 = (v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : "NA")
const angleDeg = (item) => (item ? Math.round(((item.angle * 180) / Math.PI) * 10) / 10 : "NA")

export const level3 = {
    startKeys: ["ArrowLeft", "ArrowRight"],
    endOverlayTitle: "Level Complete",

    params: {
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
        stimulusFallDistance: 0, // static stimulus (no falling animation in this level)
        playerHeight: 0.2, // % of canvas height
        playerY: 0.5, // vertical centre of the canvas
        stimulusHeight: 0.1, // % of canvas height; only sizes the base class's bookkeeping box
        stimulusOffsetX: 0.25, // horizontal distance from centre, as a fraction of canvas width

        // --- Stimulus geometry. Lengths and thicknesses are fractions of canvas *height* so the
        // pair scales as one shape; only the left/right offsets are keyed to canvas width.
        stimulusLength: 0.34, // base tip-to-tip length of a bone
        stimulusThickness: 0.035, // shaft width (the lobed ends are ~2x this)
        stimulusLengthJitter: 0.15, // roving standard: base length varies +-15% per trial
        stimulusJitterX: 0.06, // centre jitter (fraction of canvas width), breaks endpoint alignment
        stimulusJitterY: 0.08, // centre jitter (fraction of canvas height)
        stimulusAngleJitter: 8, // degrees, independent per bone around the shared trial orientation
        boneFill: "#f0dfb4",
        boneOutline: "#20191a",
        boneOutlineWidth: 0.006, // fraction of canvas height

        // --- Difficulty: 2-down/1-up staircase on the proportional length difference.
        deltaStart: 0.25, // the longer bone starts 25% longer than the shorter one
        deltaMin: 0.02,
        deltaMax: 0.5,
        deltaStepFactor: 1.25, // divide after two correct, multiply after an error; 1 = fixed

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
    },

    // All borrowed from Level 1 for now. There is no stimulus image: the bones are drawn in code.
    assets: {
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
        // Cover screen assets (shared)
        imgCover: new Image(),
        imgCoverText: new Image(),
    },

    // Mutable runtime data. Replaced by a fresh object on every `start()`.
    state: null,

    /** Builds a clean runtime state, so a re-run of the level never inherits stale data. */
    getInitialState: function () {
        return {
            gameState: "playing", // "playing" | "done"
            score: 0,
            trials: 0,
            reactionTimes: [],
            particles: [],
            feedbackBubbles: [],
            data: [], // per-keypress data log; exposed as window.level3Data
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
                // at draw time, so a resize mid-trial rescales the bones instead of stranding them.
                items: [], // [{ side, cxFrac, cyFrac, lengthFrac, angle }]
                baseLengthFrac: 0, // the shorter bone's length this trial
                delta: 0, // proportional difference actually presented
                trialAngle: 0, // orientation shared by both bones (radians)
                longerSide: null, // "left" | "right" — the correct answer
            },

            // Staircase state
            delta: 0,
            consecutiveCorrect: 0,

            // Trial timing, all in the level clock (see core.js)
            frameTime: 0,
            clockOffset: 0,
            startTime: 0,
            stimulusScheduledTime: 0,
            stimulusDueTime: null,
            responseDeadline: null,
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

    /** Loads (Level 1) assets and resolves once ready, then computes dimensions/positions. */
    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level1/player_1.png"
        this.assets.imgPlayer2.src = base + "level1/player_2.png"
        this.assets.imgPlayer3.src = base + "level1/player_3.png"
        this.assets.imgFeedbackSlow.src = base + "level1/feedback_slow1.png"
        this.assets.imgFeedbackLate.src = base + "level1/feedback_late1.png"
        this.assets.imgFeedbackEarly.src = base + "level1/feedback_early1.png"
        this.assets.imgFeedbackError.src = base + "level1/feedback_early1.png" // placeholder: no level-3 error art yet
        this.assets.imgFeedbackFast1.src = base + "level1/feedback_fast1.png"
        this.assets.imgFeedbackFast2.src = base + "level1/feedback_fast2.png"
        this.assets.imgFeedbackFast3.src = base + "level1/feedback_fast3.png"
        this.assets.soundFast.src = base + "level1/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level1/sound_slow.mp3"
        this.assets.soundError.src = base + "level1/sound_early.mp3"
        this.assets.soundEvolve.src = base + "level1/sound_evolve.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3"
        this.assets.imgCover.src = base + "cover1_noText.png"
        this.assets.imgCoverText.src = base + "text.png"

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
            this.assets.imgCoverText,
        ]
        return DoggoNogoCore.loadAssets(assetRefs, options && options.onProgress).then(() => {
            this.initializeDimensions(canvas)
            this.placePlayer(canvas)
        })
    },

    /** Plain grey backdrop (this level has no background image). */
    drawBackground: function () {
        const ctx = this.state.ctx
        ctx.fillStyle = this.params.backgroundColor
        ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    showInstructionScreen: function (canvas) {
        const scaleFontPx = (b) => Math.round(b * ((canvas.width / this.REF_W + canvas.height / this.REF_H) / 2))
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = this.params.backgroundColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.textAlign = "center"

        ctx.fillStyle = "white"
        ctx.font = `bold ${scaleFontPx(50)}px Arial`
        ctx.fillText("Level 3", canvas.width / 2, canvas.height * 0.2)

        ctx.font = `${scaleFontPx(30)}px Arial`
        const lines = ["Two bones appear either side of Doggo.", "Press the arrow key pointing at the LONGER one."]
        const lineHeight = scaleFontPx(40)
        const startY = canvas.height * 0.35
        lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight))

        // Example pair, drawn with the same code path as the task itself so the demonstration
        // cannot drift away from what the player is about to see. The gap is exaggerated here.
        const midY = canvas.height * 0.62
        const demo = [
            { x: 0.3, len: 0.2, angle: -0.25 },
            { x: 0.7, len: 0.3, angle: 0.18 },
        ]
        demo.forEach((d) => {
            DoggoNogoStimuli.drawBone(ctx, {
                centerX: canvas.width * d.x,
                centerY: midY,
                length: canvas.height * d.len,
                thickness: canvas.height * this.params.stimulusThickness,
                angle: d.angle,
                fill: this.params.boneFill,
                outline: this.params.boneOutline,
                outlineWidth: canvas.height * this.params.boneOutlineWidth,
            })
        })
        ctx.font = `${scaleFontPx(26)}px Arial`
        ctx.fillStyle = "#FFD54F"
        ctx.fillText("LEFT", canvas.width * 0.3, midY + canvas.height * 0.14)
        ctx.fillText("RIGHT", canvas.width * 0.7, midY + canvas.height * 0.14)

        // Held on the level so `beginLevel` can cancel it (see Level 1).
        this.instructionHintTimeout = setTimeout(() => {
            this.instructionHintTimeout = null
            ctx.font = `bold ${scaleFontPx(34)}px Arial`
            ctx.fillStyle = "#FFEE58"
            ctx.fillText("Press LEFT or RIGHT to start", canvas.width / 2, canvas.height * 0.85)
        }, 800)
    },

    start: function (canvas, endGameCallback, options) {
        this.beginLevel(canvas, endGameCallback, options)
        this.state.maxRT = 2 * this.state.medianRT
        const targetPerPhase = this.computePhaseTarget()
        this.setPhaseTargets([targetPerPhase, targetPerPhase, targetPerPhase])
        window.level3Data = this.state.data
        this.assets.imgPlayer = this.assets.imgPlayer1
        this.state.delta = this.params.deltaStart
        this.state.consecutiveCorrect = 0
        this.startNewTrial()
    },

    /** Fixed per-phase target = ceil(trialsNumber/3) * minScore. */
    computePhaseTarget: function () {
        const perPhaseTrials = Math.ceil(this.params.trialsNumber / 3)
        return perPhaseTrials * this.params.minScore
    },

    /**
     * The base class derives its bookkeeping box from a stimulus image's aspect ratio, and this
     * level has no stimulus image. A 1:1 stand-in keeps that box square and finite; nothing is
     * drawn from it, because `drawStimulus` works off `stimulus.items` instead.
     */
    getStimulusAspectImage: function () {
        return { naturalWidth: 1, naturalHeight: 1 }
    },

    /**
     * Hook (called by the base schedule): compose the pair for the trial that is starting.
     *
     * Everything random is drawn here, once, and stored as canvas fractions: the trial is fully
     * described by `stimulus.items` plus the summary fields the data log reads.
     */
    placeStimulus: function () {
        const stim = this.state.stimulus
        const canvas = this.state.canvas
        const p = this.params
        const jitter = (span) => (Math.random() * 2 - 1) * span

        const baseLength = p.stimulusLength * (1 + jitter(p.stimulusLengthJitter))
        const delta = this.state.delta
        const trialAngle = Math.random() * Math.PI
        const angleJitter = (p.stimulusAngleJitter * Math.PI) / 180
        stim.longerSide = Math.random() < 0.5 ? "left" : "right"

        stim.items = ["left", "right"].map((side) => ({
            side,
            cxFrac: 0.5 + (side === "left" ? -p.stimulusOffsetX : p.stimulusOffsetX) + jitter(p.stimulusJitterX),
            cyFrac: 0.5 + jitter(p.stimulusJitterY),
            lengthFrac: baseLength * (side === stim.longerSide ? 1 + delta : 1),
            angle: trialAngle + jitter(angleJitter),
        }))
        stim.baseLengthFrac = baseLength
        stim.delta = delta
        stim.trialAngle = trialAngle

        // The base class tracks one nominal box for exit/resize bookkeeping; centre it on the pair.
        stim.x = canvas.width / 2 - stim.width / 2
        stim.y = canvas.height / 2 - stim.height / 2
        stim.initialY = stim.y
    },

    /** Draws both bones; fades the pair out together during the exit animation. */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        ctx.save()
        if (stim.exiting) {
            const progress = Math.min((this.state.frameTime - stim.exitStartTime) / stim.exitDuration, 1)
            ctx.globalAlpha = 1 - progress
        }
        // Fractions are converted here rather than at placement, so a resize mid-trial moves and
        // rescales the pair instead of leaving it at the old canvas's pixel coordinates.
        stim.items.forEach((item) => {
            DoggoNogoStimuli.drawBone(ctx, {
                centerX: canvas.width * item.cxFrac,
                centerY: canvas.height * item.cyFrac,
                length: canvas.height * item.lengthFrac,
                thickness: canvas.height * this.params.stimulusThickness,
                angle: item.angle,
                fill: this.params.boneFill,
                outline: this.params.boneOutline,
                outlineWidth: canvas.height * this.params.boneOutlineWidth,
            })
        })
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
        this._updateDifficulty(outcome)
        this._logTrialData(outcome)
        this.state.lastTrialType = outcome.type
        this._checkForPhaseOrLevelEnd()
    },

    /**
     * 2-down/1-up staircase on the length difference: two correct answers in a row make the next
     * pair more similar, one wrong answer makes it more different. That rule converges on ~71%
     * correct, which keeps the task at the edge of what the player can actually see.
     *
     * Only answered trials move it. A timeout or an early press says nothing about whether the
     * difference was visible, so letting them push the staircase would inflate the threshold.
     */
    _updateDifficulty: function (outcome) {
        if (typeof outcome.correct !== "boolean") return
        const p = this.params
        if (outcome.correct) {
            this.state.consecutiveCorrect += 1
            if (this.state.consecutiveCorrect < 2) return
            this.state.consecutiveCorrect = 0
            this.state.delta = Math.max(p.deltaMin, this.state.delta / p.deltaStepFactor)
        } else {
            this.state.consecutiveCorrect = 0
            this.state.delta = Math.min(p.deltaMax, this.state.delta * p.deltaStepFactor)
        }
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
            Level: "level 3",
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
            LongerSide: (stim && stim.longerSide) || "NA",
            Delta: stim ? round4(stim.delta) : "NA",
            LengthShort: stim ? round4(stim.baseLengthFrac) : "NA",
            LengthLong: stim ? round4(stim.baseLengthFrac * (1 + stim.delta)) : "NA",
            AngleLeft: stim ? angleDeg(stim.items[0]) : "NA",
            AngleRight: stim ? angleDeg(stim.items[1]) : "NA",
            ResponseKey: outcome.responseKey || "NA",
            Correct: typeof outcome.correct === "boolean" ? (outcome.correct ? 1 : 0) : "NA",
            CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
            CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
        })
    },
}

// Inherit shared gameplay mechanics from the base level.
Object.setPrototypeOf(level3, DoggoNogoBaseLevel)
level3.state = level3.getInitialState()
