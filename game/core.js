/**
 * @file Shared base logic for all DoggoNogo levels.
 *
 * `DoggoNogoBaseLevel` holds the gameplay mechanics that are identical across cognitive-control
 * tasks (player physics, rendering scaffolding, phase progression, scoring helpers, input plumbing).
 * Concrete levels (`level1`, `level2`, and future tasks such as Stop-signal / Go-NoGo / Stroop) are
 * plain objects that define their own `params`, `assets`, and `state`, then set this object as their
 * prototype via `Object.setPrototypeOf(levelX, DoggoNogoBaseLevel)`. Own methods on a level shadow the
 * base, so each level only needs to override what is genuinely different (stimulus placement,
 * congruency logic, scoring, instructions, data fields).
 *
 * A level may carry `this.jsPsych` (set by the engine when embedded) so `now()` can share the
 * host experiment's clock; standalone runs fall back to `performance.now()`.
 *
 * Conventions assumed by the base:
 *  - `this.state` carries: canvas, ctx, player, stimulus, particles, feedbackBubbles, score,
 *    phaseIndex, phaseFloorScore, phaseRequiredScores, medianRT, maxRT, flashUntil, ...
 *  - `this.params` carries: gravity, min/maxJumpStrength, playerHeight, playerY, stimulusHeight,
 *    stimulusFallDistance, flashDuration, flashTintColor, minScore, maxScore, gameDifficulty,
 *    breakSparkles, ...
 *  - The aspect-defining stimulus image is `this.assets.imgStimulus` or `this.assets.imgStimulus1`.
 *
 * Trial timing is frame-driven: `startNewTrial()` only records when the next stimulus is due, and
 * `updateTrialSchedule()` (called from `update()` with the requestAnimationFrame timestamp) reveals
 * it on a frame boundary, stamps `state.startTime` with the frame that actually presents it, and
 * closes the response window. Nothing about a trial is scheduled with `setTimeout`.
 *
 * Required per level (the base has no default for any of these):
 *  - `getInitialState()`       factory returning a fresh `state`; `beginLevel()` calls it on every start
 *  - `computePhaseTarget(i)`   per-phase target score; `getPhaseTargets()` / `ensurePhaseTarget()`
 *                              build on it and rarely need overriding
 *  - `placeStimulus()`         position/choose the stimulus for the trial that is starting
 *  - `onResponseTimeout()`     no response arrived before `state.responseDeadline`
 *
 * Override hooks (safe to redefine per level):
 *  - `updateStimulusMotion()`  per-frame stimulus animation (default: none)
 *  - `getBreakOverlayLines()`  text lines shown on the phase-break overlay
 *  - `getStimulusAspectImage()` image used to derive stimulus aspect ratio
 *  - `playBreakEffects()`      phase-break evolution beat (default: sprite swap + `params.breakSparkles`
 *                              burst + `assets.soundEvolve`)
 *  - `endOverlayTitle` (string) title shown on the in-game end overlay
 *  - `startKeys` (string[]) / `isResponseKey(key)` which keys start / count as responses
 */

import { DoggoNogoCore } from "./game.js"

const REF_W = 1792
const REF_H = 1024

