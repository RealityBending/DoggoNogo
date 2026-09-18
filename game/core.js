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
 *  - Stimulus proportions come from `getStimulusAspectImage()`. Every level draws its stimulus
 *    procedurally (game/stimuli.js) and overrides that hook with its declared aspect ratio.
 *
 * Trial timing is frame-driven: `startNewTrial()` only records when the next stimulus is due, and
 * `updateTrialSchedule()` (called from `update()` with the requestAnimationFrame timestamp) reveals
 * it on a frame boundary, stamps `state.startTime` with the frame that actually presents it, and
 * closes the response window. Nothing about a trial is scheduled with `setTimeout`. When the
 * window closes on a timeout, `state.responseWindowClosedAt` is stamped so that a press landing
 * within `params.lateResponseGrace` ms is recognised by `isBelatedResponse(e)` as the late answer to
 * that trial and ignored, rather than being scored as an early press on the next one.
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

import { DoggoNogoCore, DoggoNogoUI } from "./game.js"
import { DoggoNogoInput } from "./input.js"

// Design canvas (16:9); see the note on `REF_W` in game.js.
const REF_W = 1920
const REF_H = 1080

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
     *
     * A touch arrives as a synthetic keyboard event (game/input.js), and a dispatched event's
     * `timeStamp` is the moment of dispatch rather than the moment of the touch. The adapter
     * carries the original pointer timestamp across on `doggoSourceTime`, which is preferred here
     * so a tapped response is timed from the finger, not from the translation.
     */
    eventTime: function (e) {
        const t = e && typeof e.doggoSourceTime === "number" ? e.doggoSourceTime : e && e.timeStamp
        // Guard against legacy epoch-based timestamps, which are not on the performance clock.
        if (typeof t !== "number" || t <= 0 || t > 1e12) return this.now()
        return t + this.state.clockOffset
    },

    /** Marker flash hook; the engine swaps in its own trigger for the duration of a run. */
    flashMarker: function () {},

    /**
     * Object whose `naturalWidth`/`naturalHeight` define the stimulus box's aspect ratio.
     *
     * Only the ratio is read, so a level drawing its stimulus in code returns its declared
     * proportions as a plain object rather than an image -- which all of them currently do. The
     * sprite fallback is kept for a level that blits one, but note that a sprite's box is its
     * bounding box, transparent padding included, so `stimulusHeight` would then size the padding
     * rather than the stimulus.
     */
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

        // Touch: what a tap means changes several times inside a single level, so the adapter is
        // given a function rather than a fixed mapping and re-reads the state at every tap.
        DoggoNogoInput.attach(canvas)
        DoggoNogoInput.setMode(() => {
            // The jsPsych end overlay draws a real Continue button and handles its own click
            // (`handleClick`); swallowing the tap here would leave it unpressable.
            if (this.state.endOverlayVisible && this.state.showContinueButton) return null
            // The score screen, and the phase-break overlay once it invites the player on, both
            // wait on SPACE -- see `handleKeyDown` in each level.
            if (this.state.gameState === "done" || this.state.inBreak) return DoggoNogoInput.SPACE
            return { keys: this.startKeys || ["ArrowDown"] }
        })
    },

    /** Removes the input handlers bound by `attachInput`. */
    detachInput: function (canvas) {
        if (this.boundKeyDownHandler) document.removeEventListener("keydown", this.boundKeyDownHandler)
        if (this.boundClickHandler && canvas) canvas.removeEventListener("click", this.boundClickHandler)
    },

    // -----------------------------------------------------------------------
    // Instruction screen (animated). Levels call `runInstructionScreen` from
    // `showInstructionScreen` with a config; the loop is cancelled by
    // `beginLevel()` when the player starts (or by `cancelInstructionScreen`).
    // -----------------------------------------------------------------------

    /** Starts a private rAF loop that redraws the instruction screen each frame. */
    runInstructionScreen: function (canvas, config) {
        this.cancelInstructionScreen()
        let startTs = null
        const loop = (ts) => {
            if (startTs === null) startTs = ts
            this.drawInstructionFrame(canvas, ts - startTs, config)
            this._instructionRafId = requestAnimationFrame(loop)
        }
        this._instructionRafId = requestAnimationFrame(loop)
    },

    /** Stops the instruction-screen animation loop (safe to call when idle). */
    cancelInstructionScreen: function () {
        if (this._instructionRafId) {
            cancelAnimationFrame(this._instructionRafId)
            this._instructionRafId = null
        }
    },

    /**
     * Shared instruction-screen layout: level background under a dark scrim, a level badge,
     * a display title, an instruction panel, an optional level-specific visual (stimulus +
     * keycaps, drawn via `config.drawVisual(ctx, layout, elapsed)`), and a pulsing start prompt.
     * Config: { badge, title, lines, promptSegments, drawVisual }.
     */
    drawInstructionFrame: function (canvas, elapsed, config) {
        const ctx = canvas.getContext("2d")
        const { fx, theme } = DoggoNogoUI
        const w = canvas.width
        const h = canvas.height

        // Stage: artwork + scrim + vignette
        const bg = this.assets.imgBackground
        if (bg && bg.complete && bg.naturalWidth) fx.drawImageCover(ctx, bg, 0, 0, w, h)
        else {
            ctx.fillStyle = theme.bgDeep
            ctx.fillRect(0, 0, w, h)
        }
        const scrim = ctx.createLinearGradient(0, 0, 0, h)
        scrim.addColorStop(0, "rgba(5,8,16,0.85)")
        scrim.addColorStop(0.45, "rgba(5,8,16,0.55)")
        scrim.addColorStop(1, "rgba(5,8,16,0.82)")
        ctx.fillStyle = scrim
        ctx.fillRect(0, 0, w, h)
        fx.drawVignette(ctx, w, h, 0.35)

        const intro = fx.easeOutCubic(elapsed / 600)
        ctx.save()
        ctx.globalAlpha = intro

        // Level badge (arcade stage plate). A full pill, like the other small chips in the UI
        // (loading bar, cutscene skip button), so every rounded element shares one language.
        if (config.badge) {
            const bh = h * 0.042
            ctx.font = `${Math.round(bh * 0.42)}px ${theme.display}`
            const bw = ctx.measureText(config.badge).width + bh * 1.6
            fx.roundRectPath(ctx, w / 2 - bw / 2, h * 0.085 - bh / 2, bw, bh, bh / 2)
            ctx.fillStyle = "rgba(255,200,87,0.13)"
            ctx.fill()
            ctx.strokeStyle = "rgba(255,200,87,0.55)"
            ctx.lineWidth = Math.max(1, bh * 0.05)
            ctx.stroke()
            ctx.fillStyle = theme.accent
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(config.badge, w / 2, h * 0.085 + bh * 0.05)
            ctx.textBaseline = "alphabetic"
        }

        // Title (settles down into place) over a tri-colour arcade rule
        fx.drawGlowText(ctx, config.title, w / 2, h * 0.21 + (1 - intro) * h * 0.02, h * 0.046, {
            color: theme.ink,
            letterSpacing: `${Math.round(h * 0.002)}px`,
        })
        fx.drawTitleRule(ctx, w / 2, h * 0.228, w * 0.2 * intro, h * 0.004)

        // Instruction panel
        const lines = config.lines || []
        const lineH = h * 0.047
        const panelW = w * 0.58
        const panelH = lineH * lines.length + h * 0.052
        const panelY = h * 0.265
        fx.drawPanel(ctx, w / 2 - panelW / 2, panelY, panelW, panelH, h * 0.022)
        ctx.textAlign = "center"
        ctx.fillStyle = theme.ink
        ctx.font = `${Math.round(h * 0.036)}px ${theme.font}`
        lines.forEach((l, i) => ctx.fillText(l, w / 2, panelY + h * 0.052 + i * lineH + h * 0.008))
        ctx.restore()

        // Level-specific visual (stimulus artwork + key mapping)
        const visualTop = panelY + panelH + h * 0.02
        const visualBottom = h * 0.82
        if (config.drawVisual) {
            config.drawVisual(ctx, { top: visualTop, bottom: visualBottom, cy: (visualTop + visualBottom) / 2, w, h }, elapsed)
        }

        // Pulsing start prompt. `drawPromptRow` already renames the caps for touch, which is
        // enough for a one-key level ("TAP to start"); a level whose row needs different wording
        // rather than a different cap gives a `touchPromptSegments` of its own.
        const prompt = (DoggoNogoInput.isTouch && config.touchPromptSegments) || config.promptSegments
        if (prompt && elapsed > 900) {
            ctx.save()
            ctx.globalAlpha = 0.55 + 0.45 * fx.pulse01(elapsed, 1400)
            fx.drawPromptRow(ctx, w / 2, h * 0.9, h * 0.048, prompt, { color: theme.accent })
            ctx.restore()
        }
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
        // The instruction screen's animation loop (and any legacy delayed prompt) must not keep
        // painting the canvas once gameplay is drawing to it.
        this.cancelInstructionScreen()
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
            s.responseWindowClosedAt = s.frameTime
            DoggoNogoCore.startStimulusExit(s, () => s.frameTime, "timeout")
            this.onResponseTimeout()
        }
    },

    /** True while the stimulus has been drawn but not yet presented: a response cannot be to it. */
    isAwaitingStimulusOnset: function () {
        return this.state.onsetPending === true
    },

    /**
     * True when a response arrives shortly after the response window closed on a timeout.
     *
     * Such a press is the participant's (late) answer to the trial that just timed out, not an
     * anticipation of the one being scheduled: the decision was made while the stimulus was still
     * on screen and the key simply landed after the deadline. Without this, a press that missed
     * the window by a few hundred milliseconds was logged as an EARLY press for the *next* trial,
     * penalty included, which is wrong in the data and baffling to the player (who saw the stimulus
     * and pressed). The window is `params.lateResponseGrace` ms from the moment the deadline
     * passed; it covers the 200 ms exit fade plus a motor-execution margin, and stays below the
     * ISI floor so it can never overlap the next presentation. The press is ignored rather than
     * scored: the trial was already logged as a timeout when its window closed.
     */
    isBelatedResponse: function (e) {
        const grace = this.params.lateResponseGrace ?? 500
        const closedAt = this.state.responseWindowClosedAt
        if (!(grace > 0) || typeof closedAt !== "number") return false
        const t = e ? this.eventTime(e) : this.state.frameTime
        return t - closedAt >= 0 && t - closedAt < grace
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
        DoggoNogoUI.fx.drawImageCover(this.state.ctx, this.assets.imgBackground, 0, 0, this.state.canvas.width, this.state.canvas.height)
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
     * Contact shadow on the ground under the player, drawn before the sprite.
     *
     * It does two jobs. The sprites are cropped with the paws flush to the bottom edge and
     * carry no shadow of their own (see the sheet spec in prompts/make_prompts.py), so at
     * rest the character otherwise sits on the background with nothing tying it to the
     * ground. And during a jump the shadow stays on the ground while the sprite rises,
     * which is what actually communicates height: a sprite translating upward on its own
     * is ambiguous between "jumping" and "floating".
     *
     * The shadow shrinks and fades with height rather than staying fixed, because a
     * constant shadow reads as an object sliding rather than leaving the ground.
     *
     * Tunable via `params.jumpShadow`; set `{ enabled: false }` to suppress it.
     */
    drawPlayerShadow: function () {
        const cfg = this.params.jumpShadow || {}
        if (cfg.enabled === false) return
        const p = this.state.player
        if (!p.width || !p.height) return

        // Height above the ground as a fraction of the highest jump these params allow -
        // the apex of v^2/(2g) for the strongest jump. Normalising against the parameters
        // rather than a fixed pixel count keeps the shadow honest if the jump is retuned.
        const maxLift = Math.max(1, this.params.maxJumpStrength ** 2 / (2 * this.params.gravity))
        const lift = Math.min(1, Math.max(0, (p.originalY - p.y) / maxLift))

        // Width is a fraction of the sprite BOX, which is wider than the animal inside it
        // (the level-1 sheet fills about two thirds of its square), so ~0.6 of the box lands
        // roughly under the paws rather than poking out past them.
        const restWidth = p.width * (cfg.widthRatio ?? 0.6)
        const rx = (restWidth * (1 - (1 - (cfg.apexScale ?? 0.6)) * lift)) / 2
        const ry = rx * (cfg.flatten ?? 0.24)
        const restAlpha = cfg.alpha ?? 0.45
        const alpha = restAlpha + ((cfg.apexAlpha ?? 0.13) - restAlpha) * lift
        // Negated comparisons, so a NaN from a missing jump/gravity param bails out here
        // instead of reaching createRadialGradient, which throws on a non-finite radius.
        if (!(rx > 0) || !(alpha > 0)) return

        const ctx = this.state.ctx
        ctx.save()
        ctx.translate(p.x + p.width / 2, p.originalY + p.height + (cfg.yOffset ?? 0) * p.height)
        ctx.scale(1, ry / rx)
        // A radial gradient drawn as a circle in the squashed frame, not a filled ellipse:
        // a hard rim would read as a painted-on oval against the artwork.
        // The core holds close to full strength out to ~60% of the radius before falling away.
        // A plain centre-to-edge ramp averages far lighter than its nominal alpha and vanished
        // against level 1's bright lawn.
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
        g.addColorStop(0, `rgba(0,0,0,${alpha})`)
        g.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.88})`)
        g.addColorStop(0.85, `rgba(0,0,0,${alpha * 0.38})`)
        g.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, rx, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
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
        this.drawPlayerShadow()
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
        return [DoggoNogoUI.words.continueHint]
    },

    /**
     * Generic phase-break overlay: tunnel gradient, a "PHASE CLEAR" banner, the level's
     * phase-specific instruction lines, and a pulsing SPACE prompt with a keycap.
     */
    drawBreakOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        const { fx, theme } = DoggoNogoUI
        const w = canvas.width
        const h = canvas.height
        ctx.save()
        this.drawTunnelGradient()
        if (this.state.showBreakText) {
            const elapsed = this.state.frameTime - this.state.breakStartTime
            const reveal = fx.easeOutBack(Math.min(1, elapsed / 2600))

            // Banner: the phase just completed (phaseIndex was already advanced at break start),
            // tinted with that phase's segment colour from the life bar.
            // Constant px + `scale` so the grow animation reuses one cached text sprite.
            const phaseColor = (theme.barColors || [])[Math.max(0, this.state.phaseIndex - 1)] || theme.accent
            fx.drawGlowText(ctx, `PHASE ${this.state.phaseIndex} CLEAR!`, w / 2, h * 0.14, h * 0.048, {
                color: phaseColor,
                letterSpacing: `${Math.round(h * 0.002)}px`,
                scale: reveal,
            })
            fx.drawTitleRule(ctx, w / 2, h * 0.162, w * 0.18 * Math.min(1, reveal), h * 0.004)

            // Instruction lines (top area, clear of the spotlighted player)
            const lines = this.getBreakOverlayLines().filter((l) => l && !/press space/i.test(l))
            if (lines.length) {
                const lineH = h * 0.046
                lines.forEach((l, i) =>
                    fx.drawGlowText(ctx, l, w / 2, h * 0.23 + i * lineH, h * 0.038, {
                        color: theme.ink,
                        weight: 500,
                        font: theme.font,
                        glowSize: 0.3,
                    }),
                )
            }

            // Pulsing continue prompt
            ctx.save()
            ctx.globalAlpha = 0.55 + 0.45 * fx.pulse01(elapsed, 1400)
            fx.drawPromptRow(ctx, w / 2, h * 0.9, h * 0.045, [{ t: "Press" }, { k: "SPACE" }, { t: "to continue" }], {
                color: theme.ink,
            })
            ctx.restore()
        }
        ctx.restore()
    },

    /** In-game end overlay with a Continue button (when enabled). */
    drawEndOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        const { fx, theme } = DoggoNogoUI
        const w = canvas.width
        const h = canvas.height
        ctx.save()
        ctx.fillStyle = "rgba(4,6,12,0.72)"
        ctx.fillRect(0, 0, w, h)
        const cX = w / 2
        const cY = h / 2
        const rts = this.state.reactionTimes || []
        const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0

        // Card
        const panelW = w * 0.42
        const panelH = h * 0.42
        fx.drawPanel(ctx, cX - panelW / 2, cY - panelH / 2, panelW, panelH, h * 0.025)

        ctx.textAlign = "center"
        fx.drawGlowText(ctx, this.endOverlayTitle || "Level Complete", cX, cY - panelH * 0.22, h * 0.038, { color: theme.ink })
        ctx.fillStyle = theme.inkSoft
        ctx.font = `${Math.round(h * 0.036)}px ${theme.font}`
        ctx.fillText(`Average reaction time: ${avg.toFixed(0)} ms`, cX, cY - panelH * 0.05)

        // Continue button — arcade cabinet style: hard offset shadow slab, chunky border,
        // pixel-font label. (Hit rect stays static; only the visuals breathe.)
        const btnW = Math.round(w * 0.18)
        const btnH = Math.round(h * 0.075)
        const btnX = Math.round(cX - btnW / 2)
        const btnY = Math.round(cY + panelH * 0.12)
        this.state.endButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH }
        const t = this.state.frameTime || 0
        const glow = 0.4 + 0.6 * fx.pulse01(t, 1600)
        const drop = Math.max(3, Math.round(btnH * 0.09))
        const br = Math.round(btnH * 0.18)
        ctx.save()
        // Hard shadow slab (the classic "pressed cartridge" depth)
        fx.roundRectPath(ctx, btnX + drop, btnY + drop, btnW, btnH, br)
        ctx.fillStyle = "rgba(0,0,0,0.55)"
        ctx.fill()
        // Face
        const bg = ctx.createLinearGradient(0, btnY, 0, btnY + btnH)
        bg.addColorStop(0, theme.accent)
        bg.addColorStop(1, theme.accentHot)
        fx.roundRectPath(ctx, btnX, btnY, btnW, btnH, br)
        ctx.shadowColor = `rgba(255,200,87,${0.4 * glow})`
        ctx.shadowBlur = btnH * 0.55
        ctx.fillStyle = bg
        ctx.fill()
        ctx.shadowColor = "transparent"
        ctx.strokeStyle = "#1a1205"
        ctx.lineWidth = Math.max(2, btnH * 0.06)
        ctx.stroke()
        // Top bevel highlight
        ctx.fillStyle = "rgba(255,255,255,0.35)"
        ctx.fillRect(btnX + br, btnY + ctx.lineWidth, btnW - br * 2, Math.max(1.5, btnH * 0.06))
        ctx.fillStyle = "#1a1205"
        ctx.font = `${Math.round(btnH * 0.28)}px ${theme.display}`
        ctx.textBaseline = "middle"
        ctx.fillText((this.state.continueLabel || "Continue").toUpperCase(), cX, btnY + btnH * 0.56)
        ctx.restore()
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

    /**
     * Evolution beat of a phase break: swap to the phase sprite (and the phase background, when
     * the level has one per phase as `assets.imgBackground{1,2,3}`), burst sparkles, play the sound.
     */
    playBreakEffects: function () {
        const phaseSprite = this.assets["imgPlayer" + (this.state.phaseIndex + 1)]
        if (phaseSprite) this.assets.imgPlayer = phaseSprite
        const phaseBackground = this.assets["imgBackground" + (this.state.phaseIndex + 1)]
        if (phaseBackground && phaseBackground.naturalWidth) {
            this.assets.imgBackground = phaseBackground
            DoggoNogoUI.ambient.set(phaseBackground)
        }
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
