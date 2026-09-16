/**
 * @file A centralized game engine to manage the game loop, state, and rendering.
 * This engine is designed to be used by both the standalone and jsPsych versions of the game.
 */

import { DoggoNogoCore, DoggoNogoUI } from "./game.js"
import { CutsceneRunner, DoggoNogoCutsceneAssets } from "./cutscene.js"

// One-time preload flags, shared by every run in the page.
let globalPreloaded = false
let otherLevelsPreloaded = false

export const DoggoNogoEngine = {
    /**
     * Runs a game level.
     * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
     * @param {object} level - The level object (e.g., level1).
     * @param {object} [options] - Configuration options.
     * @param {function} [options.onFinish] - Callback when the game is over.
     * @param {object} [options.levelParams] - Parameters to override in the level.
     * @param {object[]} [options.otherLevels] - Levels to preload in the background after this one.
     * @param {object} [options.jsPsych] - Host jsPsych instance; shares its clock with the level.
     * @returns {Promise<void>}
     */
    run: async function (canvas, level, options = {}) {
        const {
            onFinish,
            levelParams,
            cutscene,
            skipCover,
            // Levels to load in the background once this one is ready, so later transitions
            // have zero load time or flashes.
            otherLevels = [],
            // Host jsPsych instance, when embedded; gives the level a shared time source.
            jsPsych = null,
            // Marker (formerly photodiode) visual trigger options (optional; defaults disabled)
            markerEnabled = false,
            markerFlashDuration = 100, // ms the square turns black after a trigger
            markerSize = 60, // px square size
            fullscreen = false, // if true, resize canvas to window inner size (CSS/layout fullscreen, not browser Fullscreen API)
        } = options
        this.canvas = canvas
        this.ctx = canvas.getContext("2d")
        this.level = level
        // Whether the cover screen's SPACE press should request browser fullscreen.
        this._browserFullscreen = !!options.browserFullscreen
        // A data button from a previous level's end screen must not survive into this one.
        this._removeDataButton()
        this.level.jsPsych = jsPsych
        // Levels trigger the marker through this hook rather than reaching for the engine.
        this.level.flashMarker = () => this.flashMarker()
        this.animationFrameId = null
        // The previous level's score animation may still be in flight if the player pressed
        // "continue" before it finished; left alone it repaints over this level's cutscene.
        DoggoNogoUI.cancelScoreScreen()
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

        // The loading screen stays up for the whole load, so a slow asset never looks like a hang.
        const showLoading = (message, progress) => DoggoNogoCore.renderLoadingScreen(this.canvas, message, progress)
        if (!this.level._loaded) showLoading("Loading the game...", 0)

        try {
            // 0. One-time global asset preload (merged manifest) so host (jsPsych/standalone) need not orchestrate.
            if (!globalPreloaded) {
                try {
                    await DoggoNogoCore.preloadAll({
                        basePath: options.assetBasePath,
                        onProgress: (done, total) => showLoading("Loading the game...", total ? done / total : 0),
                    })
                } catch (e) {
                    console.warn("Global preloadAll failed (continuing):", e)
                }
                globalPreloaded = true
            }

            // 1. Level-specific assets (skip if already loaded externally)
            if (!this.level._loaded) {
                await this.level.load(this.canvas, {
                    assetBasePath: options.assetBasePath,
                    onProgress: (done, total) => showLoading("Loading the game...", total ? done / total : 1),
                })
                this.level._loaded = true
            }

            // 1b. Background preload of other defined levels (one-time) so later starts are instantaneous.
            if (otherLevels.length && !otherLevelsPreloaded) {
                try {
                    const candidates = otherLevels.filter((lvl) => lvl && lvl !== this.level && !lvl._loaded)
                    if (candidates.length) {
                        // Keep the progress bar moving: these assets are part of the same wait.
                        const counts = candidates.map(() => ({ done: 0, total: 0 }))
                        const reportCombined = () => {
                            const done = counts.reduce((a, c) => a + c.done, 0)
                            const total = counts.reduce((a, c) => a + c.total, 0)
                            showLoading("Loading the next level...", total ? done / total : 0)
                        }
                        await Promise.all(
                            candidates.map((lvl, i) =>
                                lvl
                                    .load(this.canvas, {
                                        assetBasePath: options.assetBasePath,
                                        onProgress: (done, total) => {
                                            counts[i] = { done, total }
                                            reportCombined()
                                        },
                                    })
                                    .then(() => (lvl._loaded = true))
                                    .catch((e) => console.warn("Background level preload failed", e)),
                            ),
                        )
                    }
                } catch (e) {
                    console.warn("Background preload exception", e)
                }
                otherLevelsPreloaded = true
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

            // Run the cutscene if it exists (now after a user interaction)
            if (cutscene) {
                // Ensure cutscene-specific assets are loaded
                try {
                    await DoggoNogoCutsceneAssets.load(options.assetBasePath)
                } catch (e) {
                    console.warn("Cutscene assets failed to load", e)
                }
                const mergedAssets = Object.assign(
                    {},
                    this.level.assets,
                    DoggoNogoCutsceneAssets,
                )
                await CutsceneRunner.run(this.canvas, cutscene, mergedAssets, { assetBasePath: options.assetBasePath || "" })
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

            // Start background music here so it plays during the instruction screen. This call sits in a
            // promise continuation, not a user gesture, so it is the one the autoplay policy can refuse;
            // `startBackgroundMusic` catches that and re-arms it (the start keypress below also retries).
            DoggoNogoCore.startBackgroundMusic(this.level.assets.soundBackground)

            await this.waitForStart()
            // Activate marker after participant starts (so pre-start keys don't flash if desired)
            if (this._marker && this._marker.enabled) this._marker.active = true

            // 3. Start the level and the game loop
            this.level.start(this.canvas, (state) => {
                // This is the endGameCallback from the level
                this.stop()
                if (DoggoNogoUI.showScoreScreen) {
                    // Compute the end-of-level performance summary (IES -> Z -> percentile).
                    const { meanRT, errorRate, ies, zIES, quantile } = DoggoNogoCore.computeIES(state.data, {
                        populationMean: this.level.params.populationMean,
                        populationSD: this.level.params.populationSD,
                    })

                    // Persist metrics & parameter snapshot onto level state for downstream data collection
                    try {
                        this.level.state.performance = {
                            meanRT,
                            errorRate,
                            ies,
                            zIES,
                            quantile,
                            totalScore: state.score ?? null,
                            trialsPresented: state.trials ?? null,
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
                    // TEMPORARY (data inspection): button to open the recorded data as JSON.
                    this._showDataButton()
                }
                if (onFinish) {
                    onFinish(this.level.state)
                }
            })

            this.loop()
        } catch (error) {
            console.error("Error during game execution:", error)
            this.drawErrorScreen(error)
        }
    },
    /** Paints a readable failure screen; the console carries the detail. */
    drawErrorScreen: function (error) {
        const ctx = this.ctx
        const w = this.canvas.width
        const h = this.canvas.height
        const detail = (error && error.message) || String(error || "Unknown error")
        const theme = DoggoNogoUI.theme
        ctx.save()
        const bg = ctx.createLinearGradient(0, 0, 0, h)
        bg.addColorStop(0, theme.bgMid)
        bg.addColorStop(1, theme.bgDeep)
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        ctx.textAlign = "center"
        ctx.fillStyle = theme.bad
        ctx.font = `700 ${Math.round(h * 0.045)}px ${theme.display}`
        ctx.fillText("The game could not start.", w / 2, h * 0.42)
        ctx.fillStyle = theme.ink
        ctx.font = `${Math.round(h * 0.028)}px ${theme.font}`
        ctx.fillText(detail, w / 2, h * 0.52)
        ctx.fillStyle = theme.inkFaint
        ctx.font = `${Math.round(h * 0.022)}px ${theme.font}`
        ctx.fillText("See the browser console for details.", w / 2, h * 0.6)
        ctx.restore()
    },

    /**
     * TEMPORARY (data inspection): overlays a small button on the end-of-level score screen
     * that opens the recorded data log (plus performance summary and game params) as JSON in
     * a new tab. Remove once the data schema is settled.
     */
    _showDataButton: function () {
        this._removeDataButton()
        if (typeof document === "undefined") return
        const btn = document.createElement("button")
        btn.textContent = "{ } View data (JSON)"
        const rect = this.canvas.getBoundingClientRect()
        Object.assign(btn.style, {
            position: "fixed",
            top: `${Math.round(rect.top + 14)}px`,
            right: `${Math.round(Math.max(8, window.innerWidth - rect.right) + 14)}px`,
            zIndex: "9999",
            padding: "8px 14px",
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(9,13,25,0.85)",
            color: "#ffc857",
            font: "600 13px 'Segoe UI', Arial, sans-serif",
            cursor: "pointer",
        })
        btn.addEventListener("click", () => {
            const state = this.level && this.level.state ? this.level.state : {}
            const payload = {
                level: state.data && state.data[0] ? state.data[0].Level : null,
                performance: state.performance || null,
                gameParams: state.gameParams || null,
                data: state.data || [],
            }
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            // New tab when the environment allows it; otherwise (popup blocked / embedded
            // viewer) fall back to downloading the file.
            const win = window.open(url, "_blank")
            if (!win) {
                const a = document.createElement("a")
                a.href = url
                a.download = "doggonogo_data.json"
                a.click()
            }
        })
        document.body.appendChild(btn)
        this._dataButton = btn
    },

    _removeDataButton: function () {
        if (this._dataButton) {
            try {
                this._dataButton.remove()
            } catch (e) {
                console.debug("Failed to remove data button", e)
            }
            this._dataButton = null
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
            const startKeys = (this.level && this.level.startKeys) || ["ArrowDown"]
            const startHandler = (e) => {
                if (startKeys.indexOf(e.key) !== -1) {
                    e.preventDefault() // arrow keys would otherwise scroll the page under the canvas
                    document.removeEventListener("keydown", startHandler)
                    // Both plays stay inside this handler: a user gesture is the one context in which
                    // the browser cannot refuse them (see `DoggoNogoCore.startBackgroundMusic`).
                    if (this.level && this.level.assets) {
                        DoggoNogoCore.safePlay(this.level.assets.soundStart)
                        DoggoNogoCore.startBackgroundMusic(this.level.assets.soundBackground)
                    }
                    resolve()
                }
            }
            document.addEventListener("keydown", startHandler)
        })
    },

    /**
     * The main game loop. The frame timestamp is handed to the level so trial timing is driven by
     * frame boundaries (when pixels actually reach the screen) instead of by timers.
     */
    loop: function (frameTimestamp) {
        this.level.update(frameTimestamp)
        this.level.draw() // Separated draw call
        // Overlay marker square last so it's never occluded
        if (this._marker && this._marker.enabled) {
            this.drawMarkerIndicator()
        }
        if (!this._boundLoop) this._boundLoop = this.loop.bind(this)
        this.animationFrameId = requestAnimationFrame(this._boundLoop)
    },

    /**
     * Stops the game loop.
     */
    stop: function () {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }
        DoggoNogoUI.cancelScoreScreen()
        if (this._boundResizeHandler) {
            window.removeEventListener("resize", this._boundResizeHandler)
            this._boundResizeHandler = null
        }
        if (this._injectedFullscreenStyleEl) {
            try {
                this._injectedFullscreenStyleEl.remove()
            } catch (err) {
                console.debug("Failed to remove fullscreen style element", err)
            }
            this._injectedFullscreenStyleEl = null
            // Restore overflow auto in case we hid scrollbars
            document.documentElement.style.overflow = this._prevHtmlOverflow || ""
            document.body.style.overflow = this._prevBodyOverflow || ""
            document.body.style.margin = this._prevBodyMargin || ""
        }
    },
    /**
     * Draw a persistent white square that flashes black briefly on stimulus onset.
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
        const dpr = window.devicePixelRatio || 1
        const w = document.documentElement.clientWidth || window.innerWidth
        const h = document.documentElement.clientHeight || window.innerHeight
        this.canvas.width = w * dpr
        this.canvas.height = h * dpr
        this.canvas.style.width = `${w}px`
        this.canvas.style.height = `${h}px`
        this.ctx.scale(dpr, dpr)
    },
}

/**
 * Displays the title screen and waits for SPACE. Cinematic but cheap: a slow Ken Burns
 * zoom on the cover art, a vignette, drifting fireflies, the title art easing in, and a
 * pulsing SPACE keycap prompt. SPACE fades to black before resolving, so the cutscene (or
 * instructions) never pops in abruptly. Also ensures at least one user interaction before
 * any cutscene audio plays.
 */
DoggoNogoEngine.showCoverScreen = function () {
    return new Promise((resolve) => {
        const cover = this.level.assets.imgCover
        const coverText = this.level.assets.imgCoverText
        const ctx = this.ctx
        const canvas = this.canvas
        const { drawKeycap, drawVignette, drawGlowText, easeOutCubic, pulse01 } = DoggoNogoUI.fx
        const theme = DoggoNogoUI.theme
        let startTs = null
        let finished = false
        let exiting = false
        let exitStart = null
        const exitDuration = 450 // ms fade-to-black after SPACE

        // Ambient fireflies (normalized coordinates; wrapped every frame).
        // Mostly warm gold with the odd cool cyan one drifting through.
        const fireflies = Array.from({ length: 24 }, () => ({
            x: Math.random(),
            y: 0.3 + Math.random() * 0.7,
            r: 0.002 + Math.random() * 0.004,
            phase: Math.random() * Math.PI * 2,
            vx: (Math.random() - 0.5) * 0.00002,
            vy: -(0.000005 + Math.random() * 0.00002),
            tint: Math.random() < 0.25 ? "150, 225, 255" : "255, 230, 150",
        }))

        const draw = (ts) => {
            if (finished) return
            if (!startTs) startTs = ts
            const t = ts - startTs
            const w = canvas.width
            const h = canvas.height

            ctx.fillStyle = "#000"
            ctx.fillRect(0, 0, w, h)

            // Cover art with a slow settle-in zoom
            if (cover && cover.complete) {
                const zoom = 1.08 - 0.08 * easeOutCubic(t / 7000)
                const zw = w * zoom
                const zh = h * zoom
                ctx.drawImage(cover, (w - zw) / 2, (h - zh) / 2, zw, zh)
            }
            drawVignette(ctx, w, h, 0.55)

            // Fireflies
            ctx.save()
            for (const f of fireflies) {
                const fx = ((f.x + t * f.vx) % 1 + 1) % 1
                const fy = ((f.y + t * f.vy) % 1 + 1) % 1
                const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(t / 700 + f.phase))
                const rad = f.r * h * 3
                const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, rad)
                g.addColorStop(0, `rgba(${f.tint}, ${a})`)
                g.addColorStop(1, `rgba(${f.tint}, 0)`)
                ctx.fillStyle = g
                ctx.beginPath()
                ctx.arc(fx * w, fy * h, rad, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.restore()

            // Title art: fade + drift up + settle
            if (coverText && coverText.complete) {
                const p = easeOutCubic(Math.min(1, t / 1100))
                const scale = 0.97 + 0.03 * p
                const dw = w * scale
                const dh = h * scale
                ctx.save()
                ctx.globalAlpha = p
                ctx.drawImage(coverText, (w - dw) / 2, (h - dh) / 2 + (1 - p) * h * 0.02, dw, dh)
                ctx.restore()
            }

            // Prompt: SPACE keycap with an arcade "PRESS START" hard blink
            if (t > 1200) {
                ctx.save()
                ctx.globalAlpha = Math.floor(t / 620) % 2 === 0 ? 1 : 0.25
                const capH = h * 0.045
                const capY = h * 0.9
                const capW = drawKeycap(ctx, w * 0.5 - capH * 1.6, capY, capH, "SPACE")
                drawGlowText(ctx, "to start", w * 0.5 - capH * 1.6 + capW / 2 + capH * 0.5, capY + capH * 0.18, capH * 0.62, {
                    color: theme.ink,
                    weight: 600,
                    font: theme.font,
                    align: "left",
                })
                ctx.restore()
            }

            // Exit: fade to black, then resolve
            if (exiting) {
                if (exitStart === null) exitStart = ts
                const ep = Math.min(1, (ts - exitStart) / exitDuration)
                ctx.fillStyle = `rgba(0,0,0,${ep})`
                ctx.fillRect(0, 0, w, h)
                if (ep >= 1) {
                    finished = true
                    resolve()
                    return
                }
            }
            requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)

        const handler = (e) => {
            if (e.code === "Space") {
                e.preventDefault() // Space would otherwise scroll the page under the canvas
                document.removeEventListener("keydown", handler)
                // A keydown is a user gesture, the one context where the browser honours a
                // fullscreen request. Failure (e.g. iframe policy) is fine: the canvas already
                // fills the window.
                if (this._browserFullscreen && document.documentElement.requestFullscreen && !document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch((err) => console.debug("Fullscreen refused", err))
                }
                exiting = true
            }
        }
        document.addEventListener("keydown", handler)
    })
}