export const DoggoNogoBaseLevel = {
    // Default start/response keys (single-response simple RT). Override per level.
    startKeys: ["ArrowDown"],
    isResponseKey: function (key) {
        return (this.startKeys || ["ArrowDown"]).indexOf(key) !== -1
    },
    endOverlayTitle: "Level Complete",

    /** Authoritative time source (prefers the host jsPsych clock for RT consistency). */
    now: function () {
        if (this.jsPsych) return this.jsPsych.getTotalTime()
        if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now()
        return Date.now()
    },

    /**
     * Time of an input event in the level clock. `event.timeStamp` is when the input actually
     * happened, which is earlier (and steadier) than reading a clock inside the handler.
     */
    eventTime: function (e) {
        const t = e && e.timeStamp
        // Guard against legacy epoch-based timestamps, which are not on the performance clock.
        if (typeof t !== "number" || t <= 0 || t > 1e12) return this.now()
        return t + this.state.clockOffset
    },

    /** Marker flash hook; the engine swaps in its own trigger for the duration of a run. */
    flashMarker: function () {},

    /** Image whose natural dimensions define the stimulus aspect ratio. */
    getStimulusAspectImage: function () {
        return this.assets.imgStimulus || this.assets.imgStimulus1
    },

    /** Compute sprite/stimulus pixel sizes from the current canvas size. */
    initializeDimensions: function (canvas) {
        this.state.canvas = canvas
        this.state.ctx = canvas.getContext("2d")
        const playerAspect = this.assets.imgPlayer1.naturalWidth / this.assets.imgPlayer1.naturalHeight
        this.state.player.height = canvas.height * this.params.playerHeight
        this.state.player.width = this.state.player.height * playerAspect
        const stimImg = this.getStimulusAspectImage()
        const stimAspect = stimImg.naturalWidth / stimImg.naturalHeight
        this.state.stimulus.height = canvas.height * this.params.stimulusHeight
        this.state.stimulus.width = this.state.stimulus.height * stimAspect
        this.params.stimulusFallDistancePx = canvas.height * this.params.stimulusFallDistance
    },

    /** Centers the player horizontally and seats it at `params.playerY`. */
    placePlayer: function (canvas) {
        this.state.player.x = canvas.width / 2 - this.state.player.width / 2
        const centerY = canvas.height * (typeof this.params.playerY === "number" ? this.params.playerY : 0.5)
        this.state.player.y = centerY - this.state.player.height / 2
        this.state.player.originalY = this.state.player.y
    },

    /**
     * Keys the game consumes, and whose default browser action must be suppressed.
     *
     * Arrow keys and Space scroll the document. Whenever the page has even a couple of pixels of
     * overflow, that scroll slides the whole canvas inside the viewport, which reads as the camera
     * jolting sideways on every response. The game owns these keys, so nothing else may act on them.
     */
    isGameKey: function (e) {
        return this.isResponseKey(e.key) || e.code === "Space" || e.key === " " || e.key === "Spacebar"
    },

    /** (Re)binds keyboard and click input, detaching any handlers left over from a previous run. */
    attachInput: function (canvas) {
        this.detachInput(canvas)
        this.boundKeyDownHandler = (e) => {
            if (this.isGameKey(e)) e.preventDefault()
            this.handleKeyDown(e)
        }
        document.addEventListener("keydown", this.boundKeyDownHandler)
        this.boundClickHandler = this.handleClick.bind(this)
        canvas.addEventListener("click", this.boundClickHandler)
    },

    /** Removes the input handlers bound by `attachInput`. */
    detachInput: function (canvas) {
        if (this.boundKeyDownHandler) document.removeEventListener("keydown", this.boundKeyDownHandler)
        if (this.boundClickHandler && canvas) canvas.removeEventListener("click", this.boundClickHandler)
    },

    /**
     * Recalculate sprite dimensions & positions after an external canvas resize.
     * (Canvas width/height should already be updated by host code before calling.)
     */
    handleResize: function () {
        if (!this.state.canvas) return
        const canvas = this.state.canvas
        const prevPlayerCenterFrac = (this.state.player.x + this.state.player.width / 2) / canvas.width || 0.5
        const jumpingOffsetFrac = this.state.player.jumping ? (this.state.player.originalY - this.state.player.y) / canvas.height : 0
        const stimVisible = this.state.stimulus.visible || this.state.stimulus.exiting
        let stimCenterFracX = 0
        let stimCenterFracY = 0
        if (stimVisible) {
            stimCenterFracX = (this.state.stimulus.x + this.state.stimulus.width / 2) / canvas.width
            stimCenterFracY = (this.state.stimulus.y + this.state.stimulus.height / 2) / canvas.height
        }
        this.initializeDimensions(canvas)
        this.state.player.x = canvas.width * prevPlayerCenterFrac - this.state.player.width / 2
        const centerY = canvas.height * (typeof this.params.playerY === "number" ? this.params.playerY : 0.5)
        this.state.player.y = centerY - this.state.player.height / 2
        this.state.player.originalY = this.state.player.y
        if (jumpingOffsetFrac) this.state.player.y = this.state.player.originalY - jumpingOffsetFrac * canvas.height
        if (stimVisible) {
            const stimImg = this.getStimulusAspectImage()
            const stimAspect = stimImg.naturalWidth / stimImg.naturalHeight
            this.state.stimulus.height = canvas.height * this.params.stimulusHeight
            this.state.stimulus.width = this.state.stimulus.height * stimAspect
            this.state.stimulus.x = canvas.width * stimCenterFracX - this.state.stimulus.width / 2
            this.state.stimulus.y = canvas.height * stimCenterFracY - this.state.stimulus.height / 2
            if (!this.state.stimulus.exiting) this.state.stimulus.initialY = this.state.stimulus.y
        }
        this.params.stimulusFallDistancePx = canvas.height * this.params.stimulusFallDistance
    },

    /**
     * Shared `start()` scaffolding: stops anything still pending from a previous run, swaps in a
     * fresh `state` from `getInitialState()`, sizes/places the player, and binds input.
     * Levels call this first, then apply their own level-specific setup.
     */
    beginLevel: function (canvas, endGameCallback, options) {
        DoggoNogoCore.clearTrialSchedule(this.state)
        // The instruction screen's delayed "press X to start" prompt must not land on the canvas
        // once gameplay is drawing to it.
        if (this.instructionHintTimeout) {
            clearTimeout(this.instructionHintTimeout)
            this.instructionHintTimeout = null
        }
        this.detachInput(this.state.canvas)
        this.state = this.getInitialState()
        this.endGameCallback = endGameCallback
        const opts = options || {}
        this.state.showContinueButton = !!opts.showContinueButton
        this.state.continueLabel = typeof opts.continueLabel === "string" ? opts.continueLabel : "Continue"
        this.initializeDimensions(canvas)
        this.placePlayer(canvas)
        this.attachInput(canvas)
        // requestAnimationFrame and input events use the performance clock; `now()` may be the host
        // jsPsych clock. One offset per run converts between them exactly.
        const perfNow = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
        this.state.clockOffset = this.now() - perfNow
        this.state.frameTime = this.now()
    },

    /**
     * Per-frame update: trial schedule, player physics, stimulus motion, exit timing, break,
     * particles. `frameTimestamp` is the requestAnimationFrame timestamp of the current frame.
     */
    update: function (frameTimestamp) {
        this.state.frameTime = typeof frameTimestamp === "number" ? frameTimestamp + this.state.clockOffset : this.now()
        this.updateTrialSchedule()
        if (this.state.player.jumping) {
            this.state.player.velocityY += this.params.gravity
            this.state.player.y += this.state.player.velocityY
            if (this.state.player.y >= this.state.player.originalY) {
                this.state.player.y = this.state.player.originalY
                this.state.player.jumping = false
                this.state.player.velocityY = 0
            }
        }
        // Level-specific stimulus animation (e.g. Level 1 falling). Default: none.
        this.updateStimulusMotion()
        // Advance exit animation timing
        if (this.state.stimulus.exiting) {
            const elapsed = this.state.frameTime - this.state.stimulus.exitStartTime
            if (elapsed >= this.state.stimulus.exitDuration) this.state.stimulus.exiting = false
        }
        if (this.state.inBreak) this.updateBreak()
        this.updateParticles()
        this.updateFeedbackBubbles()
    },

    /** Hook: per-frame stimulus motion. Override in levels that animate the stimulus. */
    updateStimulusMotion: function () {},

    /** Hook: position (and choose) the stimulus for the trial that is about to start. */
    placeStimulus: function () {},

    /** Hook: called when the response window closes with no response. */
    onResponseTimeout: function () {},

    /**
     * Schedules the next stimulus one ISI ahead. Only the deadline is recorded here; the onset
     * itself happens in `updateTrialSchedule()` on a frame boundary.
     */
    startNewTrial: function () {
        const s = this.state
        const isi = DoggoNogoCore.samplePseudoExponentialISI(this.params.minISI, this.params.maxISI, this.params.meanISIDecay)
        s.stimulusScheduledTime = this.now()
        s.stimulusDueTime = s.stimulusScheduledTime + isi
        s.responseDeadline = null
        s.onsetPending = false
    },

    /**
     * Frame-driven trial schedule. A stimulus drawn during frame N is only presented at the start
     * of frame N+1, so onset is stamped with the *following* frame's timestamp rather than with the
     * clock reading at reveal time; that removes the timer jitter and the one-frame bias from RT.
     */
    updateTrialSchedule: function () {
        const s = this.state
        if (s.gameState !== "playing" || s.inBreak) return
        if (s.onsetPending) {
            // Drawn last frame, so it is on screen as of this frame's timestamp.
            s.onsetPending = false
            s.startTime = s.frameTime
            s.responseDeadline = s.startTime + s.maxRT
            return
        }
        if (s.stimulusDueTime !== null && s.frameTime >= s.stimulusDueTime) {
            s.stimulusDueTime = null
            this.placeStimulus()
            s.stimulus.visible = true
            s.stimulus.exiting = false
            s.trials++
            s.maxRT = 2 * s.medianRT
            s.onsetPending = true
            this.flashMarker()
            return
        }
        if (s.responseDeadline !== null && s.stimulus.visible && !s.stimulus.exiting && s.frameTime >= s.responseDeadline) {
            s.responseDeadline = null
            DoggoNogoCore.startStimulusExit(s, () => s.frameTime, "timeout")
            this.onResponseTimeout()
        }
    },

    /** True while the stimulus has been drawn but not yet presented: a response cannot be to it. */
    isAwaitingStimulusOnset: function () {
        return this.state.onsetPending === true
    },

    /**
     * Withdraws a stimulus that was drawn but not yet presented, because a response beat it to the
     * screen. It never reached the participant, so it does not count as a presented trial.
     */
    cancelPendingStimulus: function () {
        if (!this.state.onsetPending) return
        this.state.onsetPending = false
        this.state.stimulus.visible = false
        this.state.stimulus.exiting = false
        this.state.trials = Math.max(0, this.state.trials - 1)
    },

    /** Realized interval between scheduling a trial and the stimulus reaching the screen. */
    getRealizedISI: function () {
        const s = this.state
        if (!s.stimulusScheduledTime || !s.startTime || s.startTime < s.stimulusScheduledTime) return null
        return s.startTime - s.stimulusScheduledTime
    },

    /** Per-frame render. */
    draw: function () {
        this.clearCanvas()
        this.drawBackground()
        DoggoNogoCore.drawProgressBar(this)
        this.drawPlayer()
        this.drawStimulus()
        this.drawScoreFeedback()
        DoggoNogoCore.drawParticles(this)
        this.drawFeedbackBubbles()
        if (this.state.gameState === "done" && this.state.endOverlayVisible && this.state.showContinueButton) {
            this.drawEndOverlay()
        }
        if (this.state.inBreak) this.drawBreakOverlay()
    },

    clearCanvas: function () {
        this.state.ctx.clearRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    drawBackground: function () {
        this.state.ctx.drawImage(this.assets.imgBackground, 0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    drawScoreFeedback: function () {
        DoggoNogoCore.drawScoreFeedback(this)
    },

    drawParticles: function () {
        DoggoNogoCore.drawParticles(this)
    },

    drawFeedbackBubbles: function () {
        DoggoNogoCore.drawFeedbackBubbles(this)
    },

    updateParticles: function () {
        DoggoNogoCore.updateParticles(this)
    },

    updateFeedbackBubbles: function () {
        DoggoNogoCore.updateFeedbackBubbles(this, 500)
    },

    /**
     * Draws the player sprite, applying an optional error/early flash tint and optional
     * horizontal mirroring when `state.playerFacing === "right"`.
     */
    drawPlayer: function () {
        const ctx = this.state.ctx
        const p = this.state.player
        const img = this.assets.imgPlayer
        if (!img) return
        let sprite = img
        const flashUntil = this.state.flashUntil || 0
        if (this.state.frameTime < flashUntil) {
            const remaining = flashUntil - this.state.frameTime
            const total = this.params.flashDuration || 150
            const prog = 1 - remaining / total
            const alpha = Math.sin(Math.PI * prog) // 0..1..0 curve
            sprite = this.getTintedPlayerSprite(img, `rgba(${this.params.flashTintColor},${alpha})`)
        }
        if (this.state.playerFacing === "right") {
            ctx.save()
            ctx.translate(p.x + p.width / 2, 0)
            ctx.scale(-1, 1)
            ctx.drawImage(sprite, -p.width / 2, p.y, p.width, p.height)
            ctx.restore()
        } else {
            ctx.drawImage(sprite, p.x, p.y, p.width, p.height)
        }
    },

    getTintedPlayerSprite: function (img, color) {
        return DoggoNogoCore.getTintedSprite(this, img, color)
    },

    /** Draws the radial "tunnel vision" gradient focused on the player (used during breaks). */
    drawTunnelGradient: function () {
        const ctx = this.state.ctx
        const pcx = this.state.player.x + this.state.player.width / 2
        const pcy = this.state.player.y + this.state.player.height / 2
        const innerR = this.state.player.height * 0.75
        const outerR = innerR * 2.5
        const g = ctx.createRadialGradient(pcx, pcy, innerR, pcx, pcy, outerR)
        g.addColorStop(0, "rgba(0,0,0,0)")
        g.addColorStop(1, "rgba(0,0,0,0.85)")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    /** Text lines shown on the phase-break overlay. Override for phase-specific instructions. */
    getBreakOverlayLines: function () {
        return ["Press SPACE to continue"]
    },

    /** Generic multi-line phase-break overlay (tunnel gradient + centered instructional text). */
    drawBreakOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        ctx.save()
        this.drawTunnelGradient()
        if (this.state.showBreakText) {
            ctx.textAlign = "center"
            const lines = this.getBreakOverlayLines()
            const baseSize = canvas.height * 0.045
            const lineHeight = baseSize * 1.25
            const startY = (1 / 3) * canvas.height - (lines.length - 1) * lineHeight * 0.5
            for (let i = 0; i < lines.length; i++) {
                const size = i === 0 && lines.length > 1 ? baseSize * 1.05 : baseSize
                ctx.font = `${Math.round(size)}px Arial`
                ctx.fillStyle = i === lines.length - 1 ? "#FFD54F" : "white"
                ctx.fillText(lines[i], canvas.width / 2, startY + i * lineHeight)
            }
        }
        ctx.restore()
    },

    /** In-game end overlay with a Continue button (when enabled). */
    drawEndOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        ctx.save()
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const cX = canvas.width / 2
        const cY = canvas.height / 2
        const rts = this.state.reactionTimes || []
        const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0
        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.font = `${Math.round(canvas.height * 0.06)}px Arial`
        ctx.fillText(this.endOverlayTitle || "Level Complete", cX, cY - canvas.height * 0.12)
        ctx.font = `${Math.round(canvas.height * 0.035)}px Arial`
        ctx.fillText(`Average RT: ${avg.toFixed(1)} ms`, cX, cY - canvas.height * 0.06)
        const btnW = Math.round(canvas.width * 0.25)
        const btnH = Math.round(canvas.height * 0.08)
        const btnX = Math.round(cX - btnW / 2)
        const btnY = Math.round(cY)
        this.state.endButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH }
        ctx.fillStyle = "#2196F3"
        ctx.strokeStyle = "#0b79d0"
        ctx.lineWidth = 2
        ctx.fillRect(btnX, btnY, btnW, btnH)
        ctx.strokeRect(btnX, btnY, btnW, btnH)
        ctx.fillStyle = "#fff"
        ctx.font = `${Math.round(btnH * 0.45)}px Arial`
        ctx.fillText(this.state.continueLabel || "Continue", cX, btnY + Math.round(btnH * 0.66))
        ctx.restore()
    },

    /** Returns the effective fast/slow threshold = medianRT / gameDifficulty. */
    getEffectiveThreshold: function () {
        const d = this.params.gameDifficulty && this.params.gameDifficulty > 0 ? this.params.gameDifficulty : 1
        return this.state.medianRT / d
    },

    computeMedian: function (arr) {
        if (!arr || arr.length === 0) return this.state.medianRT
        const s = [...arr].sort((a, b) => a - b)
        const mid = Math.floor(s.length / 2)
        return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    },

    /**
     * Per-phase target scores, as consumed by the shared progress bar. Levels only supply the
     * strategy (`computePhaseTarget`); targets already stored in `state.phaseRequiredScores`
     * win, missing ones are estimated. The progress bar asks for this every frame, so the
     * result is cached and invalidated by `setPhaseTarget`/`setPhaseTargets`.
     * The returned array is the cache itself — read it, don't mutate it.
     */
    getPhaseTargets: function () {
        if (this.state.phaseTargetsCache) return this.state.phaseTargetsCache
        const targets = [0, 0, 0]
        for (let i = 0; i < 3; i++) {
            const stored = this.state.phaseRequiredScores[i]
            targets[i] = stored > 0 ? stored : this.computePhaseTarget(i)
        }
        this.state.phaseTargetsCache = targets
        return targets
    },

    /** Stores one phase target and invalidates the cached targets. Returns the value. */
    setPhaseTarget: function (phaseIdx, value) {
        this.state.phaseRequiredScores[phaseIdx] = value
        this.state.phaseTargetsCache = null
        return value
    },

    /** Replaces all three phase targets (use `[0, 0, 0]` to reset) and invalidates the cache. */
    setPhaseTargets: function (targets) {
        this.state.phaseRequiredScores = targets
        this.state.phaseTargetsCache = null
    },

    /** Target score for the current phase; computes and stores it the first time it is needed. */
    ensurePhaseTarget: function () {
        const idx = this.state.phaseIndex
        const stored = this.state.phaseRequiredScores[idx]
        if (stored > 0) return stored
        return this.setPhaseTarget(idx, this.computePhaseTarget(idx))
    },

    /** Decide, after a trial, whether to break, end the level, or start the next trial. */
    _checkForPhaseOrLevelEnd: function () {
        const epsilon = 1e-6
        const currentPhaseTarget = this.ensurePhaseTarget()
        if (this.state.score + epsilon >= this.state.phaseFloorScore + currentPhaseTarget) {
            if (this.state.phaseIndex < 2) this.startPhaseBreak()
            else this.endLevel()
        } else {
            this.startNewTrial()
        }
    },

    /** Initiates a phase break; recomputes the next phase floor & target. */
    startPhaseBreak: function () {
        this.state.phaseIndex = Math.min(2, this.state.phaseIndex + 1)
        this.state.inBreak = true
        this.state.breakState = "started"
        this.state.breakStartTime = this.now()
        this.state.showBreakText = false
        DoggoNogoCore.playPhaseComplete(this)
        DoggoNogoCore.clearTrialSchedule(this.state)
        this.state.stimulus.visible = false
        this.state.stimulus.exiting = false
        if (this.state.phaseIndex === 1) {
            this.state.phaseFloorScore = this.state.phaseRequiredScores[0]
            this.state.score = this.state.phaseFloorScore
            this.setPhaseTarget(1, this.computePhaseTarget(1))
        } else if (this.state.phaseIndex === 2) {
            this.state.phaseFloorScore = this.state.phaseRequiredScores[0] + this.state.phaseRequiredScores[1]
            this.state.score = this.state.phaseFloorScore
            this.setPhaseTarget(2, this.computePhaseTarget(2))
        }
    },

    /**
     * Timed phase-break sequence: after `params.breakEffectsDelay` play the evolution beat,
     * after `params.breakTextDelay` show the continue prompt. Per-level flavour is data:
     * `params.breakSparkles` (a `DoggoNogoCore.createParticles` config plus `count`) and
     * `assets.soundEvolve`.
     */
    updateBreak: function () {
        const elapsed = this.state.frameTime - this.state.breakStartTime
        if (this.state.breakState === "started" && elapsed > (this.params.breakEffectsDelay ?? 1000)) {
            this.playBreakEffects()
            this.state.breakState = "effects"
        }
        if (this.state.breakState === "effects" && elapsed > (this.params.breakTextDelay ?? 2000)) {
            this.state.showBreakText = true
            this.state.breakState = "ready"
        }
    },

    /** Evolution beat of a phase break: swap to the phase sprite, burst sparkles, play the sound. */
    playBreakEffects: function () {
        const phaseSprite = this.assets["imgPlayer" + (this.state.phaseIndex + 1)]
        if (phaseSprite) this.assets.imgPlayer = phaseSprite
        const sparkles = this.params.breakSparkles
        if (sparkles) {
            const cx = this.state.player.x + this.state.player.width / 2
            const cy = this.state.player.y + this.state.player.height / 2
            DoggoNogoCore.createParticles(this, cx, cy, sparkles.count ?? 50, sparkles)
        }
        DoggoNogoCore.safePlay(this.assets.soundEvolve)
    },

    resumeFromBreak: function () {
        if (!this.state.inBreak || this.state.breakState !== "ready") return
        this.state.inBreak = false
        this.state.breakState = "idle"
        this.startNewTrial()
    },

    /** Cleanly ends the level, removing listeners/timers and calling the end callback. */
    endLevel: function () {
        this.state.gameState = "done"
        DoggoNogoCore.safePlay(this.assets.soundLevelUp)
        document.removeEventListener("keydown", this.boundKeyDownHandler)
        this.boundKeyDownHandler = null
        DoggoNogoCore.stopBackgroundMusic(this.assets.soundBackground)
        DoggoNogoCore.clearTrialSchedule(this.state)
        if (this.state.showContinueButton) {
            this.state.endOverlayVisible = true
            return
        }
        // No overlay to click: take the canvas listener off too, so it cannot outlive the level.
        if (this.boundClickHandler && this.state.canvas) this.state.canvas.removeEventListener("click", this.boundClickHandler)
        this.boundClickHandler = null
        this.endGameCallback(this.state)
    },

    /** Handle clicks on the end-overlay Continue button. */
    handleClick: function (e) {
        if (!(this.state.gameState === "done" && this.state.endOverlayVisible && this.state.showContinueButton)) return
        const rect = this.state.canvas.getBoundingClientRect()
        const scaleX = this.state.canvas.width / rect.width
        const scaleY = this.state.canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY
        const btn = this.state.endButtonRect
        if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
            this.state.endOverlayVisible = false
            if (this.boundClickHandler) this.state.canvas.removeEventListener("click", this.boundClickHandler)
            this.boundClickHandler = null
            this.endGameCallback(this.state)
        }
    },

    /** Player jump with strength proportional to reaction time (faster RT = stronger jump). */
    jump: function (reactionTime) {
        if (this.state.player.jumping) return
        this.state.player.jumping = true
        const effectiveRT = Math.min(reactionTime, this.state.maxRT)
        const jumpRange = this.params.maxJumpStrength - this.params.minJumpStrength
        const rtRatio = 1 - effectiveRT / this.state.maxRT
        this.state.player.velocityY = this.params.minJumpStrength + jumpRange * rtRatio
    },

    showScoreFeedback: function (text) {
        DoggoNogoCore.showScoreFeedback(this, text)
    },

    showFeedbackBubble: function (type, x, y) {
        DoggoNogoCore.showFeedbackBubble(this, type, x, y)
    },

    getTrialTypeLabel: function (type) {
        return DoggoNogoCore.getTrialTypeLabel(type)
    },
}

// Expose reference resolution constants for any level that needs them.
DoggoNogoBaseLevel.REF_W = REF_W
DoggoNogoBaseLevel.REF_H = REF_H
