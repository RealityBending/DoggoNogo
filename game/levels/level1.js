/**
 * @file Level 1 — Gamified Simple Reaction Time (SRT) task.
 *
 * Shared gameplay mechanics (physics, rendering scaffolding, phase progression, scoring helpers)
 * live in `DoggoNogoBaseLevel` (game/core.js). This file defines only what is specific to Level 1:
 * its `params`/`assets`/`state`, asset loading, instructions, the falling-stimulus animation, the
 * adaptive phase-target strategy, and the single-key (ArrowDown) response handling/scoring.
 *
 * Trial lifecycle:
 * 1) After a random ISI a stimulus appears at a random position and timing starts.
 * 2) Player presses ArrowDown:
 *    - before the stimulus appears  -> early    -> penalty (-minScore)
 *    - visible and RT > Threshold    -> slow     -> +0
 *    - visible and RT <= Threshold   -> fast     -> positive points
 * 3) Valid RTs update Threshold (running median) and feed the end-of-level score.
 * 4) No press before maxRT (2 x Threshold) -> timeout (0 points).
 * 5) Level ends when the final phase's target score is reached.
 *
 * Fast-trial scoring: nRT = 1 - clamp(RT,0,maxRT)/maxRT; Score = minScore + nRT*(maxScore-minScore).
 *
 * Adaptive phase targets: at each phase start, distribute the remaining theoretical valid trials
 * across remaining phases (assuming ~50% fast worth >= minScore), with a per-phase floor of
 * max(minScore, (minTrialsPerPhase/2)*minScore). This gently steers the session toward `trialsNumber`.
 *
 * Data log: every keypress pushes a record to `level1.state.data` (also `window.level1Data`).
 *
 * The bone is drawn procedurally (see game/stimuli.js) rather than blitted from a PNG. The old
 * sprite filled 20% of its nominal bounding box and carried a baked-in ~40 degree rotation, so
 * `stimulusHeight` and the logged `StimulusX`/`StimulusY` described a box that was mostly empty air
 * rather than the stimulus. Worse, a cream bone dropped at a random position over painted artwork
 * met local background luminance anywhere from 0.01 to 0.79 -- Michelson contrast from 0.95 down to
 * 0.22, polarity reversing on the bright patches -- and detection latency follows contrast, so that
 * variation went straight into the RT. Drawing in code fixes both: the geometry is declared rather
 * than inferred, and the layered red/dark outline puts the same luminance and hue immediately around
 * the bone on every trial, whatever is behind it.
 *
 * Orientation is redrawn every trial, uniform over [0, 180) degrees -- the bone is symmetric under a
 * half turn, so that covers every distinct appearance without over-sampling any. The box the base
 * class tracks is therefore a *square envelope* wide enough to hold the bone at any angle, not a
 * tight bounding box: a tight box would shrink and grow with the angle, which would make the range
 * of legal positions depend on the orientation and so correlate the two. With a square envelope,
 * position and orientation are sampled independently. The stimulus itself is recovered from the data
 * exactly, from `StimulusX`/`StimulusY` (its centre), `StimulusAngle`, `StimulusLength` and
 * `StimulusThickness` -- not from the envelope.
 */

import { DoggoNogoBaseLevel } from "../core.js"
import { DoggoNogoCore, DoggoNogoUI, DoggoNogoTrialTypes as TrialTypes } from "../game.js"
import { DoggoNogoStimuli } from "../stimuli.js"

