/**
 * @file Contains all the logic for level 1 of the game.
 *
 * Level 1 = Gamified Simple Reaction Time Task
 *
 * High-level overview
 * -------------------
 * This script encapsulates the entire logic for a single level in a large `level1` object.
 * This object is structured into three main parts:
 *  - `params`: Static configuration like timings, scores, and sizes.
 *  - `assets`: Holds all `Image` and `Audio` objects.
 *  - `state`: Dynamic data that changes during gameplay (e.g., score, player position, timers).
 *
 * Trial lifecycle:
 * 1) After an ISI (random delay), a stimulus appears at a random position and we start timing.
 * 2) Player presses ArrowDown.
 *    - If pressed before the stimulus appears: early → penalty (−minScore).
 *    - If pressed while visible and RT > Threshold (median RT): slow → +0.
 *    - If pressed while visible and RT ≤ Threshold: fast → positive points.
 * 3) Valid RTs (fast or slow within maxRT) update Threshold (running median) and are sent to the score screen.
 * 4) If no press occurs before maxRT (2 × Threshold at onset), the trial times out with 0 points.
 * 5) Level ends when the current phase's target is reached for the final phase.
 *
 * Fast trial scoring:
 * - Clamp RT to [0, maxRT]; normalize to [0, 1]: nRT = RT / maxRT
 * - Reverse so faster is better: nRT = 1 − nRT
 * - Score = minScore + nRT × (maxScore − minScore)
 *
 * Phase Breaks & Evolution Sequence:
 * ----------------------------------
 * When a phase's score target is met, the game enters a timed break sequence:
 * 1. A "tunnel vision" overlay appears, focusing on the player sprite.
 * 2. After 1 second, the sprite "evolves" (changes image), a sound plays, and sparkles appear.
 * 3. After another second, a "Press SPACE to continue" prompt appears.
 * 4. The player can then press SPACE to start the next phase.
 *
 * Data Logging:
 * -------------
 * On every keypress, a data record is pushed to `level1.state.data`. This array is also
 * exposed as `window.level1Data` for easy access from the browser console.
 *
 * Adaptive phase targets and perceived agency
 * ------------------------------------------
 * We adapt each phase's target score to gently steer the session toward a target
 * total number of valid trials (trialsNumber) while still letting players feel
 * their performance matters.
 *
 * - At the start of each phase, we compute a phase target based on the number of
 *   remaining trials shown (trials) and distribute them across the
 *   remaining phases. We assume ~50% of those trials will be "fast" and worth at
 *   least minScore points. This produces an estimated target for the phase.
 * - We also enforce a per-phase minimum derived from minTrialsPerPhase to avoid
 *   trivially short phases:
 *     phaseMinTarget = max(minScore, (minTrialsPerPhase / 2) * minScore)
 *   The final phase target is max(estimatedTarget, phaseMinTarget).
 *
 * Player agency vs. consistency:
 * - Faster RTs earn more points within a trial (up to maxScore), which can let a
 *   player complete a phase slightly sooner — reinforcing the perception that
 *   going faster helps. However, because phase targets are recomputed at each
 *   break using the remaining valid trials, the overall structure gently nudges
 *   the session toward a consistent total of trials.
 *
 * Phase targets and minimum trials
 * --------------------------------
 * Each phase enforces a minimum target derived from a configurable
 * minTrialsPerPhase (default 4):
 *   phaseMinTarget = max(minScore, (minTrialsPerPhase / 2) * minScore)
 * Dynamic targets are the max of this minimum and an estimate based on
 * remaining trials (assuming ~50% fast), preventing too-short phases.
 */

