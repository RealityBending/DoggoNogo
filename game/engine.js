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
            const { onFinish, levelParams } = options
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

                // 2. Show start screen and wait for user to start
                if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showStartScreen) {
                    DoggoNogoUI.showStartScreen(this.canvas)
                }

                await this.waitForStart()

                // 3. Start the level and the game loop
                this.level.start(this.canvas, (scores) => {
                    // This is the endGameCallback from the level
                    this.stop()
                    if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showScoreScreen) {
                        DoggoNogoUI.showScoreScreen(this.canvas, scores, {
                            hint: options.continueHint,
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

    global.DoggoNogoEngine = GameEngine
})(typeof window !== "undefined" ? window : globalThis)