export const level1 = {
    // Keys that start the level / count as responses (used by the engine and base input plumbing)
    startKeys: ["ArrowDown"],
    endOverlayTitle: "Game Over",

    params: {
        trialsNumber: 12, // The (theoretical) number of valid trials for the entire level
        minTrialsPerPhase: 4, // Minimum (theoretical) trials the player should effectively complete per phase
        minISI: 500, // Floor (ms)
        maxISI: 3500, // Ceiling (ms)
        meanISIDecay: 1000, // Scale parameter (ms) for the pseudoexponential ISI distribution
        minScore: 100, // Minimum score awarded for a fast trial
        maxScore: 200, // Maximum score awarded for a fast trial
        gameDifficulty: 1, // dimensionless; effective threshold = medianRT / gameDifficulty

        // IES population parameters (for Z-scoring)
        populationMean: 300,
        populationSD: 20,

        // Physics properties for the jump
        gravity: 0.5,
        maxJumpStrength: -8, // Jump strength for a 0ms RT
        minJumpStrength: -1, // Jump strength for the slowest RT

        // Animations and size
        stimulusFallDistance: 0.05, // % of canvas height
        // The sprite box is square and Doggo fills only its lower half in phase 1 (the evolved
        // sprites grow upward into the rest), so the box is sized for the phase-3 sprite and seated
        // low enough that the paws stand on the lawn rather than floating at mid-sky.
        playerHeight: 0.3, // % of canvas height
        playerY: 0.63, // Vertical center position as proportion of canvas height
        // Contact shadow: the sheet leaves ~3.5% of the box empty under the paws, so the shadow is
        // raised by that much to sit under them instead of a little below.
        jumpShadow: { yOffset: -0.045 },
        feedbackBubbleHeight: 0.2, // % of canvas height

        // --- Stimulus geometry, as fractions of canvas *height* so the bone is the same physical
        // shape on any display. These two are the source of truth; `stimulusHeight` (the square
        // envelope the base class uses for placement) is derived from them in `load`.
        stimulusLength: 0.182, // tip-to-tip extent
        stimulusThickness: 0.0275, // shaft width; the lobed ends make the bone 2x this tall
        stimulusHeight: 0, // derived in `load()` -- do not set by hand
        boneFill: "#fdf3dc",
        // Outermost first, widths as fractions of the full bone height. The red ring is the salience
        // cue; the thin dark ring inside it separates red from fill so the bone reads as a bone
        // rather than a red blob. Together they hold the edge's luminance and hue constant, which is
        // what makes detection latency independent of the background patch the bone landed on.
        boneOutlines: [
            { color: "#e63946", width: 0.13 },
            { color: "#140d10", width: 0.05 },
        ],
        flashDuration: 150, // ms duration of red flash for early presses
        flashTintColor: "255,0,0", // base RGB for tint (alpha animated)

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

    assets: {
        imgPlayer: new Image(), // current sprite used for drawing
        imgPlayer1: new Image(), // phase 1 sprite
        imgPlayer2: new Image(), // phase 2 sprite
        imgPlayer3: new Image(), // phase 3 sprite
        imgBackground: new Image(),
        imgFeedbackSlow: new Image(),
        imgFeedbackLate: new Image(),
        imgFeedbackEarly: new Image(),
        imgFeedbackFast1: new Image(),
        imgFeedbackFast2: new Image(),
        imgFeedbackFast3: new Image(),
        soundBackground: new Audio(),
        soundFast: new Audio(),
        soundEvolve: new Audio(),
        soundLevelUp: new Audio(),
        soundSlow: new Audio(),
        soundEarly: new Audio(),
        soundStart: new Audio(),
        // Cover screen art (shared); the title itself is drawn in code by the engine.
        imgCover: new Image(),
    },

    // Mutable runtime data. Replaced by a fresh object on every `start()`.
    state: null,

    /** Builds a clean runtime state, so a re-run of the level never inherits stale data. */
    getInitialState: function () {
        return {
            gameState: "playing", // "playing" | "done"
            score: 0,
            trials: 0, // number of presented stimuli (slow/fast/timeout; excludes early presses)
            reactionTimes: [],
            particles: [],
            feedbackBubbles: [],
            lastTrialType: null,
            lastFastFeedback: 0, // 0 = no streak, 1 = fast1, 2 = fast2, 3 = fast3
            flashUntil: 0, // timestamp until which the player sprite flashes (early/error feedback)
            tintedSpriteCache: {}, // cache of tinted offscreen canvases keyed by baseSrc|color

            // Per-keypress data log. Exposed as window.level1Data.
            data: [],

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
                initialY: 0, // initial Y for the fall animation
                angle: 0, // radians; redrawn every trial in placeStimulus
                exitInitialWidth: 0,
                exitInitialHeight: 0,
            },

            // Trial timing, all in the level clock (see core.js)
            frameTime: 0, // timestamp of the frame being processed
            clockOffset: 0, // performance clock -> level clock
            startTime: 0, // stimulus onset, stamped from the frame that presented it
            stimulusScheduledTime: 0, // when the current trial's ISI started
            stimulusDueTime: null, // frame time at which the stimulus should appear
            responseDeadline: null, // frame time at which the response window closes
            responseWindowClosedAt: null, // frame time of the last timeout (see isBelatedResponse)
            onsetPending: false, // drawn, but not yet presented

            medianRT: 1000, // ms; running median of valid RTs, starts at 1000
            maxRT: 2000, // ms; max RT for a trial, derived from medianRT

            // Score feedback text
            scoreText: "",
            scoreTextVisible: false,
            scoreTextTimeout: null,
            scoreTextPoints: 0,

            // Phase progression state (3 phases with 2 breaks)
            phaseIndex: 0,
            inBreak: false,
            breakState: "idle", // "idle" | "started" | "effects" | "ready"
            breakStartTime: 0,
            showBreakText: false,
            phaseRequiredScores: [0, 0, 0],
            phaseTargetsCache: null, // memoized getPhaseTargets() result (see core.js)
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
     * Loads all assets and resolves once ready, then computes initial dimensions/positions.
     */
    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level1/player_1.webp"
        this.assets.imgPlayer2.src = base + "level1/player_2.webp"
        this.assets.imgPlayer3.src = base + "level1/player_3.webp"
        this.assets.imgBackground.src = base + "level1/background.webp"
        this.assets.imgFeedbackSlow.src = base + "level1/feedback_slow1.webp"
        this.assets.imgFeedbackLate.src = base + "level1/feedback_late1.webp"
        this.assets.imgFeedbackEarly.src = base + "level1/feedback_early1.webp"
        this.assets.imgFeedbackFast1.src = base + "level1/feedback_fast1.webp"
        this.assets.imgFeedbackFast2.src = base + "level1/feedback_fast2.webp"
        this.assets.imgFeedbackFast3.src = base + "level1/feedback_fast3.webp"
        this.assets.soundBackground.src = base + "level1/sound_background.mp3"
        this.assets.soundFast.src = base + "level1/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level1/sound_slow.mp3"
        this.assets.soundEarly.src = base + "level1/sound_early.mp3"
        this.assets.soundEvolve.src = base + "level1/sound_evolve.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3"
        this.assets.imgCover.src = base + "cover.webp"

        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgBackground,
            this.assets.imgFeedbackSlow,
            this.assets.imgFeedbackLate,
            this.assets.imgFeedbackEarly,
            this.assets.imgFeedbackFast1,
            this.assets.imgFeedbackFast2,
            this.assets.imgFeedbackFast3,
            this.assets.soundBackground,
            this.assets.soundFast,
            this.assets.soundEvolve,
            this.assets.soundLevelUp,
            this.assets.soundSlow,
            this.assets.soundEarly,
            this.assets.soundStart,
            this.assets.imgCover,
        ]
        return DoggoNogoCore.loadAssets(assetRefs, options && options.onProgress).then(() => {
            this.params.stimulusHeight = this.getBoneEnvelopeFraction()
            this.initializeDimensions(canvas)
            this.placePlayer(canvas)
        })
    },

    /**
     * Level-specific instructions screen (animated; the loop is cancelled by `beginLevel`).
     */
    showInstructionScreen: function (canvas) {
        const { fx } = DoggoNogoUI
        this.runInstructionScreen(canvas, {
            badge: "LEVEL 1",
            title: "Doggo is hungry!",
            lines: [
                "Doggo is in urgent need of care and feeding.",
                "When a bone appears, grab it as fast as you can.",
                "Careful - pressing before it appears will startle Doggo!",
            ],
            promptSegments: [{ t: "Press" }, { k: "▼" }, { t: "to start" }],
            drawVisual: (ctx, layout, elapsed) => {
                // The same bone the trials use, bobbing, with a warm glow, next to the key that
                // catches it. Drawn from `params` rather than from a sprite, so the shape the player
                // is shown here cannot drift away from the shape they will actually see.
                const cy = layout.cy
                const bob = Math.sin(elapsed / 550) * layout.h * 0.008
                // Shown larger than in-game, and turning slowly: orientation varies from trial to
                // trial and is irrelevant to the response, which is easier to show than to say.
                const envelopePx = Math.min((layout.bottom - layout.top) * 0.62, layout.h * 0.19)
                const geom = this.getBoneGeometry(envelopePx)
                ctx.save()
                const glowRadius = geom.length * 0.7
                const glow = ctx.createRadialGradient(layout.w / 2, cy, 0, layout.w / 2, cy, glowRadius)
                glow.addColorStop(0, "rgba(255, 220, 150, 0.22)")
                glow.addColorStop(1, "rgba(255, 220, 150, 0)")
                ctx.fillStyle = glow
                ctx.fillRect(layout.w / 2 - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2)
                DoggoNogoStimuli.drawBone(ctx, {
                    centerX: layout.w / 2,
                    centerY: cy + bob,
                    length: geom.length,
                    thickness: geom.thickness,
                    angle: (elapsed / 4200) * Math.PI,
                    fill: this.params.boneFill,
                    outlines: geom.outlines,
                })
                ctx.restore()
                // Key mapping hint, clear of the bone at every angle (hence the envelope, not the length)
                fx.drawKeycap(ctx, layout.w / 2 - envelopePx / 2 - layout.h * 0.05, cy, layout.h * 0.05, "▼")
            },
        })
    },

    /**
     * Starts the level, initializes game state, and sets up event listeners.
     */
    start: function (canvas, endGameCallback, options) {
        this.beginLevel(canvas, endGameCallback, options)
        this.state.maxRT = 2 * this.state.medianRT
        this.setPhaseTarget(0, this.computePhaseTarget(0))

        DoggoNogoCore.startBackgroundMusic(this.assets.soundBackground)

        window.level1Data = this.state.data

        this.assets.imgPlayer = this.assets.imgPlayer1
        this.startNewTrial()
    },

    /**
     * Side of the square placement envelope, as a fraction of canvas height: big enough to hold the
     * bone at any orientation, outlines included. `boneEnvelope` accounts for the off-axis lobes,
     * which reach further than the bone's own length once it is turned a few degrees.
     */
    getBoneEnvelopeFraction: function () {
        const p = this.params
        const outlines = p.boneOutlines.map((o) => ({ color: o.color, width: 2 * p.stimulusThickness * o.width }))
        return DoggoNogoStimuli.boneEnvelope(p.stimulusLength, p.stimulusThickness, outlines)
    },

    /** The placement envelope is square, so the bone fits at any angle. See the file header. */
    getStimulusAspectImage: function () {
        return { naturalWidth: 1, naturalHeight: 1 }
    },

    /**
     * Converts the current envelope size in px into the arguments `drawBone` needs.
     *
     * `boxHeight` is passed rather than read from state because the catch animation shrinks the
     * envelope, and the bone has to shrink with it; the ratio to the full envelope is the scale.
     */
    getBoneGeometry: function (boxHeight) {
        const canvasHeight = (this.state.canvas && this.state.canvas.height) || 1
        const envelopePx = canvasHeight * this.params.stimulusHeight
        const scale = envelopePx > 0 ? boxHeight / envelopePx : 1
        const thickness = canvasHeight * this.params.stimulusThickness * scale
        const length = canvasHeight * this.params.stimulusLength * scale
        const outlines = this.params.boneOutlines.map((o) => ({ color: o.color, width: 2 * thickness * o.width }))
        return { length, thickness, outlines }
    },

    /**
     * Hook (called by base update): animate the stimulus falling during the "fast" window.
     */
    updateStimulusMotion: function () {
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const elapsedTime = this.state.frameTime - this.state.startTime
            const threshold = this.getEffectiveThreshold()
            if (elapsedTime < threshold) {
                const fallProgress = elapsedTime / threshold
                this.state.stimulus.y = this.state.stimulus.initialY + this.params.stimulusFallDistancePx * fallProgress
            } else {
                this.state.stimulus.y = this.state.stimulus.initialY + this.params.stimulusFallDistancePx
            }
        }
    },

    /**
     * Draws the bone if it's visible or animating (catch -> shrinks into the player, timeout ->
     * drifts sideways and fades).
     *
     * The bone is redrawn from the box every frame instead of being scaled as a finished image, so
     * the outline weights stay proportional to the shape through the whole catch animation.
     */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return

        let x = stim.x
        let y = stim.y
        let width = stim.width
        let height = stim.height
        let alpha = 1

        if (stim.exiting) {
            const progress = Math.min((this.now() - stim.exitStartTime) / stim.exitDuration, 1)
            x = stim.exitInitialX
            y = stim.exitInitialY
            width = stim.exitInitialWidth
            height = stim.exitInitialHeight
            if (stim.exitType === "catch") {
                const playerCenterX = this.state.player.x + this.state.player.width / 2
                const playerCenterY = this.state.player.y + this.state.player.height / 2
                const targetX = playerCenterX - (width * (1 - progress)) / 2
                const targetY = playerCenterY - (height * (1 - progress)) / 2
                x += (targetX - x) * progress
                y += (targetY - y) * progress
                width *= 1 - progress
                height *= 1 - progress
            } else if (stim.exitType === "timeout") {
                const direction = x > this.state.canvas.width / 2 ? 1 : -1
                x += direction * (this.state.canvas.width / 2) * progress
                alpha = 1 - progress
            }
        }
        if (width <= 0 || height <= 0) return

        const geom = this.getBoneGeometry(height)
        const ctx = this.state.ctx
        ctx.save()
        ctx.globalAlpha = alpha
        DoggoNogoStimuli.drawBone(ctx, {
            centerX: x + width / 2,
            centerY: y + height / 2,
            length: geom.length,
            thickness: geom.thickness,
            angle: stim.angle,
            fill: this.params.boneFill,
            outlines: geom.outlines,
        })
        ctx.restore()
    },

    /** Hook (called by the base schedule): drop the bone at a random position and orientation. */
    placeStimulus: function () {
        this.state.stimulus.x = Math.random() * (this.state.canvas.width - this.state.stimulus.width)
        const maxY = this.state.canvas.height - this.state.stimulus.height - this.params.stimulusFallDistancePx
        this.state.stimulus.y = Math.random() * maxY
        this.state.stimulus.initialY = this.state.stimulus.y
        // Uniform over a half turn: the bone maps onto itself under a 180 degree rotation, so
        // [0, 180) enumerates every distinct appearance exactly once.
        this.state.stimulus.angle = Math.random() * Math.PI
    },

    /** Hook (called by the base schedule): the response window closed with no press. */
    onResponseTimeout: function () {
        this.finishTrial({
            type: "timeout",
            points: 0,
            includeInMedian: false,
            stimulusX: this.state.stimulus.x,
            stimulusY: this.state.stimulus.y,
            timestamp: new Date().toISOString(),
        })
    },

    /**
     * Finishes a trial: updates score, counters, checks end, or schedules next trial.
     */
    finishTrial: function (outcome) {
        this.state.score += outcome.points
        if (typeof this.state.phaseFloorScore === "number") {
            this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        }
        this.showScoreDelta(outcome.points)
        this._handleTrialOutcomeFeedback(outcome)
        this._updateReactionTimeStats(outcome)
        this._logTrialData(outcome)
        this.state.lastTrialType = outcome.type
        this._checkForPhaseOrLevelEnd()
    },

    /** Shows feedback bubbles and plays sounds based on the trial outcome. */
    _handleTrialOutcomeFeedback: function (outcome) {
        const bubbleX = this.state.player.x + this.state.player.width / 2
        const bubbleY = this.state.player.y
        const play = DoggoNogoCore.safePlay

        if (outcome.type === TrialTypes.SLOW) {
            play(this.assets.soundSlow)
            this.showFeedbackBubble("slow", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.TIMEOUT) {
            this.showFeedbackBubble("late", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.EARLY) {
            play(this.assets.soundEarly)
            this.showFeedbackBubble("early", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
            this.state.flashUntil = this.state.frameTime + this.params.flashDuration
        } else if (outcome.type === TrialTypes.FAST) {
            if (this.state.lastTrialType === TrialTypes.FAST) {
                this.state.lastFastFeedback = (this.state.lastFastFeedback % 3) + 1
            } else {
                this.state.lastFastFeedback = 1
            }
            this.showFeedbackBubble(`fast${this.state.lastFastFeedback}`, bubbleX, bubbleY)
        }
    },

    /** Updates the running reaction time median if the trial is valid. */
    _updateReactionTimeStats: function (outcome) {
        if (outcome.includeInMedian && typeof outcome.rt === "number") {
            this.state.reactionTimes.push(outcome.rt)
            this.state.medianRT = this.computeMedian(this.state.reactionTimes)
        }
    },

    /** Logs the data record for the completed trial. */
    _logTrialData: function (outcome) {
        if (!outcome.timestamp) return
        const rtVal = outcome.type === TrialTypes.EARLY || outcome.type === TrialTypes.TIMEOUT ? null : outcome.rt
        this.state.data.push({
            Level: "level 1",
            Phase: this.state.phaseIndex + 1,
            TrialType: this.getTrialTypeLabel(outcome.type),
            Time: outcome.timestamp,
            Trial: this.state.trials,
            RT: rtVal === null ? "NA" : rtVal,
            Error: outcome.type === TrialTypes.EARLY || outcome.type === TrialTypes.TIMEOUT ? 1 : 0,
            Threshold: typeof outcome.thresholdUsed === "number" ? outcome.thresholdUsed : this.getEffectiveThreshold(),
            ISI: this.getRealizedISI() ?? "NA",
            Score: this.state.score,
            ScoreChange: outcome.points,
            ResponseKey: outcome.responseKey || (outcome.type === TrialTypes.TIMEOUT ? "NA" : "ArrowDown"),
            Correct:
                typeof outcome.correct === "boolean"
                    ? outcome.correct
                        ? 1
                        : 0
                    : outcome.type === TrialTypes.FAST || outcome.type === TrialTypes.SLOW
                      ? 1
                      : 0,
            // Centre of the bone, as a percentage of the canvas. The envelope's top-left corner
            // (what this used to log) is not a property of the stimulus, only of the bookkeeping box.
            StimulusX:
                this.state.canvas && this.state.canvas.width
                    ? (((typeof outcome.stimulusX === "number" ? outcome.stimulusX : this.state.stimulus.x) +
                          this.state.stimulus.width / 2) /
                          this.state.canvas.width) *
                      100
                    : null,
            StimulusY:
                this.state.canvas && this.state.canvas.height
                    ? (((typeof outcome.stimulusY === "number" ? outcome.stimulusY : this.state.stimulus.y) +
                          this.state.stimulus.height / 2) /
                          this.state.canvas.height) *
                      100
                    : null,
            // Orientation in degrees, 0 = lying along the horizontal, increasing clockwise on
            // screen (canvas y points down); the range is [0, 180) by the bone's half-turn symmetry.
            StimulusAngle: Math.round(((this.state.stimulus.angle * 180) / Math.PI) * 10) / 10,
            // Intrinsic size, as fractions of canvas height. Constant within a run, logged so the
            // stimulus can be reconstructed from the data file without reading the source.
            StimulusLength: this.params.stimulusLength,
            StimulusThickness: this.params.stimulusThickness,
            CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
            CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
        })
    },

    /**
     * Compute the required score for a given phase index based on remaining trials and an assumed
     * 50% fast-rate. Enforces a minimum per-phase target = max(minScore, (minTrialsPerPhase/2)*minScore).
     */
    computePhaseTarget: function (phaseIdx) {
        const phasesRemaining = Math.max(1, 3 - phaseIdx)
        const trialsLeft = Math.max(0, this.params.trialsNumber - this.state.trials)
        const trialsThisPhase = Math.ceil(trialsLeft / phasesRemaining)
        const expectedFast = Math.floor(trialsThisPhase * 0.5)
        const estimatedTarget = expectedFast * this.params.minScore
        const minTargetByTrials = (this.params.minTrialsPerPhase / 2) * this.params.minScore
        return Math.max(this.params.minScore, minTargetByTrials, estimatedTarget)
    },

    /**
     * Handles the keydown event for player input.
     */
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

        if (e.key !== "ArrowDown") return

        // Early press: before the stimulus, or before the frame carrying it reached the screen
        if ((!this.state.stimulus.visible || this.isAwaitingStimulusOnset()) && !this.state.stimulus.exiting) {
            // ...unless it is the late answer to the trial that just timed out (see core.js).
            if (this.isBelatedResponse(e)) return
            this.cancelPendingStimulus()
            DoggoNogoCore.clearTrialSchedule(this.state)
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            this.finishTrial({ type: "early", points: -this.params.minScore, includeInMedian: false, timestamp: nowISO, thresholdUsed })
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.eventTime(e) - this.state.startTime
            this.state.responseDeadline = null
            DoggoNogoCore.startStimulusExit(this.state, () => this.state.frameTime, "catch")

            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT

            if (reactionTime > threshold) {
                // Slow trial
                const include = reactionTime <= trialMaxRT
                this.finishTrial({
                    type: TrialTypes.SLOW,
                    points: 0,
                    rt: reactionTime,
                    includeInMedian: include,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    responseKey: "ArrowDown",
                    correct: true,
                })
                return
            }

            // Fast trial
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
                responseKey: "ArrowDown",
                correct: true,
            })
        }
    },

    /** Shows a transient score-delta feedback message (e.g. "+150"). */
    showScoreDelta: function (points) {
        const sign = points > 0 ? "+" : "" // negatives already include '-'
        this.state.scoreTextPoints = points
        this.showScoreFeedback(`${sign}${Math.round(points)}`)
    },

    /** Fallback audio play (base/DoggoNogoCore.safePlay is preferred when available). */
    safePlay: function (audioEl, reset = true) {
        if (!audioEl) return
        try {
            if (reset) audioEl.currentTime = 0
            audioEl.play()
        } catch (e) {
            console.debug("safePlay failed", e)
        }
    },
}

// Inherit shared gameplay mechanics from the base level.
Object.setPrototypeOf(level1, DoggoNogoBaseLevel)
level1.state = level1.getInitialState()