const level1 = {
    // High-resolution timestamp in milliseconds (float). Falls back to Date.now().
    now: function () {
        if (typeof performance !== "undefined" && typeof performance.now === "function") {
            return performance.now()
        }
        return Date.now()
    },
    params: {
        // Parameters
        trialsNumber: 6, // The (theoretical) number of valid trials for the entire level
        minTrialsPerPhase: 4, // Minimum (theoretical) trials the player should effectively complete per phase
        // minISI: 1000, // Minimum Inter-Stimulus Interval
        // maxISI: 3000, // Maximum Inter-Stimulus Interval
        minISI: 100, // For testing purposes
        maxISI: 300, // For testing purposes
        minScore: 100, // Minimum score awarded for a fast trial
        maxScore: 200, // Maximum score awarded for a fast trial
        // RT thresholds and bounds
        gameDifficulty: 0.75, // dimensionless; effective threshold = medianRT / gameDifficulty

        // Physics properties for the jump
        gravity: 0.5,
        maxJumpStrength: -7.5, // Jump strength for a 0ms RT
        minJumpStrength: -1, // Jump strength for the slowest RT
        // Animations and size
        stimulusFallDistance: 0.05, // % of canvas height
        playerHeight: 0.2, // % of canvas height
        stimulusHeight: 0.1, // % of canvas height
        feedbackBubbleHeight: 0.2, // % of canvas height
    },

    assets: {
        // Image and audio assets for the level
        imgPlayer: new Image(), // current sprite used for drawing
        imgPlayer1: new Image(), // phase 1 sprite
        imgPlayer2: new Image(), // phase 2 sprite
        imgPlayer3: new Image(), // phase 3 sprite
        imgStimulus: new Image(),
        imgBackground: new Image(),
        imgFeedbackSlow: new Image(),
        imgFeedbackLate: new Image(),
        imgFeedbackFast1: new Image(),
        imgFeedbackFast2: new Image(),
        imgFeedbackFast3: new Image(),
        soundBackground: new Audio(),
        soundCorrect: new Audio(),
        soundEvolve: new Audio(),
    },

    state: {
        // Game state management
        gameState: "playing", // states: "playing" | "done"
        score: 0,
        trials: 0, // Trials: number of times the stimulus has been shown (includes slow/fast and timeouts; excludes early presses)
        reactionTimes: [],
        particles: [],
        feedbackBubbles: [],
        lastTrialType: null,
        lastFastFeedback: 0, // 0 = no streak, 1 = fast1, 2 = fast2, 3 = fast3

        // Per-keypress data log (one entry per ArrowDown key press). Exposed as window.level1Data.
        data: [],

        // Player properties
        player: {
            x: 0,
            y: 0,
            width: 100, // These will be overwritten by calculated values
            height: 100,
            velocityY: 0,
            jumping: false,
            originalY: 0,
        },

        // Stimulus properties
        stimulus: {
            x: 0,
            y: 0,
            width: 50, // These will be overwritten by calculated values
            height: 50,
            visible: false,
            exiting: false,
            exitType: "catch", // "catch" | "timeout"
            exitDuration: 200, // ms
            exitStartTime: 0,
            exitInitialX: 0,
            exitInitialY: 0,
            initialY: 0, // Store the initial Y position for the fall animation
            exitInitialWidth: 0,
            exitInitialHeight: 0,
        },

        // Timestamp for reaction time calculation
        startTime: 0,

        // Internal timers/handles
        pendingStimulusTimeoutId: null, // ISI -> stimulus visible timer
        currentTrialTimeoutId: null, // timeout for max RT

        medianRT: 1000, // ms; running median of valid RTs, starts at 1000
        maxRT: 2000, // ms; max RT for a trial, derived from medianRT

        // Score feedback text
        scoreText: "",
        scoreTextVisible: false,
        scoreTextTimeout: null,
        // Phase progression state (3 phases with 2 breaks)
        phaseIndex: 0, // 0: phase1 active; 1: phase2 active; 2: phase3 active (final)
        inBreak: false, // true when waiting for SPACE between phases
        breakState: "idle", // "idle" | "started" | "effects" | "ready"
        breakStartTime: 0,
        showBreakText: false,
        // Per-phase required targets, computed at the start of each phase based on remaining valid trials
        phaseRequiredScores: [0, 0, 0],

        // Reset phase floor
        phaseFloorScore: 0,
        canvas: null, // Reference to the canvas element
        ctx: null, // Reference to the canvas context
        // End overlay/button
        endOverlayVisible: false,
        endButtonRect: { x: 0, y: 0, w: 0, h: 0 },
        showContinueButton: false,
        continueLabel: "Continue",
    },

    /**
     * Initializes dimensions based on canvas size.
     * @param {HTMLCanvasElement} canvas - The game canvas element.
     */
    initializeDimensions: function (canvas) {
        this.state.canvas = canvas
        this.state.ctx = canvas.getContext("2d")

        // Player dimensions (based on phase 1 sprite, assuming all player sprites have the same aspect ratio)
        const playerAspectRatio = this.assets.imgPlayer1.naturalWidth / this.assets.imgPlayer1.naturalHeight
        this.state.player.height = canvas.height * this.params.playerHeight
        this.state.player.width = this.state.player.height * playerAspectRatio

        // Stimulus dimensions
        const stimulusAspectRatio = this.assets.imgStimulus.naturalWidth / this.assets.imgStimulus.naturalHeight
        this.state.stimulus.height = canvas.height * this.params.stimulusHeight
        this.state.stimulus.width = this.state.stimulus.height * stimulusAspectRatio

        // Stimulus fall distance in pixels
        this.params.stimulusFallDistancePx = canvas.height * this.params.stimulusFallDistance
    },

    /**
     * Loads all assets for the level and returns a promise that resolves when loading is complete.
     * @param {HTMLCanvasElement} canvas - The game canvas element.
     * @returns {Promise} - A promise that resolves when all assets are loaded.
     */
    load: function (canvas, options) {
        // Optional base path so this level can be loaded from different HTML locations (e.g., jsPsych root vs game/)
        const base = (options && options.assetBasePath) || ""
        // Set asset sources
        // Preload all player sprites for phase-based swapping
        this.assets.imgPlayer1.src = base + "assets/level1/player_1.png"
        this.assets.imgPlayer2.src = base + "assets/level1/player_2.png"
        this.assets.imgPlayer3.src = base + "assets/level1/player_3.png"
        this.assets.imgStimulus.src = base + "assets/level1/stimulus.png"
        this.assets.imgBackground.src = base + "assets/level1/background.png"
        this.assets.imgFeedbackSlow.src = base + "assets/level1/feedback_slow1.png"
        this.assets.imgFeedbackLate.src = base + "assets/level1/feedback_late1.png"
        this.assets.imgFeedbackFast1.src = base + "assets/level1/feedback_fast1.png"
        this.assets.imgFeedbackFast2.src = base + "assets/level1/feedback_fast2.png"
        this.assets.imgFeedbackFast3.src = base + "assets/level1/feedback_fast3.png"
        this.assets.soundBackground.src = base + "assets/level1/sound_background.mp3"
        this.assets.soundCorrect.src = base + "assets/level1/sound_correct.mp3"
        this.assets.soundEvolve.src = base + "assets/level1/sound_evolve.mp3"

        // Create a promise that resolves when all assets are loaded
        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgStimulus,
            this.assets.imgBackground,
            this.assets.imgFeedbackSlow,
            this.assets.imgFeedbackLate,
            this.assets.imgFeedbackFast1,
            this.assets.imgFeedbackFast2,
            this.assets.imgFeedbackFast3,
            this.assets.soundBackground,
            this.assets.soundCorrect,
            this.assets.soundEvolve,
        ]
        const promises = assetRefs.map((asset) => {
            return new Promise((resolve, reject) => {
                if (asset instanceof HTMLImageElement) {
                    asset.onload = resolve
                    asset.onerror = reject
                } else if (asset instanceof HTMLAudioElement) {
                    asset.oncanplaythrough = resolve
                    asset.onerror = reject
                }
            })
        })

        return Promise.all(promises).then(() => {
            // Now that images are loaded, we can calculate dimensions while preserving aspect ratio
            this.initializeDimensions(canvas)
            // Center the player
            this.state.player.x = canvas.width / 2 - this.state.player.width / 2
            this.state.player.y = canvas.height / 2 - this.state.player.height / 2
            this.state.player.originalY = this.state.player.y
        })
    },

    /**
     * Starts the level, initializes game state, and sets up event listeners.
     * @param {HTMLCanvasElement} canvas - The game canvas element.
     * @param {function} endGameCallback - A callback function to be called when the level is over.
     */
    start: function (canvas, endGameCallback, options) {
        this.state.canvas = canvas
        this.state.ctx = canvas.getContext("2d")
        this.endGameCallback = endGameCallback
        const opts = options || {}
        this.state.score = 0
        this.state.reactionTimes = []
        this.state.trials = 0
        // Reset data in-place to preserve any external references
        if (Array.isArray(this.state.data)) {
            this.state.data.length = 0
        } else {
            this.state.data = []
        }
        this.state.gameState = "playing"
        this.state.phaseIndex = 0
        this.state.inBreak = false
        this.state.phaseRequiredScores = [0, 0, 0]
        // End overlay/button options
        this.state.showContinueButton = !!opts.showContinueButton
        this.state.continueLabel = typeof opts.continueLabel === "string" ? opts.continueLabel : "Continue"
        this.state.endOverlayVisible = false

        // Reset thresholds
        this.state.medianRT = 1000 // Reset to initial value
        this.state.maxRT = 2 * this.state.medianRT

        // Reset phase floor
        this.state.phaseFloorScore = 0
        // Compute target for phase 0 at level start
        this.state.phaseRequiredScores[0] = this.computePhaseTarget(0)

        // Clear any leftover timers
        if (this.state.pendingStimulusTimeoutId) {
            clearTimeout(this.state.pendingStimulusTimeoutId)
            this.state.pendingStimulusTimeoutId = null
        }
        if (this.state.currentTrialTimeoutId) {
            clearTimeout(this.state.currentTrialTimeoutId)
            this.state.currentTrialTimeoutId = null
        }

        // Start background music
        this.assets.soundBackground.loop = true
        this.assets.soundBackground.play()

        // Set up keyboard input handler
        this.boundKeyDownHandler = this.handleKeyDown.bind(this)
        document.addEventListener("keydown", this.boundKeyDownHandler)
        // Set up click handler for end overlay button (only used when visible)
        this.boundClickHandler = this.handleClick.bind(this)
        canvas.addEventListener("click", this.boundClickHandler)

        // Expose data in the browser console
        if (typeof window !== "undefined") {
            window.level1Data = this.state.data
            window.getLevel1Data = () => this.state.data
        }

        // Start the first trial
        this.assets.imgPlayer = this.assets.imgPlayer1
        this.startNewTrial()
    },

    /**
     * The main update loop for the level, called on each frame.
     */
    update: function () {
        // Apply gravity to the player if it's jumping
        if (this.state.player.jumping) {
            this.state.player.velocityY += this.params.gravity
            this.state.player.y += this.state.player.velocityY

            // Check if the player has landed
            if (this.state.player.y >= this.state.player.originalY) {
                this.state.player.y = this.state.player.originalY
                this.state.player.jumping = false
                this.state.player.velocityY = 0
            }
        }

        // Animate stimulus falling during the "fast" window
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const elapsedTime = this.now() - this.state.startTime
            const threshold = this.getEffectiveThreshold()

            if (elapsedTime < threshold) {
                const fallProgress = elapsedTime / threshold
                this.state.stimulus.y = this.state.stimulus.initialY + this.params.stimulusFallDistancePx * fallProgress
            } else {
                // Clamp to the final position once the threshold is passed
                this.state.stimulus.y = this.state.stimulus.initialY + this.params.stimulusFallDistancePx
            }
        }

        // Update particles
        this.updateParticles()
        this.updateFeedbackBubbles()

        // Advance exit animation timing
        if (this.state.stimulus.exiting) {
            const elapsedTime = this.now() - this.state.stimulus.exitStartTime
            if (elapsedTime >= this.state.stimulus.exitDuration) {
                this.state.stimulus.exiting = false
            }
        }

        // If on a break, handle the sequence
        if (this.state.inBreak) {
            this.updateBreak()
        }
    },

    /**
     * The main draw loop for the level, called on each frame.
     */
    draw: function () {
        // Redraw the canvas on each frame
        this.clearCanvas()
        this.drawBackground()
        this.drawProgressBar()
        this.drawPlayer()
        this.drawStimulus()
        this.drawScoreFeedback()
        this.drawParticles()
        this.drawFeedbackBubbles()
        // If game is done and end overlay is enabled, draw it
        if (this.state.gameState === "done" && this.state.endOverlayVisible && this.state.showContinueButton) {
            this.drawEndOverlay()
        }

        // If on a break, draw the overlay
        if (this.state.inBreak) {
            this.drawBreakOverlay()
        }
    },

    /**
     * Draws the background image.
     */
    drawBackground: function () {
        this.state.ctx.drawImage(this.assets.imgBackground, 0, 0, this.state.canvas.width, this.state.canvas.height)
    },

    /**
     * Draws the progress bar at the top of the screen.
     */
    drawProgressBar: function () {
        const barWidth = this.state.canvas.width * 0.5 // 50% of canvas width
        const barHeight = this.state.canvas.height * 0.033 // 3.3% of canvas height
        const x = this.state.canvas.width / 2 - barWidth / 2
        const y = this.state.canvas.height * 0.033 // 3.3% from the top

        // Draw background bar
        this.state.ctx.fillStyle = "#555"
        this.state.ctx.fillRect(x, y, barWidth, barHeight)

        // Segment setup (3 segments for 3 phases)
        const segWidth = barWidth / 3
        const phaseTargets = this.getPhaseTargets()
        const segScores = [phaseTargets[0], phaseTargets[1], phaseTargets[2]]
        const colors = ["#4CAF50", "#00BCD4", "#2196F3"] // green, cyan, blue

        // Draw each segment according to score progress
        for (let i = 0; i < 3; i++) {
            const segStartScore = i === 0 ? 0 : segScores.slice(0, i).reduce((a, b) => a + b, 0)
            const segEndScore = segStartScore + segScores[i]
            const raw = (this.state.score - segStartScore) / (segEndScore - segStartScore)
            const frac = Math.min(1, Math.max(0, raw))
            if (frac <= 0) continue
            this.state.ctx.fillStyle = colors[i]
            this.state.ctx.fillRect(x + i * segWidth, y, segWidth * frac, barHeight)
        }

        // Border
        this.state.ctx.strokeStyle = "#000"
        this.state.ctx.strokeRect(x, y, barWidth, barHeight)
    },

    /**
     * Draws the score feedback text when a correct response is made.
     */
    drawScoreFeedback: function () {
        if (this.state.scoreTextVisible) {
            const barWidth = this.state.canvas.width * 0.5
            const barHeight = this.state.canvas.height * 0.033
            const barX = this.state.canvas.width / 2 - barWidth / 2
            const barY = this.state.canvas.height * 0.033
            const textX = barX + barWidth + 10 // Position text to the right of the bar
            const textY = barY + barHeight * 0.75

            this.state.ctx.fillStyle = "white"
            this.state.ctx.font = `${this.state.canvas.height * 0.03}px Arial` // Font size relative to canvas height
            this.state.ctx.fillText(this.state.scoreText, textX, textY)
        }
    },

    /**
     * Draws the player sprite.
     */
    drawPlayer: function () {
        this.state.ctx.drawImage(
            this.assets.imgPlayer,
            this.state.player.x,
            this.state.player.y,
            this.state.player.width,
            this.state.player.height
        )
    },

    /**
     * Draws particles for effects like sparkles.
     */
    drawParticles: function () {
        this.state.ctx.save()
        for (const p of this.state.particles) {
            this.state.ctx.fillStyle = p.color
            this.state.ctx.globalAlpha = Math.max(0, p.lifespan / 60) // Fade out
            this.state.ctx.fillRect(p.x, p.y, p.size, p.size)
        }
        this.state.ctx.restore()
    },

    /**
     * Draws feedback bubbles that appear after certain trial outcomes.
     */
    drawFeedbackBubbles: function () {
        this.state.ctx.save()
        for (const bubble of this.state.feedbackBubbles) {
            this.state.ctx.globalAlpha = bubble.opacity
            this.state.ctx.drawImage(bubble.img, bubble.x, bubble.y, bubble.width, bubble.height)
        }
        this.state.ctx.restore()
    },

    /**
     * Draws a break overlay prompting the player to continue.
     */
    drawBreakOverlay: function () {
        const message = "Press SPACE to continue"
        this.state.ctx.save()

        // Create a radial gradient for the tunnel effect, centered on the player
        const playerCenterX = this.state.player.x + this.state.player.width / 2
        const playerCenterY = this.state.player.y + this.state.player.height / 2
        const innerRadius = this.state.player.height * 0.75
        const outerRadius = innerRadius * 2.5

        const gradient = this.state.ctx.createRadialGradient(
            playerCenterX,
            playerCenterY,
            innerRadius,
            playerCenterX,
            playerCenterY,
            outerRadius
        )
        gradient.addColorStop(0, "rgba(0,0,0,0)")
        gradient.addColorStop(1, "rgba(0,0,0,0.85)")

        this.state.ctx.fillStyle = gradient
        this.state.ctx.fillRect(0, 0, this.state.canvas.width, this.state.canvas.height)

        // Draw the text prompt only when the break sequence is ready
        if (this.state.showBreakText) {
            this.state.ctx.fillStyle = "white"
            this.state.ctx.font = `${this.state.canvas.height * 0.053}px Arial` // Font size relative to canvas height
            this.state.ctx.textAlign = "center"
            this.state.ctx.fillText(message, this.state.canvas.width / 2, this.state.canvas.height / 3)
        }
        this.state.ctx.restore()
    },

    /**
     * Draws the end-of-level overlay with a Continue button (when enabled).
     */
    drawEndOverlay: function () {
        const ctx = this.state.ctx
        const canvas = this.state.canvas
        ctx.save()
        // Darken background
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Title and stats
        const centerX = canvas.width / 2
        const centerY = canvas.height / 2
        const rts = this.state.reactionTimes || []
        const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0

        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.font = `${Math.round(canvas.height * 0.06)}px Arial`
        ctx.fillText("Game Over", centerX, centerY - canvas.height * 0.12)
        ctx.font = `${Math.round(canvas.height * 0.035)}px Arial`
        ctx.fillText(`Average RT: ${avg.toFixed(1)} ms`, centerX, centerY - canvas.height * 0.06)

        // Button
        const btnW = Math.round(canvas.width * 0.25)
        const btnH = Math.round(canvas.height * 0.08)
        const btnX = Math.round(centerX - btnW / 2)
        const btnY = Math.round(centerY)
        // Store rect for click detection
        this.state.endButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH }

        // Button style
        ctx.fillStyle = "#2196F3"
        ctx.strokeStyle = "#0b79d0"
        ctx.lineWidth = 2
        ctx.fillRect(btnX, btnY, btnW, btnH)
        ctx.strokeRect(btnX, btnY, btnW, btnH)
        ctx.fillStyle = "#fff"
        ctx.font = `${Math.round(btnH * 0.45)}px Arial`
        ctx.fillText(this.state.continueLabel || "Continue", centerX, btnY + Math.round(btnH * 0.66))
        ctx.restore()
    },

    /**
     * Draws the stimulus if it's visible or animating.
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

                // Interpolate position towards the player's center
                const targetX = playerCenterX - (this.state.stimulus.exitInitialWidth * (1 - progress)) / 2
                const targetY = playerCenterY - (this.state.stimulus.exitInitialHeight * (1 - progress)) / 2
                currentX = this.state.stimulus.exitInitialX + (targetX - this.state.stimulus.exitInitialX) * progress
                currentY = this.state.stimulus.exitInitialY + (targetY - this.state.stimulus.exitInitialY) * progress

                // Interpolate size
                currentWidth = this.state.stimulus.exitInitialWidth * (1 - progress)
                currentHeight = this.state.stimulus.exitInitialHeight * (1 - progress)
            } else if (this.state.stimulus.exitType === "timeout") {
                // Move sideways off the screen
                const exitDistance = this.state.canvas.width / 2
                const direction = this.state.stimulus.exitInitialX > this.state.canvas.width / 2 ? 1 : -1
                currentX = this.state.stimulus.exitInitialX + direction * exitDistance * progress
                // Fade out
                this.state.ctx.globalAlpha = 1 - progress
            }

            this.state.ctx.drawImage(this.assets.imgStimulus, currentX, currentY, currentWidth, currentHeight)
            this.state.ctx.globalAlpha = 1 // Reset alpha
        } else if (this.state.stimulus.visible) {
            this.state.ctx.drawImage(
                this.assets.imgStimulus,
                this.state.stimulus.x,
                this.state.stimulus.y,
                this.state.stimulus.width,
                this.state.stimulus.height
            )
        }
    },

    /**
     * Clears the entire canvas.
     */
    clearCanvas: function () {
        this.state.ctx.clearRect(0, 0, this.state.canvas.width, this.state.canvas.height)
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
            // Prepare stimulus
            this.state.stimulus.x = Math.random() * (this.state.canvas.width - this.state.stimulus.width)
            const maxY = this.state.canvas.height - this.state.stimulus.height - this.params.stimulusFallDistancePx
            this.state.stimulus.y = Math.random() * maxY
            this.state.stimulus.initialY = this.state.stimulus.y // Store the initial Y for the fall animation
            this.state.stimulus.visible = true
            this.state.stimulus.exiting = false
            this.state.startTime = this.now()
            // Count this as a presented trial
            this.state.trials++

            // Set per-trial max RT
            this.state.maxRT = 2 * this.state.medianRT
            if (this.state.currentTrialTimeoutId) {
                clearTimeout(this.state.currentTrialTimeoutId)
            }
            this.state.currentTrialTimeoutId = setTimeout(() => {
                // Timeout: slow (0 points)
                this.state.currentTrialTimeoutId = null
                if (this.state.gameState !== "playing") return
                if (this.state.stimulus.visible) {
                    // Hide stimulus and play TIMEOUT exit animation
                    this.state.stimulus.visible = false
                    this.state.stimulus.exiting = true
                    this.state.stimulus.exitType = "timeout" // Set the exit type
                    this.state.stimulus.exitStartTime = this.now()
                    this.state.stimulus.exitInitialX = this.state.stimulus.x
                    this.state.stimulus.exitInitialY = this.state.stimulus.y
                    this.state.stimulus.exitInitialWidth = this.state.stimulus.width
                    this.state.stimulus.exitInitialHeight = this.state.stimulus.height
                }
                this.finishTrial({
                    type: "timeout",
                    points: 0,
                    includeInMedian: false,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                })
            }, this.state.maxRT)
        }, delay)
    },

    /**
     * Finishes a trial: updates score, counters, checks end, or schedules next trial.
     * @param {{ type: 'fast'|'slow'|'early'|'timeout', points: number, rt?: number, includeInMedian?: boolean, stimulusX?: number, stimulusY?: number }} outcome
     */
    finishTrial: function (outcome) {
        // Update score and show feedback
        this.state.score += outcome.points
        // Clamp score to the current phase floor
        if (typeof this.state.phaseFloorScore === "number") {
            this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        }
        const sign = outcome.points > 0 ? "+" : ""
        this.showScoreFeedback(`${sign}${Math.round(outcome.points)}`)

        // Bubble position - centered above player
        const bubbleX = this.state.player.x + this.state.player.width / 2
        const bubbleY = this.state.player.y

        // Show feedback bubble for slow or timeout trials
        if (outcome.type === "slow") {
            this.showFeedbackBubble("slow", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0 // Reset fast streak
        } else if (outcome.type === "timeout") {
            this.showFeedbackBubble("late", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0 // Reset fast streak
        } else if (outcome.type === "fast") {
            if (this.state.lastTrialType === "fast") {
                if (this.state.lastFastFeedback === 1) {
                    this.showFeedbackBubble("fast2", bubbleX, bubbleY)
                    this.state.lastFastFeedback = 2
                } else if (this.state.lastFastFeedback === 2) {
                    this.showFeedbackBubble("fast3", bubbleX, bubbleY)
                    this.state.lastFastFeedback = 3
                } else {
                    // Includes lastFastFeedback === 3, resetting the cycle
                    this.showFeedbackBubble("fast1", bubbleX, bubbleY)
                    this.state.lastFastFeedback = 1
                }
            } else {
                // Previous trial was not fast
                this.showFeedbackBubble("fast1", bubbleX, bubbleY)
                this.state.lastFastFeedback = 1
            }
        } else {
            // early trial
            this.state.lastFastFeedback = 0 // Reset fast streak
        }

        // Update RT stats if needed
        if (outcome.includeInMedian && typeof outcome.rt === "number") {
            this.state.reactionTimes.push(outcome.rt)
            this.state.medianRT = this.computeMedian(this.state.reactionTimes)
        }

        // Log keypress data
        if (outcome.timestamp) {
            const trialNumber = this.state.trials
            const record = {
                Level: "level 1",
                Phase: this.state.phaseIndex + 1,
                TrialType: outcome.type === "timeout" ? "Timeout" : outcome.type.charAt(0).toUpperCase() + outcome.type.slice(1), // "Fast", "Slow", "Early", or "Timeout"
                Time: outcome.timestamp,
                Trial: trialNumber,
                RT: outcome.type === "early" ? "NA" : outcome.rt,
                Threshold: typeof outcome.thresholdUsed === "number" ? outcome.thresholdUsed : this.getEffectiveThreshold(),
                Score: this.state.score,
                ScoreChange: outcome.points,
            }
            this.state.data.push(record)
        }

        // Update last trial type for streak tracking
        this.state.lastTrialType = outcome.type

        // End of phase or level
        const epsilon = 1e-6
        const currentPhaseTarget = this.ensurePhaseTarget()
        if (this.state.score + epsilon >= this.state.phaseFloorScore + currentPhaseTarget) {
            if (this.state.phaseIndex < 2) {
                this.startPhaseBreak()
                return
            } else {
                // Phase 3 completed
                this.endLevel()
                return
            }
        }

        // Otherwise, start the next trial
        this.startNewTrial()
    },

    /**
     * Compute the total score required to finish the level.
     */
    getTotalScoreRequired: function () {
        // Sum the per-phase targets (using computed ones for past/current phases and estimates for future phases)
        const targets = this.getPhaseTargets()
        const total = targets.reduce((a, b) => a + b, 0)
        return Math.max(1, total)
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

    /**
     * Compute or return the target score for the current phase; computes and stores if missing.
     */
    ensurePhaseTarget: function () {
        if (!this.state.phaseRequiredScores[this.state.phaseIndex] || this.state.phaseRequiredScores[this.state.phaseIndex] <= 0) {
            this.state.phaseRequiredScores[this.state.phaseIndex] = this.computePhaseTarget(this.state.phaseIndex)
        }
        return this.state.phaseRequiredScores[this.state.phaseIndex]
    },

    /**
     * Compute the required score for a given phase index based on remaining trials and an assumed
     * fast-rate. Conservative estimate: assume 50% of the phase's trials will be fast, each worth at least minScore.
     * Enforces a minimum per-phase target = max(minScore, (minTrialsPerPhase/2) * minScore).
     */
    computePhaseTarget: function (phaseIdx) {
        const phasesRemaining = Math.max(1, 3 - phaseIdx)
        const trialsLeft = Math.max(0, this.params.trialsNumber - this.state.trials)
        const trialsThisPhase = Math.ceil(trialsLeft / phasesRemaining)
        const assumedFastRate = 0.5
        const expectedFast = Math.floor(trialsThisPhase * assumedFastRate)
        const estimatedTarget = expectedFast * this.params.minScore
        // Minimum per-phase target
        const minTargetByTrials = (this.params.minTrialsPerPhase / 2) * this.params.minScore
        return Math.max(this.params.minScore, minTargetByTrials, estimatedTarget)
    },

    /**
     * Returns the effective threshold used for fast/slow classification.
     * Threshold = medianRT / gameDifficulty
     */
    getEffectiveThreshold: function () {
        const divisor = this.params.gameDifficulty && this.params.gameDifficulty > 0 ? this.params.gameDifficulty : 1
        return this.state.medianRT / divisor
    },

    /**
     * Manages the timed sequence of events during a phase break.
     */
    updateBreak: function () {
        const now = this.now()
        const elapsed = now - this.state.breakStartTime

        // State 1: Overlay has just appeared. Wait 1s for effects.
        if (this.state.breakState === "started" && elapsed > 1000) {
            // Play evolution sound
            this.assets.soundEvolve.play()

            // Create sparkles around the player
            const playerCenterX = this.state.player.x + this.state.player.width / 2
            const playerCenterY = this.state.player.y + this.state.player.height / 2
            this.createSparkles(playerCenterX, playerCenterY, 50) // Increased count

            // Update player sprite
            if (this.state.phaseIndex === 1) {
                this.assets.imgPlayer = this.assets.imgPlayer2
            } else if (this.state.phaseIndex === 2) {
                this.assets.imgPlayer = this.assets.imgPlayer3
            }

            this.state.breakState = "effects"
        }

        // State 2: Effects are playing. Wait another 1s for the prompt.
        if (this.state.breakState === "effects" && elapsed > 2000) {
            this.state.showBreakText = true
            this.state.breakState = "ready"
        }
    },

    /**
     * Initiates a phase break and waits for SPACE to resume.
     */
    startPhaseBreak: function () {
        // Advance to next phase
        this.state.phaseIndex = Math.min(2, this.state.phaseIndex + 1)
        this.state.inBreak = true
        this.state.breakState = "started"
        this.state.breakStartTime = this.now()
        this.state.showBreakText = false

        // Stop any pending timers and hide stimulus
        if (this.state.pendingStimulusTimeoutId) {
            clearTimeout(this.state.pendingStimulusTimeoutId)
            this.state.pendingStimulusTimeoutId = null
        }
        if (this.state.currentTrialTimeoutId) {
            clearTimeout(this.state.currentTrialTimeoutId)
            this.state.currentTrialTimeoutId = null
        }
        this.state.stimulus.visible = false
        this.state.stimulus.exiting = false

        // Update the phase floor and score immediately
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

    /**
     * Resumes gameplay from a phase break.
     */
    resumeFromBreak: function () {
        if (!this.state.inBreak || this.state.breakState !== "ready") return
        this.state.inBreak = false
        this.state.breakState = "idle"
        // Start next trial
        this.startNewTrial()
    },

    /**
     * Compute median via sort (O(n log n) per update). Simpler and sufficient for small n.
     */
    computeMedian: function (arr) {
        if (!arr || arr.length === 0) return this.state.medianRT
        const sorted = [...arr].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    },

    /**
     * Creates a burst of particles (sparkles) at a specific location.
     * @param {number} x - The starting x-coordinate.
     * @param {number} y - The starting y-coordinate.
     * @param {number} count - The number of particles to create.
     */
    createSparkles: function (x, y, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = Math.random() * 5 + 2 // Increased speed
            this.state.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 4 + 2, // Increased size
                lifespan: Math.random() * 80 + 60, // Increased lifespan
                color: `hsl(${Math.random() * 60}, 100%, 85%)`, // Brighter yellow/gold
            })
        }
    },

    /**
     * Updates the state of all active particles.
     */
    updateParticles: function () {
        for (let i = this.state.particles.length - 1; i >= 0; i--) {
            const p = this.state.particles[i]
            p.x += p.vx
            p.y += p.vy
            p.lifespan--
            if (p.lifespan <= 0) {
                this.state.particles.splice(i, 1)
            }
        }
    },

    /**
     * Updates the state of all active feedback bubbles (e.g., for fading out).
     */
    updateFeedbackBubbles: function () {
        const now = this.now()
        for (let i = this.state.feedbackBubbles.length - 1; i >= 0; i--) {
            const bubble = this.state.feedbackBubbles[i]
            const elapsed = now - bubble.creationTime

            if (elapsed > bubble.lifespan) {
                this.state.feedbackBubbles.splice(i, 1)
            } else {
                // Fade out in the last 500ms
                const fadeDuration = 500
                if (bubble.lifespan - elapsed < fadeDuration) {
                    bubble.opacity = (bubble.lifespan - elapsed) / fadeDuration
                }
            }
        }
    },

    /**
     * Cleanly ends the level, removing listeners and timers and calling the end callback.
     */
    endLevel: function () {
        this.state.gameState = "done"
        document.removeEventListener("keydown", this.boundKeyDownHandler)
        this.assets.soundBackground.pause()
        this.assets.soundBackground.currentTime = 0
        // Clear timers
        if (this.state.pendingStimulusTimeoutId) {
            clearTimeout(this.state.pendingStimulusTimeoutId)
            this.state.pendingStimulusTimeoutId = null
        }
        if (this.state.currentTrialTimeoutId) {
            clearTimeout(this.state.currentTrialTimeoutId)
            this.state.currentTrialTimeoutId = null
        }
        // If configured to show in-game Continue button, draw overlay and wait for click
        if (this.state.showContinueButton) {
            this.state.endOverlayVisible = true
            return
        }
        // Otherwise, end immediately
        this.endGameCallback(this.state.reactionTimes)
    },

    /**
     * Handle clicks for the end overlay button.
     */
    handleClick: function (e) {
        if (!(this.state.gameState === "done" && this.state.endOverlayVisible && this.state.showContinueButton)) return
        const rect = this.state.canvas.getBoundingClientRect()
        const scaleX = this.state.canvas.width / rect.width
        const scaleY = this.state.canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY
        const btn = this.state.endButtonRect
        if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
            // Proceed
            this.state.endOverlayVisible = false
            // Clean click handler to avoid leaks
            if (this.boundClickHandler) {
                this.state.canvas.removeEventListener("click", this.boundClickHandler)
            }
            this.endGameCallback(this.state.reactionTimes)
        }
    },

    /**
     * Makes the player jump with a height proportional to the reaction time.
     * @param {number} reactionTime - The player's reaction time in milliseconds.
     */
    jump: function (reactionTime) {
        if (this.state.player.jumping) return
        this.state.player.jumping = true

        // Clamp the reaction time
        const effectiveRT = Math.min(reactionTime, this.state.maxRT)

        // Linearly interpolate jump strength
        const jumpRange = this.params.maxJumpStrength - this.params.minJumpStrength
        const rtRatio = 1 - effectiveRT / this.state.maxRT
        const jumpPower = this.params.minJumpStrength + jumpRange * rtRatio

        this.state.player.velocityY = jumpPower
    },

    /**
     * Handles the keydown event for player input.
     * @param {KeyboardEvent} e - The keyboard event object.
     */
    handleKeyDown: function (e) {
        // Ignore input unless actively playing
        if (this.state.gameState !== "playing") return

        // During breaks, only SPACE resumes (when ready)
        if (this.state.inBreak) {
            const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar"
            if (isSpace) this.resumeFromBreak()
            return
        }

        if (e.key !== "ArrowDown") return

        // Early press before stimulus
        if (!this.state.stimulus.visible && !this.state.stimulus.exiting) {
            // Cancel pending stimulus
            if (this.state.pendingStimulusTimeoutId) {
                clearTimeout(this.state.pendingStimulusTimeoutId)
                this.state.pendingStimulusTimeoutId = null
            }
            if (this.state.currentTrialTimeoutId) {
                clearTimeout(this.state.currentTrialTimeoutId)
                this.state.currentTrialTimeoutId = null
            }
            // Penalty for early press
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            this.finishTrial({ type: "early", points: -this.params.minScore, includeInMedian: false, timestamp: nowISO, thresholdUsed })
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.now() - this.state.startTime

            // Stop the per-trial timeout
            if (this.state.currentTrialTimeoutId) {
                clearTimeout(this.state.currentTrialTimeoutId)
                this.state.currentTrialTimeoutId = null
            }

            // Prepare exit animation
            this.state.stimulus.visible = false
            this.state.stimulus.exiting = true
            this.state.stimulus.exitType = "catch" // A valid press is always a "catch"
            this.state.stimulus.exitStartTime = this.now()
            this.state.stimulus.exitInitialX = this.state.stimulus.x
            this.state.stimulus.exitInitialY = this.state.stimulus.y
            this.state.stimulus.exitInitialWidth = this.state.stimulus.width
            this.state.stimulus.exitInitialHeight = this.state.stimulus.height

            // Classify and score
            // Determine threshold for fast/slow
            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT

            if (reactionTime > threshold) {
                // Slow trial
                const include = reactionTime <= trialMaxRT
                const nowISO = new Date().toISOString()
                this.finishTrial({
                    type: "slow",
                    points: 0,
                    rt: reactionTime,
                    includeInMedian: include,
                    timestamp: nowISO,
                    thresholdUsed: threshold,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                })
                return
            }

            // Fast trial
            const clampedRT = Math.min(reactionTime, trialMaxRT)
            const nRT = 1 - clampedRT / Math.max(1, trialMaxRT)
            const points = this.params.minScore + nRT * (this.params.maxScore - this.params.minScore)

            // Feedback and jump/sound
            this.assets.soundCorrect.play()
            this.jump(reactionTime)

            const nowISO = new Date().toISOString()
            this.finishTrial({ type: "fast", points, rt: reactionTime, includeInMedian: true, timestamp: nowISO, thresholdUsed: threshold })
        }
    },

    /**
     * Shows a score feedback message for a short duration.
     * @param {string} text - The text to display.
     */
    showScoreFeedback: function (text) {
        this.state.scoreText = text
        this.state.scoreTextVisible = true

        // Clear any existing timeout
        if (this.state.scoreTextTimeout) {
            clearTimeout(this.state.scoreTextTimeout)
        }

        // Set a timeout to hide the text
        this.state.scoreTextTimeout = setTimeout(() => {
            this.state.scoreTextVisible = false
        }, 1000)
    },

    /**
     * Creates a feedback bubble at a specific location.
     * @param {'slow' | 'late' | 'fast1' | 'fast2' | 'fast3'} type - The type of feedback to show.
     * @param {number} x - The center x-coordinate for the bubble's anchor point.
     * @param {number} y - The top y-coordinate for the bubble's anchor point.
     */
    showFeedbackBubble: function (type, x, y) {
        let img
        if (type === "slow") {
            img = this.assets.imgFeedbackSlow
        } else if (type === "late") {
            img = this.assets.imgFeedbackLate
        } else if (type === "fast1") {
            img = this.assets.imgFeedbackFast1
        } else if (type === "fast2") {
            img = this.assets.imgFeedbackFast2
        } else if (type === "fast3") {
            img = this.assets.imgFeedbackFast3
        }

        if (img && img.naturalWidth > 0) {
            const aspectRatio = img.naturalWidth / img.naturalHeight
            const height = this.state.canvas.height * this.params.feedbackBubbleHeight
            const width = height * aspectRatio

            // Center the bubble horizontally and place it above the y-coordinate
            const finalX = x - width / 2
            const finalY = y - height

            this.state.feedbackBubbles.push({
                img: img,
                x: finalX,
                y: finalY,
                width: width,
                height: height,
                creationTime: this.now(),
                lifespan: 1500, // ms
                opacity: 1,
            })
        }
    },
}
