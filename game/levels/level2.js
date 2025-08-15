/**
 * Level 2 logic (directional variant of Level 1).
 *
 * Differences vs Level 1:
 *  - Two directional stimuli (left/right) requiring ArrowLeft / ArrowRight.
 *  - Explicit "error" outcome (wrong direction) separate from early / timeout.
 *  - Simplified visual feedback (numeric score delta + evolution sparkles only).
 *  - Audio behavior mirrors Level 1 (background music + fast/slow/error/evolve SFX).
 *  - Start sound is played centrally by the engine to avoid duplication.
 *
 * Scoring:
 *  Fast   (<= threshold)                : + scaled between minScore..maxScore
 *  Slow   (> threshold, before timeout) : + minScore/2
 *  Error  (wrong direction)             : - minScore/2
 *  Early  (before stimulus visible)     : - minScore
 *  Timeout (no response)                : 0
 * Only correct fast/slow trials update the adaptive median RT.
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
    now: function () {
        if (typeof jsPsych !== "undefined") return jsPsych.getTotalTime()
        if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now()
        return Date.now()
    },
    params: {
        trialsNumber: 15,
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
        playerY: 0.7,
        stimulusHeight: 0.1,
    },
    assets: {
        imgPlayer: new Image(),
        imgPlayer1: new Image(),
        imgPlayer2: new Image(),
        imgPlayer3: new Image(),
        // Yellow stimulus keeps legacy name imgStimulus for backwards compatibility
        imgStimulus: new Image(),
        imgStimulusBlue: new Image(),
        imgBackground: new Image(),
        soundEvolve: new Audio(),
        soundLevelUp: new Audio(),
        soundError: new Audio(),
        soundFast: new Audio(),
        soundSlow: new Audio(),
        soundBackground: new Audio(),
        soundStart: new Audio(),
        // Cover (reuse root-level assets if present)
        imgCover: new Image(),
        imgCoverText: new Image(),
    },
    state: {
        gameState: "playing",
        score: 0,
        trials: 0,
        reactionTimes: [],
        particles: [],
        data: [],
        player: { x: 0, y: 0, width: 100, height: 100, velocityY: 0, jumping: false, originalY: 0 },
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
        },
        startTime: 0,
        pendingStimulusTimeoutId: null,
        currentTrialTimeoutId: null,
        medianRT: 1000,
        maxRT: 2000,
        scoreText: "",
        scoreTextVisible: false,
        scoreTextTimeout: null,
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
    },
    initializeDimensions: function (canvas) {
        this.state.canvas = canvas
        this.state.ctx = canvas.getContext("2d")
        const playerAspect = this.assets.imgPlayer1.naturalWidth / this.assets.imgPlayer1.naturalHeight
        this.state.player.height = canvas.height * this.params.playerHeight
        this.state.player.width = this.state.player.height * playerAspect
        const stimAspect = this.assets.imgStimulus.naturalWidth / this.assets.imgStimulus.naturalHeight
        this.state.stimulus.height = canvas.height * this.params.stimulusHeight
        this.state.stimulus.width = this.state.stimulus.height * stimAspect
        this.params.stimulusFallDistancePx = canvas.height * this.params.stimulusFallDistance
    },
    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level2/player_1.png"
        this.assets.imgPlayer2.src = base + "level2/player_2.png"
        this.assets.imgPlayer3.src = base + "level2/player_3.png"
        this.assets.imgStimulus.src = base + "level2/stimulus_yellow.png"
        this.assets.imgStimulusBlue.src = base + "level2/stimulus_blue.png"
        this.assets.imgBackground.src = base + "level2/background.png"
        this.assets.soundEvolve.src = base + "level2/sound_evolve.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3" // shared root-level sound
        this.assets.soundError.src = base + "level2/sound_error.mp3"
        this.assets.soundFast.src = base + "level2/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level2/sound_slow.mp3"
        this.assets.soundBackground.src = base + "level2/Fishbone.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        // Cover assets (same root names as level1)
        this.assets.imgCover.src = base + "cover1_noText.png"
        this.assets.imgCoverText.src = base + "text.png"
        const assetRefs = [
            // Images
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgStimulus,
            this.assets.imgStimulusBlue,
            this.assets.imgBackground,
            this.assets.imgCover,
            this.assets.imgCoverText,
            // Audio
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
                                // Remove listeners after first success
                                asset.oncanplaythrough = null
                                asset.onerror = null
                                res()
                            }
                            asset.oncanplaythrough = done
                            asset.onerror = (e) => rej(e)
                            // Some browsers may not fire canplaythrough for very short files; fallback timeout
                            setTimeout(() => {
                                if (!asset.readyState || asset.readyState < 3) return // HAVE_FUTURE_DATA
                                done()
                            }, 2000)
                        } else res()
                    })
            )
        ).then(() => {
            this.initializeDimensions(canvas)
            this.state.player.x = canvas.width / 2 - this.state.player.width / 2
            const centerY = canvas.height * (typeof this.params.playerY === "number" ? this.params.playerY : 0.5)
            this.state.player.y = centerY - this.state.player.height / 2
            this.state.player.originalY = this.state.player.y
        })
    },
    showInstructionScreen: function (canvas) {
        const REF_W = 1792
        const REF_H = 1024
        const scaleFontPx = (b) => Math.round(b * ((canvas.width / REF_W + canvas.height / REF_H) / 2))
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
        const stimLeft = this.state.leftStimulusImg || this.assets.imgStimulus
        const stimRight = this.state.rightStimulusImg || this.assets.imgStimulusBlue || this.assets.imgStimulus
        const stimH = Math.min(canvas.height * 0.18, stimLeft.naturalHeight || 100)
        const stimAspectL = (stimLeft.naturalWidth || 100) / (stimLeft.naturalHeight || 100)
        const stimAspectR = (stimRight.naturalWidth || 100) / (stimRight.naturalHeight || 100)
        const stimWLeft = stimH * stimAspectL
        const stimWRight = stimH * stimAspectR
        const midY = canvas.height * 0.58
        const leftXCenter = canvas.width * 0.25
        const rightXCenter = canvas.width * 0.75
        // Left (draw normal)
        ctx.drawImage(stimLeft, leftXCenter - stimWLeft / 2, midY - stimH / 2, stimWLeft, stimH)
        // Right (mirrored)
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
        this.state.phaseRequiredScores = [0, 0, 0]
        this.state.showContinueButton = !!opts.showContinueButton
        this.state.continueLabel = typeof opts.continueLabel === "string" ? opts.continueLabel : "Continue"
        this.state.endOverlayVisible = false
        this.state.medianRT = 1000
        this.state.maxRT = 2000
        this.state.phaseFloorScore = 0
        this.state.phaseRequiredScores[0] = this.computePhaseTarget(0)
        if (this.state.pendingStimulusTimeoutId) clearTimeout(this.state.pendingStimulusTimeoutId)
        if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
        // (Re)initialize sounds
        this.boundKeyDownHandler = this.handleKeyDown.bind(this)
        document.addEventListener("keydown", this.boundKeyDownHandler)
        this.boundClickHandler = this.handleClick.bind(this)
        canvas.addEventListener("click", this.boundClickHandler)
        if (typeof window !== "undefined") {
            window.level2Data = this.state.data
            window.getLevel2Data = () => this.state.data
        }
        this.assets.imgPlayer = this.assets.imgPlayer1
        // Decide which color goes on which side ONCE per level start
        if (Math.random() < 0.5) {
            this.state.leftStimulusImg = this.assets.imgStimulus
            this.state.rightStimulusImg = this.assets.imgStimulusBlue
        } else {
            this.state.leftStimulusImg = this.assets.imgStimulusBlue
            this.state.rightStimulusImg = this.assets.imgStimulus
        }
        // Start background music (simple HTMLAudio loop, same as level1)
        try {
            this.assets.soundBackground.loop = true
            // Do not forcibly reset currentTime to preserve seamless carry if already loaded (match level1)
            if (this.assets.soundBackground.paused) this.assets.soundBackground.play()
        } catch (e) {}
        this.startNewTrial()
    },
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
        // Stimulus no longer moves vertically; fixed Y for both sides.
        if (this.state.stimulus.exiting) {
            const elapsed = this.now() - this.state.stimulus.exitStartTime
            if (elapsed >= this.state.stimulus.exitDuration) this.state.stimulus.exiting = false
        }
        if (this.state.inBreak) this.updateBreak()
        this.updateParticles()
    },
    draw: function () {
        this.clearCanvas()
        this.drawBackground()
        this.drawProgressBar()
        this.drawPlayer()
        this.drawStimulus()
        this.drawScoreFeedback()
        this.drawParticles()
        if (this.state.gameState === "done" && this.state.endOverlayVisible && this.state.showContinueButton) this.drawEndOverlay()
        if (this.state.inBreak) this.drawBreakOverlay()
    },
    drawParticles: function () {
        this.state.ctx.save()
        for (const p of this.state.particles) {
            this.state.ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
            this.state.ctx.fillStyle = p.color
            this.state.ctx.fillRect(p.x, p.y, p.size, p.size)
        }
        this.state.ctx.restore()
    },
    drawBackground: function () {
        this.state.ctx.drawImage(this.assets.imgBackground, 0, 0, this.state.canvas.width, this.state.canvas.height)
    },
    drawProgressBar: function () {
        const barWidth = this.state.canvas.width * 0.5
        const barHeight = this.state.canvas.height * 0.033
        const x = this.state.canvas.width / 2 - barWidth / 2
        const y = this.state.canvas.height * 0.033
        this.state.ctx.fillStyle = "#555"
        this.state.ctx.fillRect(x, y, barWidth, barHeight)
        const segWidth = barWidth / 3
        const phaseTargets = this.getPhaseTargets()
        const colors = ["#4CAF50", "#00BCD4", "#2196F3"]
        for (let i = 0; i < 3; i++) {
            const startScore = i === 0 ? 0 : phaseTargets.slice(0, i).reduce((a, b) => a + b, 0)
            const endScore = startScore + phaseTargets[i]
            const raw = (this.state.score - startScore) / (endScore - startScore)
            const frac = Math.min(1, Math.max(0, raw))
            if (frac <= 0) continue
            this.state.ctx.fillStyle = colors[i]
            this.state.ctx.fillRect(x + i * segWidth, y, segWidth * frac, barHeight)
        }
        this.state.ctx.strokeStyle = "#000"
        this.state.ctx.strokeRect(x, y, barWidth, barHeight)
    },
    drawScoreFeedback: function () {
        if (!this.state.scoreTextVisible) return
        const barWidth = this.state.canvas.width * 0.5
        const barHeight = this.state.canvas.height * 0.033
        const barX = this.state.canvas.width / 2 - barWidth / 2
        const barY = this.state.canvas.height * 0.033
        const textX = barX + barWidth + 10
        const textY = barY + barHeight * 0.75
        this.state.ctx.fillStyle = "white"
        this.state.ctx.font = `${this.state.canvas.height * 0.03}px Arial`
        this.state.ctx.fillText(this.state.scoreText, textX, textY)
    },
    drawPlayer: function () {
        this.state.ctx.drawImage(
            this.assets.imgPlayer,
            this.state.player.x,
            this.state.player.y,
            this.state.player.width,
            this.state.player.height
        )
    },
    drawBreakOverlay: function () {
        const message = "Press SPACE to continue"
        this.state.ctx.save()
        const pcx = this.state.player.x + this.state.player.width / 2
        const pcy = this.state.player.y + this.state.player.height / 2
        const innerR = this.state.player.height * 0.75
        const outerR = innerR * 2.5
        const g = this.state.ctx.createRadialGradient(pcx, pcy, innerR, pcx, pcy, outerR)
        g.addColorStop(0, "rgba(0,0,0,0)")
        g.addColorStop(1, "rgba(0,0,0,0.85)")
        this.state.ctx.fillStyle = g
        this.state.ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)
        if (this.state.showBreakText) {
            this.state.ctx.fillStyle = "white"
            this.state.ctx.font = `${this.state.canvas.height * 0.053}px Arial`
            this.state.ctx.textAlign = "center"
            this.state.ctx.fillText(message, this.state.canvas.width / 2, (1 / 3) * this.state.canvas.height)
        }
        this.state.ctx.restore()
    },
    drawEndOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        ctx.save()
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const cX = canvas.width / 2
        const cY = canvas.height / 2
        const rts = this.state.reactionTimes
        const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0
        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.font = `${Math.round(canvas.height * 0.06)}px Arial`
        ctx.fillText("Level Complete", cX, cY - canvas.height * 0.12)
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
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return
        const img = stim.img || this.assets.imgStimulus
        const drawOne = (x, y, w, h, side, alpha = 1) => {
            const ctx = this.state.ctx
            ctx.save()
            ctx.globalAlpha = alpha
            if (side === "right") {
                // Mirror horizontally around rectangle: translate to right edge then scale -1
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
    clearCanvas: function () {
        this.state.ctx.clearRect(0, 0, this.state.canvas.width, this.state.canvas.height)
    },
    startNewTrial: function () {
        const delay = Math.random() * (this.params.maxISI - this.params.minISI) + this.params.minISI
        if (this.state.pendingStimulusTimeoutId) clearTimeout(this.state.pendingStimulusTimeoutId)
        this.state.pendingStimulusTimeoutId = setTimeout(() => {
            this.state.pendingStimulusTimeoutId = null
            // Randomly choose left or right side (50/50)
            const side = Math.random() < 0.5 ? "left" : "right"
            const centerY = this.state.canvas.height * 0.5
            const xPercent = side === "left" ? 0.25 : 0.75
            const stim = this.state.stimulus
            stim.side = side
            stim.img = side === "left" ? this.state.leftStimulusImg : this.state.rightStimulusImg
            stim.y = centerY - stim.height / 2
            stim.initialY = stim.y
            stim.x = this.state.canvas.width * xPercent - stim.width / 2
            this.state.stimulus.visible = true
            this.state.stimulus.exiting = false
            this.state.startTime = this.now()
            this.state.trials++
            this.state.maxRT = 2 * this.state.medianRT
            if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
            this.state.currentTrialTimeoutId = setTimeout(() => {
                this.state.currentTrialTimeoutId = null
                if (this.state.gameState !== "playing") return
                if (this.state.stimulus.visible) {
                    this.state.stimulus.visible = false
                    this.state.stimulus.exiting = true
                    this.state.stimulus.exitType = "timeout"
                    this.state.stimulus.exitStartTime = this.now()
                    this.state.stimulus.exitInitialX = this.state.stimulus.x
                    this.state.stimulus.exitInitialY = this.state.stimulus.y
                    this.state.stimulus.exitInitialWidth = this.state.stimulus.width
                    this.state.stimulus.exitInitialHeight = this.state.stimulus.height
                }
                this.finishTrial({
                    type: TrialTypes.TIMEOUT,
                    points: 0,
                    includeInMedian: false,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    timestamp: new Date().toISOString(),
                })
            }, this.state.maxRT)
        }, delay)
    },
    finishTrial: function (outcome) {
        this.state.score += outcome.points
        if (typeof this.state.phaseFloorScore === "number") this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        DoggoNogoShared.showScoreDelta(this, outcome.points)
        // Only update median with correct (non-error) responses explicitly marked correct (fast/slow)
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
                ResponseKey: outcome.responseKey || "NA",
                Correct: typeof outcome.correct === "boolean" ? (outcome.correct ? 1 : 0) : "NA",
            })
        }
        this._checkForPhaseOrLevelEnd()
    },
    _checkForPhaseOrLevelEnd: function () {
        const epsilon = 1e-6
        const currentPhaseTarget = this.ensurePhaseTarget()
        if (this.state.score + epsilon >= this.state.phaseFloorScore + currentPhaseTarget) {
            if (this.state.phaseIndex < 2) this.startPhaseBreak()
            else this.endLevel()
        } else this.startNewTrial()
    },
    getPhaseTargets: function () {
        const targets = [0, 0, 0]
        for (let i = 0; i < 3; i++)
            targets[i] = this.state.phaseRequiredScores[i] > 0 ? this.state.phaseRequiredScores[i] : this.computePhaseTarget(i)
        return targets
    },
    ensurePhaseTarget: function () {
        if (!this.state.phaseRequiredScores[this.state.phaseIndex] || this.state.phaseRequiredScores[this.state.phaseIndex] <= 0)
            this.state.phaseRequiredScores[this.state.phaseIndex] = this.computePhaseTarget(this.state.phaseIndex)
        return this.state.phaseRequiredScores[this.state.phaseIndex]
    },
    computePhaseTarget: function (phaseIdx) {
        // Heuristic: assume ~50% of remaining trials in this phase will be fast; enforce a floor tied to minTrialsPerPhase.
        const phasesRemaining = Math.max(1, 3 - phaseIdx)
        const trialsLeft = Math.max(0, this.params.trialsNumber - this.state.trials)
        const trialsThisPhase = Math.ceil(trialsLeft / phasesRemaining)
        const expectedFast = Math.floor(trialsThisPhase * 0.5)
        const estimatedTarget = expectedFast * this.params.minScore
        const minTargetByTrials = (this.params.minTrialsPerPhase / 2) * this.params.minScore
        return Math.max(this.params.minScore, minTargetByTrials, estimatedTarget)
    },
    getEffectiveThreshold: function () {
        const d = this.params.gameDifficulty && this.params.gameDifficulty > 0 ? this.params.gameDifficulty : 1
        return this.state.medianRT / d
    },
    updateBreak: function () {
        const now = this.now()
        const elapsed = now - this.state.breakStartTime
        if (this.state.breakState === "started" && elapsed > 1000) {
            if (this.state.phaseIndex === 1) this.assets.imgPlayer = this.assets.imgPlayer2
            else if (this.state.phaseIndex === 2) this.assets.imgPlayer = this.assets.imgPlayer3
            // Red sparkles
            const cx = this.state.player.x + this.state.player.width / 2
            const cy = this.state.player.y + this.state.player.height / 2
            this.createRedSparkles(cx, cy, 40)
            DoggoNogoShared.safePlay(this.assets.soundEvolve)
            this.state.breakState = "effects" // still reuse state names for simplicity
        }
        if (this.state.breakState === "effects" && elapsed > 2000) {
            this.state.showBreakText = true
            this.state.breakState = "ready"
        }
    },
    createRedSparkles: function (x, y, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = Math.random() * 4 + 1
            this.state.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 3 + 2,
                life: Math.random() * 50 + 40,
                maxLife: 90,
                color: `hsl(${Math.random() * 20}, 100%, ${60 + Math.random() * 20}%)`, // reds/oranges
            })
        }
    },
    updateParticles: function () {
        for (let i = this.state.particles.length - 1; i >= 0; i--) {
            const p = this.state.particles[i]
            p.x += p.vx
            p.y += p.vy
            p.life -= 1
            if (p.life <= 0) this.state.particles.splice(i, 1)
        }
    },
    startPhaseBreak: function () {
        this.state.phaseIndex = Math.min(2, this.state.phaseIndex + 1)
        this.state.inBreak = true
        this.state.breakState = "started"
        this.state.breakStartTime = this.now()
        this.state.showBreakText = false
        this.clearTrialTimers()
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
    computeMedian: function (arr) {
        if (!arr || arr.length === 0) return this.state.medianRT
        const s = [...arr].sort((a, b) => a - b)
        const mid = Math.floor(s.length / 2)
        return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    },
    endLevel: function () {
        this.state.gameState = "done"
        DoggoNogoShared.safePlay(this.assets.soundLevelUp)
        try {
            this.assets.soundBackground.pause()
            this.assets.soundBackground.currentTime = 0
        } catch (e) {}
        document.removeEventListener("keydown", this.boundKeyDownHandler)
        this.clearTrialTimers()
        if (this.state.showContinueButton) {
            this.state.endOverlayVisible = true
            return
        }
        this.endGameCallback(this.state)
    },
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
    jump: function (reactionTime) {
        if (this.state.player.jumping) return
        this.state.player.jumping = true
        const effectiveRT = Math.min(reactionTime, this.state.maxRT)
        const jumpRange = this.params.maxJumpStrength - this.params.minJumpStrength
        const rtRatio = 1 - effectiveRT / this.state.maxRT
        const jumpPower = this.params.minJumpStrength + jumpRange * rtRatio
        this.state.player.velocityY = jumpPower
    },
    handleKeyDown: function (e) {
        if (this.state.gameState !== "playing") return
        // If still on instruction screen, first LEFT/RIGHT only starts (plays start sound, no trial counted)
        // (Instruction screen already exited by engine.waitForStart; no gating here)
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
        if (!this.state.stimulus.visible && !this.state.stimulus.exiting) {
            this.clearTrialTimers()
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            DoggoNogoShared.safePlay(this.assets.soundError)
            this.finishTrial({
                type: TrialTypes.EARLY,
                points: -this.params.minScore,
                includeInMedian: false,
                timestamp: nowISO,
                thresholdUsed,
            })
            return
        }
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.now() - this.state.startTime
            if (this.state.currentTrialTimeoutId) clearTimeout(this.state.currentTrialTimeoutId)
            this.startStimulusExit("catch")
            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT
            const correct =
                (e.key === "ArrowLeft" && this.state.stimulus.side === "left") ||
                (e.key === "ArrowRight" && this.state.stimulus.side === "right")
            if (!correct) {
                const nowISO = new Date().toISOString()
                // Error penalty: -minScore/2
                DoggoNogoShared.safePlay(this.assets.soundError)
                this.finishTrial({
                    type: TrialTypes.ERROR,
                    points: -this.params.minScore / 2,
                    includeInMedian: false,
                    timestamp: nowISO,
                    thresholdUsed: threshold,
                    responseKey: e.key,
                    correct: false,
                })
                return
            }
            if (reactionTime > threshold) {
                const include = reactionTime <= trialMaxRT
                const nowISO = new Date().toISOString()
                DoggoNogoShared.safePlay(this.assets.soundSlow)
                this.finishTrial({
                    type: TrialTypes.SLOW,
                    // Slow correct response award: +minScore/2
                    points: this.params.minScore / 2,
                    rt: reactionTime,
                    includeInMedian: include,
                    timestamp: nowISO,
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
            const nowISO = new Date().toISOString()
            DoggoNogoShared.safePlay(this.assets.soundFast)
            this.finishTrial({
                type: TrialTypes.FAST,
                points,
                rt: reactionTime,
                includeInMedian: true,
                timestamp: nowISO,
                thresholdUsed: threshold,
                responseKey: e.key,
                correct: true,
            })
        }
    },
    showScoreFeedback: function (text) {
        this.state.scoreText = text
        this.state.scoreTextVisible = true
        if (this.state.scoreTextTimeout) clearTimeout(this.state.scoreTextTimeout)
        this.state.scoreTextTimeout = setTimeout(() => {
            this.state.scoreTextVisible = false
        }, 1000)
    },
    clearTrialTimers: function () {
        if (typeof DoggoNogoShared !== "undefined") DoggoNogoShared.clearTrialTimers(this.state)
        else {
            if (this.state.pendingStimulusTimeoutId) {
                clearTimeout(this.state.pendingStimulusTimeoutId)
                this.state.pendingStimulusTimeoutId = null
            }
            if (this.state.currentTrialTimeoutId) {
                clearTimeout(this.state.currentTrialTimeoutId)
                this.state.currentTrialTimeoutId = null
            }
        }
    },
    startStimulusExit: function (type) {
        if (typeof DoggoNogoShared !== "undefined") DoggoNogoShared.startStimulusExit(this.state, () => this.now(), type)
        else {
            const stim = this.state.stimulus
            stim.visible = false
            stim.exiting = true
            stim.exitType = type
            stim.exitStartTime = this.now()
            stim.exitInitialX = stim.x
            stim.exitInitialY = stim.y
            stim.exitInitialWidth = stim.width
            stim.exitInitialHeight = stim.height
        }
    },
    isResponseKey: function (key) {
        return key === "ArrowLeft" || key === "ArrowRight"
    },
    getTrialTypeLabel: function (type) {
        if (typeof DoggoNogoShared !== "undefined") return DoggoNogoShared.getTrialTypeLabel(type)
        return type === "timeout" ? "Timeout" : type.charAt(0).toUpperCase() + type.slice(1)
    },
}

// Make accessible globally if in browser context
if (typeof window !== "undefined") {
    window.level2 = level2
}
