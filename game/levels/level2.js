/**
 * @file Level 2 — Gamified Simon task (directional variant).
 *
 * Shared gameplay mechanics live in `DoggoNogoBaseLevel` (game/core.js). This file defines only what
 * is specific to Level 2: its `params`/`assets`/`state`, asset loading, instructions, the
 * region/congruency stimulus logic, player mirroring, the fixed phase-target strategy, and the
 * directional (ArrowLeft/ArrowRight) response handling/scoring.
 *
 * Cognitive design:
 *   Phase 1 (index 0): CONGRUENT only (left/right position matches required direction).
 *   Phase 2 (index 1): CONGRUENT + NEUTRAL (vertical top/bottom spawns; no lateral position cue).
 *   Phase 3 (index 2): CONGRUENT + INCONGRUENT (left/right; some orientations conflict). No neutral.
 *   Conflict category per trial is logged as "congruent" | "neutral" | "incongruent".
 *
 * Configurable conflict proportions:
 *   params.neutralProportionPhase2 (default 0.5)   probability a Phase 2 trial is NEUTRAL.
 *   params.incongruentProportionPhase3 (default 0.5) probability a Phase 3 trial is INCONGRUENT.
 *
 * Scoring:
 *   Fast  (<= threshold)               : + minScore..maxScore (scaled by RT)
 *   Slow  (> threshold, before timeout): + minScore/2
 *   Error (wrong direction)            : - minScore/2
 *   Early (before stimulus visible)    : - minScore
 *   Timeout (no response)              : 0
 *   Only correct fast/slow trials update the adaptive median RT.
 *
 * Phase targets (simplified, fixed): perPhaseTrials = ceil(trialsNumber/3); each phase target =
 * perPhaseTrials * minScore (constant across all three phases).
 */

if (typeof TrialTypes === "undefined") {
    var TrialTypes =
        typeof DoggoNogoTrialTypes !== "undefined"
            ? DoggoNogoTrialTypes
            : { FAST: "fast", SLOW: "slow", EARLY: "early", TIMEOUT: "timeout", ERROR: "error" }
} else if (typeof DoggoNogoTrialTypes !== "undefined") {
    TrialTypes = DoggoNogoTrialTypes
}

