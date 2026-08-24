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
 */

// Use shared trial type enum if available (guarded to avoid duplicate const redeclaration across levels)
if (typeof TrialTypes === "undefined") {
    var TrialTypes =
        typeof DoggoNogoTrialTypes !== "undefined"
            ? DoggoNogoTrialTypes
            : { FAST: "fast", SLOW: "slow", EARLY: "early", TIMEOUT: "timeout", ERROR: "error" }
} else if (typeof DoggoNogoTrialTypes !== "undefined") {
    TrialTypes = DoggoNogoTrialTypes
}

const level1 = {
    // Keys that start the level / count as responses (used by the engine and base input plumbing)
    startKeys: ["ArrowDown"],
    endOverlayTitle: "Game Over",

    params: {
        trialsNumber: 12, // The (theoretical) number of valid trials for the entire level
        minTrialsPerPhase: 4, // Minimum (theoretical) trials the player should effectively complete per phase
        minISI: 1000, // Minimum Inter-Stimulus Interval
        maxISI: 3000, // Maximum Inter-Stimulus Interval
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
        playerHeight: 0.2, // % of canvas height
        playerY: 0.5, // Vertical center position as proportion of canvas height
        stimulusHeight: 0.1, // % of canvas height
        feedbackBubbleHeight: 0.2, // % of canvas height
        flashDuration: 150, // ms duration of red flash for early presses
        flashTintColor: "255,0,0", // base RGB for tint (alpha animated)
    },

    assets: {
        imgPlayer: new Image(), // current sprite used for drawing
        imgPlayer1: new Image(), // phase 1 sprite
        imgPlayer2: new Image(), // phase 2 sprite
        imgPlayer3: new Image(), // phase 3 sprite
        imgStimulus: new Image(),
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
        // Cover screen assets (shared)
        imgCover: new Image(),
        imgCoverText: new Image(),
    },

    state: {
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
            exitInitialWidth: 0,
            exitInitialHeight: 0,
        },

        startTime: 0, // timestamp for reaction time calculation

        // Internal timers/handles
        pendingStimulusTimeoutId: null, // ISI -> stimulus visible timer
        currentTrialTimeoutId: null, // timeout for max RT

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
        phaseFloorScore: 0,

        canvas: null,
        ctx: null,

        // End overlay/button
        endOverlayVisible: false,
        endButtonRect: { x: 0, y: 0, w: 0, h: 0 },
        showContinueButton: false,
        continueLabel: "Continue",
    },

    /**
     * Loads all assets and resolves once ready, then computes initial dimensions/positions.
     */
    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level1/player_1.png"
        this.assets.imgPlayer2.src = base + "level1/player_2.png"
        this.assets.imgPlayer3.src = base + "level1/player_3.png"
        this.assets.imgStimulus.src = base + "level1/stimulus.png"
        this.assets.imgBackground.src = base + "level1/background.png"
        this.assets.imgFeedbackSlow.src = base + "level1/feedback_slow1.png"
        this.assets.imgFeedbackLate.src = base + "level1/feedback_late1.png"
        this.assets.imgFeedbackEarly.src = base + "level1/feedback_early1.png"
        this.assets.imgFeedbackFast1.src = base + "level1/feedback_fast1.png"
        this.assets.imgFeedbackFast2.src = base + "level1/feedback_fast2.png"
        this.assets.imgFeedbackFast3.src = base + "level1/feedback_fast3.png"
        this.assets.soundBackground.src = base + "level1/sound_background.mp3"
        this.assets.soundFast.src = base + "level1/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level1/sound_slow.mp3"
        this.assets.soundEarly.src = base + "level1/sound_early.mp3"
        this.assets.soundEvolve.src = base + "level1/sound_evolve.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3"
        this.assets.imgCover.src = base + "cover1_noText.png"
        this.assets.imgCoverText.src = base + "text.png"

        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgStimulus,
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
            this.assets.imgCoverText,
        ]
        const promises = assetRefs.map(
            (asset) =>
                new Promise((resolve, reject) => {
                    if (asset instanceof HTMLImageElement) {
                        asset.onload = resolve
                        asset.onerror = reject
                    } else if (asset instanceof HTMLAudioElement) {
                        asset.oncanplaythrough = resolve
                        asset.onerror = reject
                    }
                }),
        )

        return Promise.all(promises).then(() => {
            this.initializeDimensions(canvas)
            this.state.player.x = canvas.width / 2 - this.state.player.width / 2
            const centerY = canvas.height * (typeof this.params.playerY === "number" ? this.params.playerY : 0.5)
            this.state.player.y = centerY - this.state.player.height / 2
            this.state.player.originalY = this.state.player.y
        })
    },

    /**
     * Level-specific instructions screen.
     */
    showInstructionScreen: function (canvas) {
        const scaleFontPx = (b) => Math.round(b * ((canvas.width / this.REF_W + canvas.height / this.REF_H) / 2))
        const ctx = canvas.getContext("2d")
        const bg = this.assets.imgBackground
        if (bg && bg.complete) {
            ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
        ctx.fillStyle = "rgba(0,0,0,0.5)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.textAlign = "center"

        ctx.fillStyle = "white"
        ctx.font = `bold ${scaleFontPx(48)}px Arial`
        ctx.fillText("Instructions", canvas.width / 2, canvas.height * 0.2)

        ctx.font = `${scaleFontPx(28)}px Arial`
        const instructions = [
            "But Doggo is in need of urgent care and feeding!",
            "",
            "Help him get as many bones as possible by pressing",
            "the down arrow as fast as possible.",
        ]
        const lineHeight = scaleFontPx(40)
        const instructionStartY = canvas.height * 0.4
        instructions.forEach((line, i) => {
            ctx.fillText(line, canvas.width / 2, instructionStartY + i * lineHeight)
        })

        const stimulusImg = this.assets.imgStimulus
        if (stimulusImg && stimulusImg.complete) {
            const availableTop = instructionStartY + instructions.length * lineHeight + scaleFontPx(20)
            const availableBottom = canvas.height * 0.85 - scaleFontPx(40)
            const centerY = (availableTop + availableBottom) / 2
            const maxHeight = (availableBottom - availableTop) * 0.8
            const aspect = stimulusImg.naturalWidth / stimulusImg.naturalHeight
            const displayHeight = Math.min(maxHeight, canvas.height * 0.18)
            const displayWidth = displayHeight * aspect
            ctx.drawImage(stimulusImg, canvas.width / 2 - displayWidth / 2, centerY - displayHeight / 2, displayWidth, displayHeight)
        }

        setTimeout(() => {
            ctx.font = `bold ${scaleFontPx(32)}px Arial`
            ctx.fillStyle = "yellow"
            ctx.fillText("Press the DOWN arrow to start", canvas.width / 2, canvas.height * 0.85)
        }, 1000)
    },

    /**
     * Starts the level, initializes game state, and sets up event listeners.
     */
    start: function (canvas, endGameCallback, options) {
        this.state.canvas = canvas
        this.state.ctx = canvas.getContext("2d")
        this.endGameCallback = endGameCallback
        const opts = options || {}
        this.state.score = 0
        this.state.reactionTimes = []
        this.state.trials = 0
        if (Array.isArray(this.state.data)) this.state.data.length = 0
        else this.state.data = []
        this.state.gameState = "playing"
        this.state.phaseIndex = 0
        this.state.inBreak = false
        this.state.phaseRequiredScores = [0, 0, 0]
        this.state.showContinueButton = !!opts.showContinueButton
        this.state.continueLabel = typeof opts.continueLabel === "string" ? opts.continueLabel : "Continue"
        this.state.endOverlayVisible = false

        this.state.medianRT = 1000
        this.state.maxRT = 2 * this.state.medianRT

        this.state.phaseFloorScore = 0
        this.state.phaseRequiredScores[0] = this.computePhaseTarget(0)

        if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)

        try {
            this.assets.soundBackground.loop = true
            if (this.assets.soundBackground.paused) this.assets.soundBackground.play()
        } catch (e) {
            console.debug("Background music failed to start", e)
        }

        this.boundKeyDownHandler = this.handleKeyDown.bind(this)
        document.addEventListener("keydown", this.boundKeyDownHandler)
        this.boundClickHandler = this.handleClick.bind(this)
        canvas.addEventListener("click", this.boundClickHandler)

        if (typeof window !== "undefined") {
            window.level1Data = this.state.data
        }

        this.assets.imgPlayer = this.assets.imgPlayer1
        this.startNewTrial()
    },

    /**
     * Hook (called by base update): animate the stimulus falling during the "fast" window.
     */
    updateStimulusMotion: function () {
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const elapsedTime = this.now() - this.state.startTime
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
     * Draws a break overlay (tunnel vision + single-line prompt) prompting the player to continue.
     */
    drawBreakOverlay: function () {
        const ctx = this.state.ctx
        ctx.save()
        this.drawTunnelGradient()
        if (this.state.showBreakText) {
            ctx.fillStyle = "white"
            ctx.font = `${this.state.canvas.height * 0.053}px Arial`
            ctx.textAlign = "center"
            ctx.fillText("Press SPACE to continue", this.state.canvas.width / 2, (2.5 / 3) * this.state.canvas.height)
        }
        ctx.restore()
    },

    /**
     * Draws the stimulus if it's visible or animating (catch -> player, timeout -> sideways fade).
     */
    drawStimulus: function () {
        if (this.state.stimulus.exiting) {
            const elapsedTime = this.now() - this.state.stimulus.exitStartTime
            const progress = Math.min(elapsedTime / this.state.stimulus.exitDuration, 1)

            let currentX = this.state.stimulus.exitInitialX
            let currentY = this.state.stimulus.exitInitialY
            let currentWidth = this.state.stimulus.exitInitialWidth
            let currentHeight = this.state.stimulus.exitInitialHeight

            if (this.state.stimulus.exitType === "catch") {
                const playerCenterX = this.state.player.x + this.state.player.width / 2
                const playerCenterY = this.state.player.y + this.state.player.height / 2
                const targetX = playerCenterX - (this.state.stimulus.exitInitialWidth * (1 - progress)) / 2
                const targetY = playerCenterY - (this.state.stimulus.exitInitialHeight * (1 - progress)) / 2
                currentX = this.state.stimulus.exitInitialX + (targetX - this.state.stimulus.exitInitialX) * progress
                currentY = this.state.stimulus.exitInitialY + (targetY - this.state.stimulus.exitInitialY) * progress
                currentWidth = this.state.stimulus.exitInitialWidth * (1 - progress)
                currentHeight = this.state.stimulus.exitInitialHeight * (1 - progress)
            } else if (this.state.stimulus.exitType === "timeout") {
                const exitDistance = this.state.canvas.width / 2
                const direction = this.state.stimulus.exitInitialX > this.state.canvas.width / 2 ? 1 : -1
                currentX = this.state.stimulus.exitInitialX + direction * exitDistance * progress
                this.state.ctx.globalAlpha = 1 - progress
            }

            this.state.ctx.drawImage(this.assets.imgStimulus, currentX, currentY, currentWidth, currentHeight)
            this.state.ctx.globalAlpha = 1
        } else if (this.state.stimulus.visible) {
            this.state.ctx.drawImage(
                this.assets.imgStimulus,
                this.state.stimulus.x,
                this.state.stimulus.y,
                this.state.stimulus.width,
                this.state.stimulus.height,
            )
        }
    },

    /**
     * Starts a new trial by scheduling the next stimulus appearance.
     */
    startNewTrial: function () {
        const delay = Math.random() * (this.params.maxISI - this.params.minISI) + this.params.minISI
        if (this.state.pendingStimulusTimeoutId) {
            clearTimeout(this.state.pendingStimulusTimeoutId)
            this.state.pendingStimulusTimeoutId = null
        }
        this.state.pendingStimulusTimeoutId = setTimeout(() => {
            this.state.pendingStimulusTimeoutId = null
            this.state.stimulus.x = Math.random() * (this.state.canvas.width - this.state.stimulus.width)
            const maxY = this.state.canvas.height - this.state.stimulus.height - this.params.stimulusFallDistancePx
            this.state.stimulus.y = Math.random() * maxY
            this.state.stimulus.initialY = this.state.stimulus.y
            this.state.stimulus.visible = true
            this.state.stimulus.exiting = false
            this.state.startTime = this.now()
            if (typeof DoggoNogoEngine !== "undefined" && typeof DoggoNogoEngine.flashMarker === "function") {
                DoggoNogoEngine.flashMarker()
            }
            this.state.trials++

            this.state.maxRT = 2 * this.state.medianRT
            if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
            this.state.currentTrialTimeoutId = setTimeout(() => {
                this.state.currentTrialTimeoutId = null
                if (this.state.gameState !== "playing") return
                if (this.state.stimulus.visible && typeof DoggoNogoCore !== "undefined") {
                    DoggoNogoCore.startStimulusExit(this.state, () => this.now(), "timeout")
                }
                this.finishTrial({
                    type: "timeout",
                    points: 0,
                    includeInMedian: false,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    timestamp: new Date().toISOString(),
                })
            }, this.state.maxRT)
        }, delay)
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
        const play = typeof DoggoNogoCore !== "undefined" ? DoggoNogoCore.safePlay : this.safePlay

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
            this.state.flashUntil = this.now() + this.params.flashDuration
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
            StimulusX:
                this.state.canvas && this.state.canvas.width
                    ? ((typeof outcome.stimulusX === "number" ? outcome.stimulusX : this.state.stimulus.x) / this.state.canvas.width) * 100
                    : null,
            StimulusY:
                this.state.canvas && this.state.canvas.height
                    ? ((typeof outcome.stimulusY === "number" ? outcome.stimulusY : this.state.stimulus.y) / this.state.canvas.height) * 100
                    : null,
            CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
            CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
        })
    },

    /**
     * Returns the array of 3 phase targets. For phases not yet started, returns an estimate
     * based on remaining trials at the current moment.
     */
    getPhaseTargets: function () {
        const targets = [0, 0, 0]
        for (let i = 0; i < 3; i++) {
            if (this.state.phaseRequiredScores[i] && this.state.phaseRequiredScores[i] > 0) {
                targets[i] = this.state.phaseRequiredScores[i]
            } else {
                targets[i] = this.computePhaseTarget(i)
            }
        }
        return targets
    },

    /** Compute or return the target score for the current phase; computes and stores if missing. */
    ensurePhaseTarget: function () {
        if (!this.state.phaseRequiredScores[this.state.phaseIndex] || this.state.phaseRequiredScores[this.state.phaseIndex] <= 0) {
            this.state.phaseRequiredScores[this.state.phaseIndex] = this.computePhaseTarget(this.state.phaseIndex)
        }
        return this.state.phaseRequiredScores[this.state.phaseIndex]
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

    /** Manages the timed sequence of events during a phase break (evolve sprite + sparkles + prompt). */
    updateBreak: function () {
        const elapsed = this.now() - this.state.breakStartTime
        if (this.state.breakState === "started" && elapsed > 1000) {
            DoggoNogoCore.safePlay(this.assets.soundEvolve)
            const playerCenterX = this.state.player.x + this.state.player.width / 2
            const playerCenterY = this.state.player.y + this.state.player.height / 2
            this.createSparkles(playerCenterX, playerCenterY, 50)
            if (this.state.phaseIndex === 1) this.assets.imgPlayer = this.assets.imgPlayer2
            else if (this.state.phaseIndex === 2) this.assets.imgPlayer = this.assets.imgPlayer3
            this.state.breakState = "effects"
        }
        if (this.state.breakState === "effects" && elapsed > 2000) {
            this.state.showBreakText = true
            this.state.breakState = "ready"
        }
    },

    /** Creates a burst of golden sparkles at a location (evolution effect). */
    createSparkles: function (x, y, count) {
        DoggoNogoCore.createParticles(this, x, y, count, {
            speedMin: 2,
            speedMax: 7,
            sizeMin: 2,
            sizeMax: 6,
            lifeMin: 60,
            lifeMax: 140,
            colorFn: () => `hsl(${Math.random() * 60}, 100%, 85%)`,
        })
    },

    /**
     * Handles the keydown event for player input.
     */
    handleKeyDown: function (e) {
        if (this.state.gameState !== "playing") return

        // Dev/Test shortcut: 's' to skip the remainder of the level
        if (e.key === "s" || e.key === "S") {
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)
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

        // Early press before stimulus
        if (!this.state.stimulus.visible && !this.state.stimulus.exiting) {
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            this.finishTrial({ type: "early", points: -this.params.minScore, includeInMedian: false, timestamp: nowISO, thresholdUsed })
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.now() - this.state.startTime
            if (this.state.currentTrialTimeoutId) {
                clearTimeout(this.state.currentTrialTimeoutId)
                this.state.currentTrialTimeoutId = null
            }
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.startStimulusExit(this.state, () => this.now(), "catch")

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
