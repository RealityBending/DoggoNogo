/**
 * @file A generic runner for playing intro animation sequences.
 */
;(function (global) {
    // Inline intro asset loader (merged from intro_assets.js)
    if (!global.DoggoNogoIntroAssets) {
        const IntroAssets = {
            imgIntroBackground: new Image(),
            soundIntroMetalDoor: new Audio(),
            soundIntroDogWhining: new Audio(),
            loaded: false,
            load(base) {
                if (this.loaded) return Promise.resolve(this)
                const b = base || ""
                this.imgIntroBackground.src = b + "level1/intro_background.png"
                this.soundIntroMetalDoor.src = b + "level1/sound_intro_metaldoor.mp3"
                this.soundIntroDogWhining.src = b + "level1/sound_intro_dogwhining.mp3"
                const refs = [this.imgIntroBackground, this.soundIntroMetalDoor, this.soundIntroDogWhining]
                return Promise.all(
                    refs.map(
                        (a) =>
                            new Promise((res, rej) => {
                                if (a instanceof HTMLImageElement) {
                                    a.onload = res
                                    a.onerror = rej
                                } else {
                                    a.oncanplaythrough = res
                                    a.onerror = rej
                                }
                            })
                    )
                ).then(() => {
                    this.loaded = true
                    return this
                })
            },
        }
        global.DoggoNogoIntroAssets = IntroAssets
    }
    const IntroRunner = {
        /**
         * Runs an intro sequence.
         * @param {HTMLCanvasElement} canvas - The canvas to draw on.
         * @param {Array<object>} sequence - The array of sequence steps.
         * @param {object} assets - The loaded assets object from the level.
         * @returns {Promise<void>} - A promise that resolves when the intro is complete.
         */
        run: function (canvas, sequence, assets, options) {
            return new Promise((resolve) => {
                this.canvas = canvas
                this.ctx = canvas.getContext("2d")
                this.sequence = sequence
                this.assets = assets || {}
                this.assetBasePath = (options && options.assetBasePath) || ""
                if (this.assetBasePath && !this.assetBasePath.endsWith("/")) this.assetBasePath += "/"
                this.currentIndex = -1
                this.resolve = resolve
                this.finished = false
                this.skipRequested = false
                this.pendingTimeout = null
                this.hasExplicitFill = false
                this.currentSpriteHeightPercent = null
                this.currentSpriteYPercent = null
                // key handler to skip entire intro (simplest implementation)
                this.boundKeyHandler = (e) => {
                    if (e.key && e.key.toLowerCase() === "s") {
                        this.requestSkip()
                    }
                }
                document.addEventListener("keydown", this.boundKeyHandler)
                // Persistent layers
                this.currentBackground = null
                this.currentSprite = null
                this.nextStep()
            })
        },

        nextStep: function () {
            this.currentIndex++
            if (this.skipRequested || this.currentIndex >= this.sequence.length) {
                this.finish()
                return
            }
            const step = this.sequence[this.currentIndex]
            this.processStep(step)
        },

        processStep: function (step) {
            /* Unified schema:
               type: fill|text|image|sound|wait
               what: text string (for text) OR asset key (image/sound)
               color: optional (fill/text)
               animation: 'reveal'|'appear' (for image or text fade-in); duration only applies if animation=='reveal'
               duration: wait duration (type=='wait') OR fade duration (animation=='reveal')
            */
            let advanceDelay = 0
            const animation = step.animation || "appear"
            switch (step.type) {
                case "fill": {
                    this.ctx.fillStyle = step.color || "black"
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
                    this.currentBackground = null
                    this.currentSprite = null
                    this.hasExplicitFill = true
                    // no duration effect (immediate)
                    break
                }
                case "image": {
                    let img = this.assets[step.what]
                    if (!img) {
                        // Attempt dynamic lazy load by filename (allows using raw filenames like 'intro_eyes.png')
                        img = new Image()
                        let src = step.what
                        // Prepend base path for relative paths (no protocol, not root '/', and not already starting with base)
                        if (!/^https?:\/\//i.test(src) && !src.startsWith("/") && this.assetBasePath) {
                            src = this.assetBasePath + src
                        }
                        img.onload = () => {
                            this.assets[step.what] = img
                            // Re-run this step now that image exists
                            this.processStep(step)
                        }
                        img.onerror = () => {
                            console.warn("Intro image asset load failed:", step.what, src)
                            this.nextStep()
                        }
                        img.src = src
                        return // Wait for async load; do not schedule next yet
                    }
                    const isBg =
                        img && img.naturalWidth && img.naturalHeight
                            ? Math.abs(img.naturalWidth / img.naturalHeight - this.canvas.width / this.canvas.height) < 0.2
                            : true
                    const fadeMs = animation === "reveal" ? step.duration || 1000 : 0
                    // Single height parameter: interpreted as percent of canvas height.
                    let customHeightPercent = null
                    if (typeof step.height === "number" && !isNaN(step.height)) {
                        customHeightPercent = step.height
                    } else if (typeof step.height === "string" && /%$/.test(step.height)) {
                        const v = parseFloat(step.height)
                        if (!isNaN(v)) customHeightPercent = v
                    }
                    const customYPercent = typeof step.y === "number" ? step.y : null
                    if (fadeMs === 0) {
                        if (isBg) this.currentBackground = img
                        else {
                            this.currentSprite = img
                            this.currentSpriteHeightPercent = customHeightPercent
                            this.currentSpriteYPercent = customYPercent
                        }
                        this.redrawPersistent()
                    } else {
                        let startTs = null
                        const animate = (ts) => {
                            if (this.skipRequested || this.finished) return
                            if (!startTs) startTs = ts
                            const progress = Math.min(1, (ts - startTs) / fadeMs)
                            this.redrawPersistent()
                            this.ctx.save()
                            this.ctx.globalAlpha = progress
                            if (isBg) this.drawBackground(img)
                            else this.drawSprite(img, customHeightPercent, customYPercent)
                            this.ctx.restore()
                            if (progress < 1) requestAnimationFrame(animate)
                            else {
                                if (isBg) this.currentBackground = img
                                else {
                                    this.currentSprite = img
                                    this.currentSpriteHeightPercent = customHeightPercent
                                    this.currentSpriteYPercent = customYPercent
                                }
                            }
                        }
                        requestAnimationFrame(animate)
                    }
                    advanceDelay = fadeMs
                    break
                }
                case "text": {
                    const fadeMs = animation === "reveal" ? step.duration || 600 : 0
                    if (fadeMs === 0) {
                        // Do not implicitly clear background; only redraw background layers if present.
                        this.redrawPersistent(false)
                        this.drawText(step.what, step.fontSize, false, step.color, step.y)
                    } else {
                        let startTs = null
                        const animate = (ts) => {
                            if (this.skipRequested || this.finished) return
                            if (!startTs) startTs = ts
                            const progress = Math.min(1, (ts - startTs) / fadeMs)
                            // Optional background fill during reveal to avoid repeated overdraw artifacts
                            if (step.background) {
                                this.ctx.fillStyle = step.background
                                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
                                if (this.currentBackground) this.drawBackground(this.currentBackground)
                                if (this.currentSprite)
                                    this.drawSprite(this.currentSprite, this.currentSpriteHeightPercent, this.currentSpriteYPercent)
                            } else {
                                this.redrawPersistent(false)
                            }
                            this.ctx.save()
                            this.ctx.globalAlpha = progress
                            this.drawText(step.what, step.fontSize, false, step.color, step.y)
                            this.ctx.restore()
                            if (progress < 1) requestAnimationFrame(animate)
                        }
                        requestAnimationFrame(animate)
                    }
                    // hold only for fade; plain text advances next frame
                    advanceDelay = fadeMs
                    break
                }
                case "sound": {
                    let snd = this.assets[step.what]
                    if (!snd) {
                        // Lazy load by filename if not present
                        snd = new Audio()
                        let src = step.what
                        if (!/^https?:\/\//i.test(src) && !src.startsWith("/") && this.assetBasePath) {
                            src = this.assetBasePath + src
                        }
                        snd.oncanplaythrough = () => snd.play().catch(() => {})
                        snd.onerror = () => console.warn("Intro sound load failed:", step.what, src)
                        snd.src = src
                        this.assets[step.what] = snd
                    } else {
                        try {
                            snd.play()
                        } catch (e) {
                            console.warn("Sound play failed", step.what, e)
                        }
                    }
                    break
                }
                case "wait": {
                    advanceDelay = step.duration || 0
                    break
                }
                default:
                    console.warn("Unknown intro step type", step)
            }
            if (this.skipRequested) {
                this.finish()
                return
            }
            if (advanceDelay > 0) {
                this.pendingTimeout = setTimeout(() => {
                    this.pendingTimeout = null
                    this.nextStep()
                }, advanceDelay)
            } else {
                requestAnimationFrame(() => this.nextStep())
            }
        },
        requestSkip: function () {
            if (this.skipRequested) return
            this.skipRequested = true
            if (this.pendingTimeout) {
                clearTimeout(this.pendingTimeout)
                this.pendingTimeout = null
            }
            // finish asap
            this.finish()
        },
        finish: function () {
            if (this.finished) return
            this.finished = true
            this.cleanup()
            if (typeof this.resolve === "function") this.resolve()
        },
        cleanup: function () {
            if (this.boundKeyHandler) {
                document.removeEventListener("keydown", this.boundKeyHandler)
                this.boundKeyHandler = null
            }
        },
        redrawPersistent: function (allowImplicitFill = true) {
            if (this.currentBackground) {
                this.drawBackground(this.currentBackground)
            } else if (allowImplicitFill && !this.hasExplicitFill) {
                // Only auto-fill black before any explicit fill has happened
                this.ctx.fillStyle = "black"
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
            }
            if (this.currentSprite) {
                this.drawSprite(this.currentSprite, this.currentSpriteHeightPercent, this.currentSpriteYPercent)
            }
        },

        clearCanvas: function () {}, // no-op (handled per step)

        drawText: function (text, fontSize = 36, withOutline = false, color = "white", yPercent = 50) {
            this.ctx.textAlign = "center"
            this.ctx.fillStyle = color
            const scale = (this.canvas.width / 1792 + this.canvas.height / 1024) / 2
            const px = Math.round(fontSize * scale)
            this.ctx.font = `bold ${px}px Arial`
            const yPos = this.canvas.height * ((yPercent || 50) / 100)

            if (withOutline) {
                this.ctx.strokeStyle = "black"
                this.ctx.lineWidth = 4
                this.ctx.strokeText(text, this.canvas.width / 2, yPos)
            }
            this.ctx.fillText(text, this.canvas.width / 2, yPos)
        },

        drawBackground: function (img) {
            if (img && img.complete) {
                this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height)
            }
        },

        drawSprite: function (img, heightPercent, yPercentOverride) {
            if (img && img.complete) {
                const aspectRatio = img.naturalWidth / img.naturalHeight
                let height = this.canvas.height * 0.4 // default 40%
                if (typeof heightPercent === "number" && !isNaN(heightPercent)) {
                    height = this.canvas.height * (Math.max(1, Math.min(100, heightPercent)) / 100)
                }
                const width = height * aspectRatio
                const x = this.canvas.width / 2 - width / 2
                let y = this.canvas.height / 2 - height / 2
                if (typeof yPercentOverride === "number" && !isNaN(yPercentOverride)) {
                    y = this.canvas.height * (yPercentOverride / 100) - height / 2
                }
                this.ctx.drawImage(img, x, y, width, height)
            }
        },
    }

    global.IntroRunner = IntroRunner
})(typeof window !== "undefined" ? window : globalThis)
