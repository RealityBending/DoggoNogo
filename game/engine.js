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
            const { onFinish, levelParams, introSequence, skipCover, suppressLoading } = options
            this.canvas = canvas
            this.ctx = canvas.getContext("2d")
            this.level = level
            this.animationFrameId = null

            // Override level parameters if provided
            if (levelParams) {
                Object.assign(this.level.params, levelParams)
            }

            // Show loading screen only if level not yet preloaded
            if (!this.level._loaded && !suppressLoading) {
                if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showLoading) {
                    DoggoNogoUI.showLoading(this.canvas)
                }
            }

            try {
                // 1. Load assets (skip if already preloaded)
                if (!this.level._loaded) {
                    await this.level.load(this.canvas, { assetBasePath: options.assetBasePath })
                    this.level._loaded = true
                }

                // Attach a resize listener that, after host resizes canvas, lets the level recompute layout.
                // Host page is responsible for updating canvas width/height & devicePixelRatio transform.
                if (!this._boundResizeHandler) {
                    this._boundResizeHandler = () => {
                        if (this.level && typeof this.level.handleResize === "function") {
                            this.level.handleResize()
                        }
                    }
                    window.addEventListener("resize", this._boundResizeHandler)
                }

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
                    await IntroRunner.run(this.canvas, introSequence, mergedAssets, { assetBasePath: options.assetBasePath || "" })
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

                        // Persist metrics & parameter snapshot onto level state for downstream data collection
                        try {
                            this.level.state.performance = {
                                meanRT,
                                errorRate,
                                ies,
                                zIES,
                                quantile,
                            }
                            this.level.state.gameParams = {
                                trialsNumber: this.level.params.trialsNumber,
                                minTrialsPerPhase: this.level.params.minTrialsPerPhase,
                                gameDifficulty: this.level.params.gameDifficulty,
                                populationMean: this.level.params.populationMean,
                                populationSD: this.level.params.populationSD,
                                minScore: this.level.params.minScore,
                                maxScore: this.level.params.maxScore,
                                // Level 2 conflict proportions (present only if defined on level.params)
                                neutralProportionPhase2: this.level.params.neutralProportionPhase2,
                                incongruentProportionPhase3: this.level.params.incongruentProportionPhase3,
                            }
                        } catch (e) {
                            console.warn("Failed to attach performance snapshot", e)
                        }

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
                const levelName = (this.level && this.level.name) || ""
                const isLevel2 = /level ?2/i.test(levelName) || (this.level && this.level === window.level2)
                const startHandler = (e) => {
                    if ((!isLevel2 && e.key === "ArrowDown") || (isLevel2 && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) {
                        document.removeEventListener("keydown", startHandler)
                        // Play start sound if available on the level assets
                        if (this.level && this.level.assets && this.level.assets.soundStart) {
                            try {
                                this.level.assets.soundStart.currentTime = 0
                                this.level.assets.soundStart.play()
                            } catch (e2) {}
                        }
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
            if (this._boundResizeHandler) {
                window.removeEventListener("resize", this._boundResizeHandler)
                this._boundResizeHandler = null
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
