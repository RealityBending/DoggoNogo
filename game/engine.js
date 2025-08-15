/**
 * @file A centralized game engine to manage the game loop, state, and rendering.
 * This engine is designed to be used by both the standalone and jsPsych versions of the game.
 */

;(function (global) {
    const GameEngine = {
        /**
         * Runs a game level.
         * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
         * @param {object} level - The level object (e.g., level1).
         * @param {object} [options] - Configuration options.
         * @param {function} [options.onFinish] - Callback when the game is over.
         * @param {object} [options.levelParams] - Parameters to override in the level.
         * @returns {Promise<void>}
         */
        run: async function (canvas, level, options = {}) {
            const { onFinish, levelParams, introSequence, skipCover } = options
            this.canvas = canvas
            this.ctx = canvas.getContext("2d")
            this.level = level
            this.animationFrameId = null

            // Override level parameters if provided
            if (levelParams) {
                Object.assign(this.level.params, levelParams)
            }

            // Show loading screen
            if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showLoading) {
                DoggoNogoUI.showLoading(this.canvas)
            }

            try {
                // 1. Load assets
                await this.level.load(this.canvas, { assetBasePath: options.assetBasePath })

                // 1.5 Cover screen (optional skip for chained levels)
                if (!skipCover) {
                    await this.showCoverScreen()
                }

                // Run intro if it exists (now after a user interaction)
                if (introSequence && typeof IntroRunner !== "undefined") {
                    // Ensure intro-specific assets are loaded
                    if (typeof DoggoNogoIntroAssets !== "undefined") {
                        try {
                            await DoggoNogoIntroAssets.load(options.assetBasePath)
                        } catch (e) {
                            console.warn("Intro assets failed to load", e)
                        }
                    }
                    const mergedAssets = Object.assign(
                        {},
                        this.level.assets,
                        typeof DoggoNogoIntroAssets !== "undefined" ? DoggoNogoIntroAssets : {}
                    )
                    await IntroRunner.run(this.canvas, introSequence, mergedAssets)
                }

                // 2. Show instruction screen and wait for user to start
                if (this.level.showInstructionScreen) {
                    this.level.showInstructionScreen(this.canvas)
                } else {
                    // Fallback for levels without an instruction screen
                    console.warn("Level does not have a .showInstructionScreen() method.")
                    // Optionally draw a generic "Ready?" screen
                    const ctx = this.canvas.getContext("2d")
                    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                    ctx.textAlign = "center"
                    ctx.fillStyle = "black"
                    ctx.font = "30px Arial"
                    ctx.fillText("Ready?", this.canvas.width / 2, this.canvas.height / 2)
                }

                // Start background music here so it plays during instruction screen
                const bg = this.level.assets.soundBackground
                if (bg) {
                    try {
                        bg.loop = true
                        if (bg.paused) bg.play()
                    } catch (e) {
                        console.warn("Background music failed to start early", e)
                    }
                }

                await this.waitForStart()

                // 3. Start the level and the game loop
                this.level.start(this.canvas, (state) => {
                    // This is the endGameCallback from the level
                    this.stop()
                    if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showScoreScreen) {
                        // Population parameters for IES Z-scoring from level parameters
                        const populationMean = this.level.params.populationMean || 300
                        const populationSD = this.level.params.populationSD || 20

                        //  Compute Inverse Efficiency Score (IES)
                        const correctTrials = state.data.filter((d) => d.Error === 0 && d.RT !== "NA")
                        const meanRT = correctTrials.length
                            ? correctTrials.map((d) => d.RT).reduce((a, b) => a + b, 0) / correctTrials.length
                            : 0
                        const errorRate = state.data.length > 0 ? state.data.filter((d) => d.Error === 1).length / state.data.length : 0
                        const ies = errorRate < 1 ? meanRT / (1 - errorRate) : meanRT // Avoid division by zero

                        // Z-transform the IES
                        const zIES = (ies - populationMean) / populationSD

                        // Convert Z-score to quantile
                        const quantile = DoggoNogoUI.zScoreToQuantile(zIES)

                        DoggoNogoUI.showScoreScreen(this.canvas, quantile, {
                            hint: options.continueHint,
                            playerSprite: this.level.assets.imgPlayer3 || this.level.assets.imgPlayer,
                        })
                    }
                    if (onFinish) {
                        onFinish(this.level.state)
                    }
                })

                this.loop()
            } catch (error) {
                console.error("Error during game execution:", error)
                // Optionally, display an error message on the canvas
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                this.ctx.fillStyle = "red"
                this.ctx.textAlign = "center"
                this.ctx.fillText("An error occurred. See console for details.", this.canvas.width / 2, this.canvas.height / 2)
            }
        },

        /**
         * Waits for the player to press the down arrow to start the game.
         * @returns {Promise<void>}
         */
        waitForStart: function () {
            return new Promise((resolve) => {
                const startHandler = (e) => {
                    if (e.key === "ArrowDown") {
                        document.removeEventListener("keydown", startHandler)
                        resolve()
                    }
                }
                document.addEventListener("keydown", startHandler)
            })
        },

        /**
         * The main game loop.
         */
        loop: function () {
            this.level.update()
            this.level.draw() // Separated draw call
            this.animationFrameId = requestAnimationFrame(this.loop.bind(this))
        },

        /**
         * Stops the game loop.
         */
        stop: function () {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId)
                this.animationFrameId = null
            }
        },
    }

    /**
     * Displays a cover screen (if cover assets loaded) and waits for SPACE key.
     * Ensures at least one user interaction before attempting to play intro audio.
     */
    GameEngine.showCoverScreen = function () {
        return new Promise((resolve) => {
            const cover = this.level.assets.imgCover
            const coverText = this.level.assets.imgCoverText
            const ctx = this.ctx
            let alpha = 0
            const fadeDuration = 800 // ms
            let startTs = null
            let finished = false

            const draw = (ts) => {
                if (finished) return
                if (!startTs) startTs = ts
                const progress = Math.min(1, (ts - startTs) / fadeDuration)
                alpha = progress
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
                // Background cover image
                if (cover && cover.complete) {
                    ctx.drawImage(cover, 0, 0, this.canvas.width, this.canvas.height)
                } else {
                    ctx.fillStyle = "black"
                    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
                }
                // Fading text image
                if (coverText && coverText.complete) {
                    ctx.save()
                    ctx.globalAlpha = alpha
                    ctx.drawImage(coverText, 0, 0, this.canvas.width, this.canvas.height)
                    ctx.restore()
                }
                // Prompt (shows when fade nearly done)
                if (progress > 0.85) {
                    ctx.textAlign = "center"
                    const scale = (this.canvas.width / 1792 + this.canvas.height / 1024) / 2
                    ctx.font = `${Math.round(28 * scale)}px Arial`
                    ctx.fillStyle = "white"
                    ctx.fillText("Press SPACE to start the game", this.canvas.width / 2, this.canvas.height * 0.9)
                }
                if (!finished) requestAnimationFrame(draw)
            }
            requestAnimationFrame(draw)

            const handler = (e) => {
                if (e.code === "Space") {
                    finished = true
                    document.removeEventListener("keydown", handler)
                    resolve()
                }
            }
            document.addEventListener("keydown", handler)
        })
    }

    global.DoggoNogoEngine = GameEngine
})(typeof window !== "undefined" ? window : globalThis)
