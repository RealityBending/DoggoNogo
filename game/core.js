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
 * Conventions assumed by the base:
 *  - `this.state` carries: canvas, ctx, player, stimulus, particles, feedbackBubbles, score,
 *    phaseIndex, phaseFloorScore, phaseRequiredScores, medianRT, maxRT, flashUntil, ...
 *  - `this.params` carries: gravity, min/maxJumpStrength, playerHeight, playerY, stimulusHeight,
 *    stimulusFallDistance, flashDuration, flashTintColor, minScore, maxScore, gameDifficulty, ...
 *  - The aspect-defining stimulus image is `this.assets.imgStimulus` or `this.assets.imgStimulus1`.
 *
 * Override hooks (safe to redefine per level):
 *  - `updateStimulusMotion()`  per-frame stimulus animation (default: none)
 *  - `getBreakOverlayLines()`  text lines shown on the phase-break overlay
 *  - `getStimulusAspectImage()` image used to derive stimulus aspect ratio
 *  - `computePhaseTarget(i)` / `getPhaseTargets()` / `ensurePhaseTarget()` phase-target strategy
 *  - `endOverlayTitle` (string) title shown on the in-game end overlay
 *  - `startKeys` (string[]) / `isResponseKey(key)` which keys start / count as responses
 */
;(function (global) {
    const REF_W = 1792
    const REF_H = 1024

    const BaseLevel = {
        // Default start/response keys (single-response simple RT). Override per level.
        startKeys: ["ArrowDown"],
        isResponseKey: function (key) {
            return (this.startKeys || ["ArrowDown"]).indexOf(key) !== -1
        },
        endOverlayTitle: "Level Complete",

        /** Authoritative time source (prefers jsPsych for RT consistency). */
        now: function () {
            if (typeof jsPsych !== "undefined") return jsPsych.getTotalTime()
            if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now()
            return Date.now()
        },

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

        /** Per-frame update: player physics, stimulus motion, exit timing, break, particles. */
        update: function () {
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
                const elapsed = this.now() - this.state.stimulus.exitStartTime
                if (elapsed >= this.state.stimulus.exitDuration) this.state.stimulus.exiting = false
            }
            if (this.state.inBreak) this.updateBreak()
            this.updateParticles()
            this.updateFeedbackBubbles()
        },

        /** Hook: per-frame stimulus motion. Override in levels that animate the stimulus. */
        updateStimulusMotion: function () {},

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
            if (this.now() < flashUntil) {
                const remaining = flashUntil - this.now()
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
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.playPhaseComplete(this)
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)
            this.state.stimulus.visible = false
            this.state.stimulus.exiting = false
            if (this.state.phaseIndex === 1) {
                this.state.phaseFloorScore = this.state.phaseRequiredScores[0]
                this.state.score = this.state.phaseFloorScore
                this.state.phaseRequiredScores[1] = this.computePhaseTarget(1)
            } else if (this.state.phaseIndex === 2) {
                this.state.phaseFloorScore = this.state.phaseRequiredScores[0] + this.state.phaseRequiredScores[1]
                this.state.score = this.state.phaseFloorScore
                this.state.phaseRequiredScores[2] = this.computePhaseTarget(2)
            }
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
            try {
                this.assets.soundBackground.pause()
                this.assets.soundBackground.currentTime = 0
            } catch (e) {
                console.debug("Failed to stop background music", e)
            }
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.clearTrialTimers(this.state)
            if (this.state.showContinueButton) {
                this.state.endOverlayVisible = true
                return
            }
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
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.showScoreFeedback(this, text)
        },

        showFeedbackBubble: function (type, x, y) {
            if (typeof DoggoNogoCore !== "undefined") DoggoNogoCore.showFeedbackBubble(this, type, x, y)
        },

        getTrialTypeLabel: function (type) {
            if (typeof DoggoNogoCore !== "undefined") return DoggoNogoCore.getTrialTypeLabel(type)
            return type === "timeout" ? "Timeout" : type.charAt(0).toUpperCase() + type.slice(1)
        },
    }

    // Expose reference resolution constants for any level that needs them.
    BaseLevel.REF_W = REF_W
    BaseLevel.REF_H = REF_H

    global.DoggoNogoBaseLevel = BaseLevel
})(typeof window !== "undefined" ? window : globalThis)