const level2 = {
    startKeys: ["ArrowLeft", "ArrowRight"],

    params: {
        trialsNumber: 18,
        minTrialsPerPhase: 4,
        minISI: 1000,
        maxISI: 3000,
        minScore: 100,
        maxScore: 200,
        gameDifficulty: 1,
        populationMean: 300,
        populationSD: 20,
        gravity: 0.5,
        maxJumpStrength: -8,
        minJumpStrength: -1,
        stimulusFallDistance: 0.05,
        playerHeight: 0.4,
        playerY: 0.65,
        stimulusHeight: 0.1,
        flashDuration: 150, // ms duration of red flash for errors/early presses
        flashTintColor: "255,0,0", // base RGB; alpha animated
        feedbackBubbleHeight: 0.2, // % of canvas height for feedback bubbles
        // Spawn Y positions (fractions of canvas height) for vertical regions introduced in phase 2+
        stimulusLocationTopY: 0.45,
        stimulusLocationBottomY: 0.9,
        // Conflict proportion parameters (see header documentation)
        neutralProportionPhase2: 0.5,
        incongruentProportionPhase3: 0.5,
    },

    assets: {
        imgPlayer: new Image(),
        imgPlayer1: new Image(),
        imgPlayer2: new Image(),
        imgPlayer3: new Image(),
        // Generic stimulus variants (fishbones facing opposite directions)
        imgStimulus1: new Image(),
        imgStimulus2: new Image(),
        imgBackground: new Image(),
        soundEvolve: new Audio(),
        soundLevelUp: new Audio(),
        soundError: new Audio(),
        soundFast: new Audio(),
        soundSlow: new Audio(),
        soundBackground: new Audio(),
        soundStart: new Audio(),
        // Cover (reuse root-level assets)
        imgCover: new Image(),
        imgCoverText: new Image(),
        // Feedback images
        imgFeedbackSlow: new Image(),
        imgFeedbackLate: new Image(),
        imgFeedbackFast1: new Image(),
        imgFeedbackFast2: new Image(),
        imgFeedbackFast3: new Image(),
        imgFeedbackError: new Image(),
        imgFeedbackEarly: new Image(),
    },

    state: {
        gameState: "playing",
        score: 0,
        trials: 0,
        reactionTimes: [],
        particles: [],
        data: [],
        player: { x: 0, y: 0, width: 100, height: 100, velocityY: 0, jumping: false, originalY: 0 },
        playerFacing: "left", // 'left' | 'right' for sprite mirroring
        stimulus: {
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            visible: false,
            exiting: false,
            exitType: "catch",
            exitDuration: 200,
            exitStartTime: 0,
            exitInitialX: 0,
            exitInitialY: 0,
            initialY: 0,
            exitInitialWidth: 0,
            exitInitialHeight: 0,
            side: null, // 'left' | 'right'
            img: null,
            region: null, // spawn region: 'left','right','top','bottom'
            difficulty: null, // 'congruent' | 'neutral' | 'incongruent'
        },
        startTime: 0,
        pendingStimulusTimeoutId: null,
        currentTrialTimeoutId: null,
        medianRT: 1000,
        maxRT: 2000,
        scoreText: "",
        scoreTextVisible: false,
        scoreTextTimeout: null,
        scoreTextPoints: 0,
        phaseIndex: 0,
        inBreak: false,
        breakState: "idle",
        breakStartTime: 0,
        showBreakText: false,
        phaseRequiredScores: [0, 0, 0],
        phaseFloorScore: 0,
        canvas: null,
        ctx: null,
        endOverlayVisible: false,
        endButtonRect: { x: 0, y: 0, w: 0, h: 0 },
        showContinueButton: false,
        continueLabel: "Continue",
        flashUntil: 0, // timestamp until which the player sprite flashes (error/early feedback)
        tintedSpriteCache: {},
        feedbackBubbles: [],
        lastTrialType: null,
        lastFastFeedback: 0,
    },

    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level2/player_1.png"
        this.assets.imgPlayer2.src = base + "level2/player_2.png"
        this.assets.imgPlayer3.src = base + "level2/player_3.png"
        this.assets.imgStimulus1.src = base + "level2/stimulus_1.png"
        this.assets.imgStimulus2.src = base + "level2/stimulus_2.png"
        this.assets.imgBackground.src = base + "level2/background.png"
        this.assets.soundEvolve.src = base + "level2/sound_evolve.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3" // shared root-level sound
        this.assets.soundError.src = base + "level2/sound_error.mp3"
        this.assets.soundFast.src = base + "level2/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level2/sound_slow.mp3"
        this.assets.soundBackground.src = base + "level2/Fishbone.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.imgCover.src = base + "cover1_noText.png"
        this.assets.imgCoverText.src = base + "text.png"
        this.assets.imgFeedbackSlow.src = base + "level2/feedback_slow1.png"
        this.assets.imgFeedbackLate.src = base + "level2/feedback_late1.png"
        this.assets.imgFeedbackFast1.src = base + "level2/feedback_fast1.png"
        this.assets.imgFeedbackFast2.src = base + "level2/feedback_fast2.png"
        this.assets.imgFeedbackFast3.src = base + "level2/feedback_fast3.png"
        this.assets.imgFeedbackError.src = base + "level2/feedback_error1.png"
        this.assets.imgFeedbackEarly.src = base + "level2/feedback_early1.png"
        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgStimulus1,
            this.assets.imgStimulus2,
            this.assets.imgBackground,
            this.assets.imgCover,
            this.assets.imgCoverText,
            this.assets.imgFeedbackSlow,
            this.assets.imgFeedbackLate,
            this.assets.imgFeedbackFast1,
            this.assets.imgFeedbackFast2,
            this.assets.imgFeedbackFast3,
            this.assets.imgFeedbackError,
            this.assets.imgFeedbackEarly,
            this.assets.soundBackground,
            this.assets.soundError,
            this.assets.soundFast,
            this.assets.soundSlow,
            this.assets.soundEvolve,
            this.assets.soundLevelUp,
            this.assets.soundStart,
        ]
        return Promise.all(
            assetRefs.map(
                (asset) =>
                    new Promise((res, rej) => {
                        if (asset instanceof HTMLImageElement) {
                            asset.onload = res
                            asset.onerror = rej
                        } else if (asset instanceof HTMLAudioElement) {
                            const done = () => {
                                asset.oncanplaythrough = null
                                asset.onerror = null
                                res()
                            }
                            asset.oncanplaythrough = done
                            asset.onerror = (e) => rej(e)
                            // Some browsers may not fire canplaythrough for very short files; fallback check
                            setTimeout(() => {
                                if (!asset.readyState || asset.readyState < 3) return // HAVE_FUTURE_DATA
                                done()
                            }, 2000)
                        } else res()
                    }),
            ),
        ).then(() => {
            this.initializeDimensions(canvas)
            this.state.player.x = canvas.width / 2 - this.state.player.width / 2
            const centerY = canvas.height * (typeof this.params.playerY === "number" ? this.params.playerY : 0.5)
            this.state.player.y = centerY - this.state.player.height / 2
            this.state.player.originalY = this.state.player.y
        })
    },

    showInstructionScreen: function (canvas) {
        const scaleFontPx = (b) => Math.round(b * ((canvas.width / this.REF_W + canvas.height / this.REF_H) / 2))
        const ctx = canvas.getContext("2d")
        const bg = this.assets.imgBackground
        if (bg && bg.complete) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)
        else ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = "rgba(0,0,0,0.55)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.textAlign = "center"
        ctx.fillStyle = "white"
        ctx.font = `bold ${scaleFontPx(50)}px Arial`
        ctx.fillText("Level 2", canvas.width / 2, canvas.height * 0.18)
        ctx.font = `${scaleFontPx(30)}px Arial`
        const introLines = [
            "NOGO is on the lookout for fish leftovers.",
            "Help him catch the fish bones as fast as possible,",
            "but be careful about the direction!",
        ]
        const lh = scaleFontPx(38)
        const startY = canvas.height * 0.3
        introLines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, startY + i * lh))

        // Draw both stimulus variants left and right with direction cues
        const stimLeft = this.state.leftStimulusImg || this.assets.imgStimulus1
        const stimRight = this.state.rightStimulusImg || this.assets.imgStimulus2 || this.assets.imgStimulus1
        const stimH = Math.min(canvas.height * 0.18, stimLeft.naturalHeight || 100)
        const stimAspectL = (stimLeft.naturalWidth || 100) / (stimLeft.naturalHeight || 100)
        const stimAspectR = (stimRight.naturalWidth || 100) / (stimRight.naturalHeight || 100)
        const stimWLeft = stimH * stimAspectL
        const stimWRight = stimH * stimAspectR
        const midY = canvas.height * 0.58
        const leftXCenter = canvas.width * 0.25
        const rightXCenter = canvas.width * 0.75
        ctx.drawImage(stimLeft, leftXCenter - stimWLeft / 2, midY - stimH / 2, stimWLeft, stimH)
        ctx.save()
        ctx.translate(rightXCenter + stimWRight / 2, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(stimRight, 0, midY - stimH / 2, stimWRight, stimH)
        ctx.restore()

        ctx.font = `${scaleFontPx(26)}px Arial`
        ctx.fillStyle = "#FFD54F"
        ctx.fillText("Press LEFT for left-pointing fishbone", leftXCenter, midY + stimH * 0.7)
        ctx.fillText("Press RIGHT for right-pointing fishbone", rightXCenter, midY + stimH * 0.7)

        setTimeout(() => {
            ctx.font = `bold ${scaleFontPx(34)}px Arial`
            ctx.fillStyle = "#FFEE58"
            ctx.fillText("Press LEFT or RIGHT to start", canvas.width / 2, canvas.height * 0.88)
        }, 800)
    },

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
        // Simplified phase target logic: divide the theoretical total trials equally across 3 phases.
        const perPhaseTrials = Math.ceil(this.params.trialsNumber / 3)
        const targetPerPhase = perPhaseTrials * this.params.minScore
        this.state.phaseRequiredScores = [targetPerPhase, targetPerPhase, targetPerPhase]
        this.state.showContinueButton = !!opts.showContinueButton
        this.state.continueLabel = typeof opts.continueLabel === "string" ? opts.continueLabel : "Continue"
        this.state.endOverlayVisible = false
        this.state.medianRT = 1000
        this.state.maxRT = 2000
        this.state.phaseFloorScore = 0
        if (this.state.pendingStimulusTimeoutId) clearTimeout(this.state.pendingStimulusTimeoutId)
        if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
        this.boundKeyDownHandler = this.handleKeyDown.bind(this)
        document.addEventListener("keydown", this.boundKeyDownHandler)
        this.boundClickHandler = this.handleClick.bind(this)
        canvas.addEventListener("click", this.boundClickHandler)
        if (typeof window !== "undefined") {
            window.level2Data = this.state.data
        }
        this.assets.imgPlayer = this.assets.imgPlayer1
        // Decide which stimulus variant goes on which side ONCE per level start (counter-balancing)
        if (Math.random() < 0.5) {
            this.state.leftStimulusImg = this.assets.imgStimulus1
            this.state.rightStimulusImg = this.assets.imgStimulus2
        } else {
            this.state.leftStimulusImg = this.assets.imgStimulus2
            this.state.rightStimulusImg = this.assets.imgStimulus1
        }
        try {
            this.assets.soundBackground.loop = true
            if (this.assets.soundBackground.paused) this.assets.soundBackground.play()
        } catch (e) {
            console.debug("Background music failed to start", e)
        }
        this.startNewTrial()
    },

    /** Text lines for the phase-break overlay (phase-specific instructions). */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            // Entering Phase 2: introduce vertical / neutral trials
            return [
                "The bone can now also appear above or below!",
                "Respond according to its DIRECTION (left/right).",
                "",
                "Press SPACE to continue",
            ]
        } else if (this.state.phaseIndex === 2) {
            // Entering Phase 3: introduce incongruent horizontal trials
            return ["Don't forget to respond according to the DIRECTION of the bone (left/right).", "", "Press SPACE to continue"]
        }
        return ["Press SPACE to continue"]
    },

    /** Draws the stimulus (with horizontal mirroring for right-facing variants and exit animations). */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return
        const img = stim.img || this.assets.imgStimulus1
        const drawOne = (x, y, w, h, side, alpha = 1) => {
            const ctx = this.state.ctx
            ctx.save()
            ctx.globalAlpha = alpha
            if (side === "right") {
                ctx.translate(x + w, 0)
                ctx.scale(-1, 1)
                ctx.drawImage(img, 0, y, w, h)
            } else ctx.drawImage(img, x, y, w, h)
            ctx.restore()
        }
        if (stim.exiting) {
            const elapsed = this.now() - stim.exitStartTime
            const prog = Math.min(elapsed / stim.exitDuration, 1)
            let x = stim.exitInitialX
            let y = stim.exitInitialY
            let w = stim.exitInitialWidth
            let h = stim.exitInitialHeight
            let alpha = 1
            if (stim.exitType === "catch") {
                const pcx = this.state.player.x + this.state.player.width / 2
                const pcy = this.state.player.y + this.state.player.height / 2
                const targetX = pcx - (stim.exitInitialWidth * (1 - prog)) / 2
                const targetY = pcy - (stim.exitInitialHeight * (1 - prog)) / 2
                x = x + (targetX - x) * prog
                y = y + (targetY - y) * prog
                w = w * (1 - prog)
                h = h * (1 - prog)
            } else if (stim.exitType === "timeout") {
                const dist = this.state.canvas.width / 2
                const dir = stim.exitInitialX > this.state.canvas.width / 2 ? 1 : -1
                x = stim.exitInitialX + dir * dist * prog
                alpha = 1 - prog
            }
            drawOne(x, y, w, h, stim.side, alpha)
        } else if (stim.visible) {
            drawOne(stim.x, stim.y, stim.width, stim.height, stim.side, 1)
        }
    },

    startNewTrial: function () {
        const delay = Math.random() * (this.params.maxISI - this.params.minISI) + this.params.minISI
        if (this.state.pendingStimulusTimeoutId) clearTimeout(this.state.pendingStimulusTimeoutId)
        this.state.pendingStimulusTimeoutId = setTimeout(() => {
            this.state.pendingStimulusTimeoutId = null
            const stim = this.state.stimulus
            let region, side, difficulty
            if (this.state.phaseIndex === 0) {
                // Phase 1: only congruent horizontal trials
                region = Math.random() < 0.5 ? "left" : "right"
                side = region
                difficulty = "congruent"
            } else if (this.state.phaseIndex === 1) {
                // Phase 2: mixture of congruent horizontal and neutral vertical trials
                const pNeutral = Math.min(1, Math.max(0, this.params.neutralProportionPhase2 || 0))
                const isNeutral = Math.random() < pNeutral
                if (isNeutral) {
                    region = Math.random() < 0.5 ? "top" : "bottom"
                    side = Math.random() < 0.5 ? "left" : "right" // orientation independent of vertical location
                    difficulty = "neutral"
                } else {
                    region = Math.random() < 0.5 ? "left" : "right"
                    side = region
                    difficulty = "congruent"
                }
            } else {
                // Phase 3: mixture of congruent & incongruent horizontal (no neutral)
                const pIncong = Math.min(1, Math.max(0, this.params.incongruentProportionPhase3 || 0))
                region = Math.random() < 0.5 ? "left" : "right"
                const isIncong = Math.random() < pIncong
                if (isIncong) {
                    side = region === "left" ? "right" : "left" // opposite = incongruent
                    difficulty = "incongruent"
                } else {
                    side = region
                    difficulty = "congruent"
                }
            }
            stim.region = region
            stim.side = side
            stim.difficulty = difficulty
            stim.img = side === "left" ? this.state.leftStimulusImg : this.state.rightStimulusImg
            // Compute position based on region
            let centerX = this.state.canvas.width * 0.5
            let centerY = this.state.canvas.height * 0.5
            if (region === "left") centerX = this.state.canvas.width * 0.25
            else if (region === "right") centerX = this.state.canvas.width * 0.75
            else if (region === "top") centerY = this.state.canvas.height * (this.params.stimulusLocationTopY || 0.25)
            else if (region === "bottom") centerY = this.state.canvas.height * (this.params.stimulusLocationBottomY || 0.75)
            stim.y = centerY - stim.height / 2
            stim.initialY = stim.y
            stim.x = centerX - stim.width / 2
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
                    type: TrialTypes.TIMEOUT,
                    points: 0,
                    includeInMedian: false,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    stimulusRegion: this.state.stimulus.region,
                    timestamp: new Date().toISOString(),
                })
            }, this.state.maxRT)
        }, delay)
    },

    finishTrial: function (outcome) {
        this.state.score += outcome.points
        if (typeof this.state.phaseFloorScore === "number") this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        DoggoNogoCore.showScoreDelta(this, outcome.points)
        this._handleTrialOutcomeFeedback(outcome)
        // Only update median with correct (non-error) fast/slow responses
        if (outcome.includeInMedian && typeof outcome.rt === "number" && (outcome.correct === undefined || outcome.correct === true)) {
            this.state.reactionTimes.push(outcome.rt)
            this.state.medianRT = this.computeMedian(this.state.reactionTimes)
        }
        if (outcome.timestamp) {
            const rtVal = outcome.type === "early" || outcome.type === "timeout" || outcome.type === "error" ? null : outcome.rt
            this.state.data.push({
                Level: "level 2",
                Phase: this.state.phaseIndex + 1,
                TrialType: this.getTrialTypeLabel(outcome.type),
                Time: outcome.timestamp,
                Trial: this.state.trials,
                RT: rtVal === null ? "NA" : rtVal,
                Error: outcome.type === "early" || outcome.type === "timeout" || outcome.type === "error" ? 1 : 0,
                Threshold: typeof outcome.thresholdUsed === "number" ? outcome.thresholdUsed : this.getEffectiveThreshold(),
                Score: this.state.score,
                ScoreChange: outcome.points,
                StimulusSide: this.state.stimulus.side,
                StimulusRegion: this.state.stimulus.region,
                Difficulty: this.state.stimulus.difficulty || "NA",
                ResponseKey: outcome.responseKey || "NA",
                Correct: typeof outcome.correct === "boolean" ? (outcome.correct ? 1 : 0) : "NA",
                StimulusX:
                    this.state.canvas && this.state.canvas.width
                        ? ((typeof outcome.stimulusX === "number" ? outcome.stimulusX : this.state.stimulus.x) / this.state.canvas.width) *
                          100
                        : null,
                StimulusY:
                    this.state.canvas && this.state.canvas.height
                        ? ((typeof outcome.stimulusY === "number" ? outcome.stimulusY : this.state.stimulus.y) / this.state.canvas.height) *
                          100
                        : null,
                CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
                CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
            })
        }
        this._checkForPhaseOrLevelEnd()
    },

    _handleTrialOutcomeFeedback: function (outcome) {
        const bubbleX = this.state.player.x + this.state.player.width / 2
        const bubbleY = this.state.player.y
        if (outcome.type === TrialTypes.SLOW) {
            this.showFeedbackBubble("slow", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.TIMEOUT) {
            this.showFeedbackBubble("late", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.EARLY) {
            this.showFeedbackBubble("early", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.ERROR) {
            this.showFeedbackBubble("error", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.FAST) {
            if (this.state.lastTrialType === TrialTypes.FAST) {
                this.state.lastFastFeedback = (this.state.lastFastFeedback % 3) + 1
            } else {
                this.state.lastFastFeedback = 1
            }
            this.showFeedbackBubble(`fast${this.state.lastFastFeedback}`, bubbleX, bubbleY)
        }
        this.state.lastTrialType = outcome.type
    },

    /** Fixed per-phase target = ceil(trialsNumber/3) * minScore. */
    computePhaseTarget: function () {
        const perPhaseTrials = Math.ceil(this.params.trialsNumber / 3)
        return perPhaseTrials * this.params.minScore
    },

    getPhaseTargets: function () {
        return this.state.phaseRequiredScores.slice()
    },

    ensurePhaseTarget: function () {
        return this.state.phaseRequiredScores[this.state.phaseIndex]
    },

    /** Phase break: swap to next sprite, red sparkles, evolve sound, then show prompt. */
    updateBreak: function () {
        const elapsed = this.now() - this.state.breakStartTime
        if (this.state.breakState === "started" && elapsed > 1000) {
            if (this.state.phaseIndex === 1) this.assets.imgPlayer = this.assets.imgPlayer2
            else if (this.state.phaseIndex === 2) this.assets.imgPlayer = this.assets.imgPlayer3
            const cx = this.state.player.x + this.state.player.width / 2
            const cy = this.state.player.y + this.state.player.height / 2
            this.createRedSparkles(cx, cy, 40)
            DoggoNogoCore.safePlay(this.assets.soundEvolve)
            this.state.breakState = "effects"
        }
        if (this.state.breakState === "effects" && elapsed > 2000) {
            this.state.showBreakText = true
            this.state.breakState = "ready"
        }
    },

    createRedSparkles: function (x, y, count) {
        DoggoNogoCore.createParticles(this, x, y, count, {
            speedMin: 1,
            speedMax: 5,
            sizeMin: 2,
            sizeMax: 5,
            lifeMin: 40,
            lifeMax: 90,
            colorFn: () => `hsl(${Math.random() * 20}, 100%, ${60 + Math.random() * 20}%)`,
        })
    },

    handleKeyDown: function (e) {
        if (this.state.gameState !== "playing") return
        // Dev/Test shortcut: 's' to skip level immediately
        if (e.key === "s" || e.key === "S") {
            if (this.state.pendingStimulusTimeoutId) clearTimeout(this.state.pendingStimulusTimeoutId)
            if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
            this.endLevel()
            return
        }
        if (this.state.inBreak) {
            const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar"
            if (isSpace) this.resumeFromBreak()
            return
        }
        if (!this.isResponseKey(e.key)) return

        // Early press before stimulus
        if (!this.state.stimulus.visible && !this.state.stimulus.exiting) {
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            DoggoNogoCore.safePlay(this.assets.soundError)
            this.finishTrial({
                type: TrialTypes.EARLY,
                points: -this.params.minScore,
                includeInMedian: false,
                timestamp: nowISO,
                thresholdUsed,
            })
            this.state.flashUntil = this.now() + this.params.flashDuration
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.now() - this.state.startTime
            if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.startStimulusExit(this.state, () => this.now(), "catch")
            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT
            const correct =
                (e.key === "ArrowLeft" && this.state.stimulus.side === "left") ||
                (e.key === "ArrowRight" && this.state.stimulus.side === "right")
            if (!correct) {
                // Error penalty: -minScore/2
                DoggoNogoCore.safePlay(this.assets.soundError)
                if (this.state.stimulus.exiting) this.state.stimulus.exitType = "timeout" // sideways drift
                this.finishTrial({
                    type: TrialTypes.ERROR,
                    points: -this.params.minScore / 2,
                    includeInMedian: false,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    responseKey: e.key,
                    correct: false,
                })
                this.state.flashUntil = this.now() + this.params.flashDuration
                return
            }
            // Correct: update facing based on stimulus side (fast or slow)
            this.state.playerFacing = this.state.stimulus.side === "right" ? "right" : "left"
            if (reactionTime > threshold) {
                const include = reactionTime <= trialMaxRT
                DoggoNogoCore.safePlay(this.assets.soundSlow)
                this.finishTrial({
                    type: TrialTypes.SLOW,
                    points: this.params.minScore / 2, // slow correct award: +minScore/2
                    rt: reactionTime,
                    includeInMedian: include,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    responseKey: e.key,
                    correct: true,
                })
                return
            }
            const clampedRT = Math.min(reactionTime, trialMaxRT)
            const nRT = 1 - clampedRT / Math.max(1, trialMaxRT)
            const points = this.params.minScore + nRT * (this.params.maxScore - this.params.minScore)
            this.jump(reactionTime)
            DoggoNogoCore.safePlay(this.assets.soundFast)
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
}

// Inherit shared gameplay mechanics from the base level.
Object.setPrototypeOf(level2, DoggoNogoBaseLevel)

// Make accessible globally in browser context
if (typeof window !== "undefined") {
    window.level2 = level2
}
