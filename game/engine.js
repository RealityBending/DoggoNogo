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
            const {
                onFinish,
                levelParams,
                introSequence,
                skipCover,
                // After loading the requested level, also proactively load any other known level objects (level1/level2/etc.)
                // so subsequent transitions have zero load time or flashes.
                preloadOtherLevels = true,
                // Marker (formerly photodiode) visual trigger options (optional; defaults disabled)
                markerEnabled = false,
                markerFlashDuration = 100, // ms the square turns black after a trigger
                markerSize = 60, // px square size
                markerTriggerMode = "stimulus", // 'stimulus' | 'keypress'
                fullscreen = false, // if true, resize canvas to window inner size (CSS/layout fullscreen, not browser Fullscreen API)
            } = options
            this.canvas = canvas
            this.ctx = canvas.getContext("2d")
            this.level = level
            this.animationFrameId = null
            // Marker indicator state (used for external physiological synchronization via photosensor)
            this._marker = {
                enabled: !!markerEnabled,
                flashUntil: 0,
                flashDuration: markerFlashDuration,
                size: markerSize,
                // Set when gameplay actually starts to avoid instruction-screen noise (optional design choice)
                active: false,
            }

            // Override level parameters if provided
            if (levelParams) {
                Object.assign(this.level.params, levelParams)
            }

            // Always show unified loading screen only if this level not yet loaded AND global preload will run now.
            if (!this.level._loaded && !global.__DoggoGlobalPreloaded) {
                if (typeof DoggoNogoCore !== "undefined" && DoggoNogoCore.renderLoadingScreen) {
                    DoggoNogoCore.renderLoadingScreen(this.canvas, "Loading the game...")
                } else if (typeof DoggoNogoUI !== "undefined" && DoggoNogoUI.showLoading) {
                    DoggoNogoUI.showLoading(this.canvas, "Loading the game...")
                }
            }

            try {
                // 0. One-time global asset preload (merged manifest) so host (jsPsych/standalone) need not orchestrate.
                if (!global.__DoggoGlobalPreloaded && typeof DoggoNogoCore !== "undefined" && DoggoNogoCore.preloadAll) {
                    try {
                        await DoggoNogoCore.preloadAll({ basePath: options.assetBasePath })
                    } catch (e) {
                        console.warn("Global preloadAll failed (continuing):", e)
                    }
                    global.__DoggoGlobalPreloaded = true
                }

                // 1. Level-specific assets (skip if already loaded externally)
                if (!this.level._loaded) {
                    await this.level.load(this.canvas, { assetBasePath: options.assetBasePath })
                    this.level._loaded = true
                }

                // 1b. Background preload of other defined levels (one-time) so later starts are instantaneous.
                if (preloadOtherLevels && !global.__DoggoOtherLevelsPreloaded) {
                    try {
                        const candidates = []
                        if (global.level1 && global.level1 !== this.level && !global.level1._loaded) candidates.push(global.level1)
                        if (global.level2 && global.level2 !== this.level && !global.level2._loaded) candidates.push(global.level2)
                        // Future levels could be appended here.
                        if (candidates.length) {
                            await Promise.all(
                                candidates.map((lvl) =>
                                    lvl
                                        .load(this.canvas, { assetBasePath: options.assetBasePath })
                                        .then(() => (lvl._loaded = true))
                                        .catch((e) => console.warn("Background level preload failed", e))
                                )
                            )
                        }
                    } catch (e) {
                        console.warn("Background preload exception", e)
                    }
                    global.__DoggoOtherLevelsPreloaded = true
                }

                // Optionally expand canvas to current viewport size (one-time here; resize listener can adjust later)
                if (fullscreen) {
                    this._applyViewportFullscreenStyles()
                    this._resizeCanvasToViewport()
                }

                // Attach a resize listener that, after host resizes canvas, lets the level recompute layout.
                // Host page is responsible for updating canvas width/height & devicePixelRatio transform.
                if (!this._boundResizeHandler) {
                    this._boundResizeHandler = () => {
                        if (fullscreen) {
                            this._resizeCanvasToViewport()
                        }
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
                // Activate marker after participant starts (so pre-start keys don't flash if desired)
                if (this._marker && this._marker.enabled) {
                    this._marker.active = true
                    // Optional keypress trigger mode retained for compatibility
                    if (markerTriggerMode === "keypress" && !this._boundMarkerKeyHandler) {
                        this._boundMarkerKeyHandler = (e) => {
                            if (!this._marker.enabled || !this._marker.active) return
                            if (!this.level || !this.level.state || this.level.state.gameState !== "playing") return
                            let isResp = false
                            if (typeof this.level.isResponseKey === "function") {
                                try {
                                    isResp = this.level.isResponseKey(e.key)
                                } catch (_) {}
                            } else {
                                isResp = ["ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
                            }
                            if (!isResp) return
                            this.flashMarker()
                        }
                        document.addEventListener("keydown", this._boundMarkerKeyHandler, true)
                    }
                }

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
        /** Public helper for levels to trigger the marker flash (e.g., on stimulus onset). */
        flashMarker: function () {
            if (!this._marker || !this._marker.enabled || !this._marker.active) return
            const nowTs = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
            this._marker.flashUntil = nowTs + this._marker.flashDuration
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
            // Overlay marker square last so it's never occluded
            if (this._marker && this._marker.enabled) {
                this.drawMarkerIndicator()
            }
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
            if (this._boundMarkerKeyHandler) {
                document.removeEventListener("keydown", this._boundMarkerKeyHandler, true)
                this._boundMarkerKeyHandler = null
            }
            if (this._injectedFullscreenStyleEl) {
                try {
                    this._injectedFullscreenStyleEl.remove()
                } catch (_) {}
                this._injectedFullscreenStyleEl = null
                // Restore overflow auto in case we hid scrollbars
                document.documentElement.style.overflow = this._prevHtmlOverflow || ""
                document.body.style.overflow = this._prevBodyOverflow || ""
                document.body.style.margin = this._prevBodyMargin || ""
            }
        },
        /**
         * Draw a persistent white square that flashes black briefly after response key presses.
         * Positioned at top-left corner (0,0) to align with a photosensor.
         */
        drawMarkerIndicator: function () {
            if (!this._marker || !this._marker.enabled) return
            const sz = this._marker.size || 60
            const nowTs = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
            const isBlack = nowTs < this._marker.flashUntil
            this.ctx.save()
            this.ctx.fillStyle = isBlack ? "#000" : "#FFF"
            this.ctx.fillRect(0, 0, sz, sz)
            this.ctx.restore()
        },
        _applyViewportFullscreenStyles: function () {
            if (this._injectedFullscreenStyleEl) return
            // Save previous styles to restore later
            this._prevHtmlOverflow = document.documentElement.style.overflow
            this._prevBodyOverflow = document.body.style.overflow
            this._prevBodyMargin = document.body.style.margin
            // Inject minimal reset ensuring canvas can exactly match viewport without scrollbars
            const styleEl = document.createElement("style")
            styleEl.setAttribute("data-doggo-fullscreen", "")
            styleEl.textContent = `html,body{margin:0;padding:0;overflow:hidden;height:100%;}canvas#gameCanvas{display:block;margin:0;}`
            document.head.appendChild(styleEl)
            this._injectedFullscreenStyleEl = styleEl
        },
        _resizeCanvasToViewport: function () {
            if (!this.canvas) return
            const w = document.documentElement.clientWidth || window.innerWidth
            const h = document.documentElement.clientHeight || window.innerHeight
            this.canvas.width = w
            this.canvas.height = h
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
