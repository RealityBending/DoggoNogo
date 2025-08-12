/**
 * @file Contains all the logic for level 1 of the game.
 */

const level1 = {
    // Image and audio assets for the level
    imgPlayer: new Image(),
    imgStimulus: new Image(),
    imgBackground: new Image(),
    soundBackground: new Audio(),
    soundCorrect: new Audio(),

    // Game state management
    gameState: "playing", // "playing", "ending"

    // Game state variables
    score: 0,
    scoreMax: 500,
    scoreForCorrect: 0, // Will be calculated at the start of the level
    trials: 0,
    trialsNumber: 5,
    minISI: 1000, // Minimum Inter-Stimulus Interval
    maxISI: 3000, // Maximum Inter-Stimulus Interval
    reactionTimes: [],

    // Player properties
    player: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        velocityY: 0,
        jumping: false,
        originalY: 0,
    },

    // Physics properties for the jump
    gravity: 0.5,
    maxJumpStrength: -7.5, // Jump strength for a 0ms RT
    minJumpStrength: -1, // Jump strength for the slowest RT
    maxRTForJumpBonus: 3000, // RT threshold for minimum jump strength

    // Stimulus properties
    stimulus: {
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        visible: false,
        exiting: false,
        exitDuration: 200, // ms
        exitStartTime: 0,
        exitInitialX: 0,
        exitInitialY: 0,
        exitInitialWidth: 0,
        exitInitialHeight: 0,
    },

    // Timestamp for reaction time calculation
    startTime: 0,

    // Score feedback text
    scoreText: "",
    scoreTextVisible: false,
    scoreTextTimeout: null,

    /**
     * Loads all assets for the level and returns a promise that resolves when loading is complete.
     * @param {HTMLCanvasElement} canvas - The game canvas element.
     * @returns {Promise} - A promise that resolves when all assets are loaded.
     */
    load: function (canvas) {
        // Set asset sources
        this.imgPlayer.src = "assets/level1/player_1.png"
        this.imgStimulus.src = "assets/level1/stimulus.png"
        this.imgBackground.src = "assets/level1/background.png"
        this.soundBackground.src = "assets/level1/sound_background.mp3"
        this.soundCorrect.src = "assets/level1/sound_correct.mp3"

        // Set initial player position
        this.player.x = canvas.width / 2 - 50
        this.player.y = canvas.height / 2 - 50
        this.player.originalY = this.player.y

        // Create a promise that resolves when all assets are loaded
        const assets = [this.imgPlayer, this.imgStimulus, this.imgBackground, this.soundBackground, this.soundCorrect]
        const promises = assets.map((asset) => {
            return new Promise((resolve) => {
                if (asset instanceof HTMLImageElement) {
                    asset.onload = resolve
                } else if (asset instanceof HTMLAudioElement) {
                    asset.oncanplaythrough = resolve
                }
            })
        })

        return Promise.all(promises)
    },

    /**
     * Starts the level, initializes game state, and sets up event listeners.
     * @param {HTMLCanvasElement} canvas - The game canvas element.
     * @param {function} endGameCallback - A callback function to be called when the level is over.
     */
    start: function (canvas, endGameCallback) {
        this.canvas = canvas
        this.ctx = canvas.getContext("2d")
        this.endGameCallback = endGameCallback
        this.score = 0
        this.trials = 0
        this.reactionTimes = []
        this.gameState = "playing"

        // Calculate score per correct response based on max score and trials
        this.scoreForCorrect = this.scoreMax / this.trialsNumber

        // Start background music
        this.soundBackground.loop = true
        this.soundBackground.play()

        // Set up keyboard input handler
        this.boundKeyDownHandler = this.handleKeyDown.bind(this)
        document.addEventListener("keydown", this.boundKeyDownHandler)

        // Start the first trial
        this.startNewTrial()
    },

    /**
     * The main update loop for the level, called on each frame.
     */
    update: function () {
        // Apply gravity to the player if it's jumping
        if (this.player.jumping) {
            this.player.velocityY += this.gravity
            this.player.y += this.player.velocityY

            // Check if the player has landed
            if (this.player.y >= this.player.originalY) {
                this.player.y = this.player.originalY
                this.player.jumping = false
                this.player.velocityY = 0
            }
        }

        // Advance exit animation timing; no end-game logic here (handled immediately on final score)
        if (this.stimulus.exiting) {
            const elapsedTime = Date.now() - this.stimulus.exitStartTime
            if (elapsedTime >= this.stimulus.exitDuration) {
                this.stimulus.exiting = false
            }
        }

        // Redraw the canvas on each frame
        this.clearCanvas()
        this.drawBackground()
        this.drawProgressBar()
        this.drawPlayer()
        this.drawStimulus()
        this.drawScoreFeedback()
    },

    /**
     * Draws the background image.
     */
    drawBackground: function () {
        this.ctx.drawImage(this.imgBackground, 0, 0, this.canvas.width, this.canvas.height)
    },

    /**
     * Draws the progress bar at the top of the screen.
     */
    drawProgressBar: function () {
        const barWidth = this.canvas.width / 2
        const barHeight = 20
        const x = this.canvas.width / 4
        const y = 20
        const progress = this.score / this.scoreMax

        // Draw the background of the progress bar
        this.ctx.fillStyle = "#555"
        this.ctx.fillRect(x, y, barWidth, barHeight)

        // Draw the filled portion of the progress bar
        this.ctx.fillStyle = "#2ecc71"
        this.ctx.fillRect(x, y, barWidth * progress, barHeight)

        // Draw the border of the progress bar
        this.ctx.strokeStyle = "#000"
        this.ctx.strokeRect(x, y, barWidth, barHeight)
    },

    /**
     * Draws the score feedback text when a correct response is made.
     */
    drawScoreFeedback: function () {
        if (this.scoreTextVisible) {
            const barX = this.canvas.width / 4
            const barY = 20
            const barWidth = this.canvas.width / 2
            const textX = barX + barWidth + 10 // Position text to the right of the bar
            const textY = barY + 15

            this.ctx.fillStyle = "white"
            this.ctx.font = "20px Arial"
            this.ctx.fillText(this.scoreText, textX, textY)
        }
    },

    /**
     * Draws the player sprite.
     */
    drawPlayer: function () {
        this.ctx.drawImage(this.imgPlayer, this.player.x, this.player.y, this.player.width, this.player.height)
    },

    /**
     * Draws the stimulus if it's visible or animating.
     */
    drawStimulus: function () {
        if (this.stimulus.exiting) {
            const elapsedTime = Date.now() - this.stimulus.exitStartTime
            const progress = Math.min(elapsedTime / this.stimulus.exitDuration, 1)

            const playerCenterX = this.player.x + this.player.width / 2
            const playerCenterY = this.player.y + this.player.height / 2

            // Interpolate position towards the player's center
            const targetX = playerCenterX - (this.stimulus.exitInitialWidth * (1 - progress)) / 2
            const targetY = playerCenterY - (this.stimulus.exitInitialHeight * (1 - progress)) / 2
            const currentX = this.stimulus.exitInitialX + (targetX - this.stimulus.exitInitialX) * progress
            const currentY = this.stimulus.exitInitialY + (targetY - this.stimulus.exitInitialY) * progress

            // Interpolate size
            const currentWidth = this.stimulus.exitInitialWidth * (1 - progress)
            const currentHeight = this.stimulus.exitInitialHeight * (1 - progress)

            this.ctx.drawImage(this.imgStimulus, currentX, currentY, currentWidth, currentHeight)
        } else if (this.stimulus.visible) {
            this.ctx.drawImage(this.imgStimulus, this.stimulus.x, this.stimulus.y, this.stimulus.width, this.stimulus.height)
        }
    },

    /**
     * Clears the entire canvas.
     */
    clearCanvas: function () {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    },

    /**
     * Starts a new trial by scheduling the next stimulus appearance.
     */
    startNewTrial: function () {
        const delay = Math.random() * (this.maxISI - this.minISI) + this.minISI
        setTimeout(() => {
            this.stimulus.width = 50 // Reset size
            this.stimulus.height = 50
            this.stimulus.x = Math.random() * (this.canvas.width - this.stimulus.width)
            this.stimulus.y = Math.random() * (this.canvas.height - this.stimulus.height)
            this.stimulus.visible = true
            this.stimulus.exiting = false
            this.startTime = Date.now()
        }, delay)
    },

    /**
     * Makes the player jump with a height proportional to the reaction time.
     * @param {number} reactionTime - The player's reaction time in milliseconds.
     */
    jump: function (reactionTime) {
        if (this.player.jumping) return
        this.player.jumping = true

        // Clamp the reaction time to the max RT for bonus
        const effectiveRT = Math.min(reactionTime, this.maxRTForJumpBonus)

        // Linearly interpolate jump strength based on reaction time
        const jumpRange = this.maxJumpStrength - this.minJumpStrength
        const rtRatio = 1 - effectiveRT / this.maxRTForJumpBonus
        const jumpPower = this.minJumpStrength + jumpRange * rtRatio

        this.player.velocityY = jumpPower
    },

    /**
     * Handles the keydown event for player input.
     * @param {KeyboardEvent} e - The keyboard event object.
     */
    handleKeyDown: function (e) {
        // Ignore input unless actively playing
        if (this.gameState !== "playing") return
        if (e.key === "ArrowDown" && this.stimulus.visible && !this.stimulus.exiting) {
            const reactionTime = Date.now() - this.startTime
            this.reactionTimes.push(reactionTime)
            this.score += this.scoreForCorrect
            this.trials++

            this.showScoreFeedback(`+${Math.round(this.scoreForCorrect)}`)
            this.soundCorrect.play()
            this.jump(reactionTime)

            // Check if this was the final response (rely on score only)
            const epsilon = 1e-6
            const reachedscoreMax = this.score + epsilon >= this.scoreMax
            if (reachedscoreMax) {
                // Immediately end: stop input and audio, go to score screen now
                this.gameState = "ending"
                document.removeEventListener("keydown", this.boundKeyDownHandler)
                this.soundBackground.pause()
                this.soundBackground.currentTime = 0
                this.endGameCallback(this.reactionTimes)
                return
            }

            // Not final: play exit animation and schedule next trial (ISI starts now)
            this.stimulus.visible = false
            this.stimulus.exiting = true
            this.stimulus.exitStartTime = Date.now()
            this.stimulus.exitInitialX = this.stimulus.x
            this.stimulus.exitInitialY = this.stimulus.y
            this.stimulus.exitInitialWidth = this.stimulus.width
            this.stimulus.exitInitialHeight = this.stimulus.height

            this.startNewTrial()
        }
    },

    /**
     * Shows a score feedback message for a short duration.
     * @param {string} text - The text to display.
     */
    showScoreFeedback: function (text) {
        this.scoreText = text
        this.scoreTextVisible = true

        // Clear any existing timeout
        if (this.scoreTextTimeout) {
            clearTimeout(this.scoreTextTimeout)
        }

        // Set a timeout to hide the text after 1 second
        this.scoreTextTimeout = setTimeout(() => {
            this.scoreTextVisible = false
        }, 1000)
    },
}
