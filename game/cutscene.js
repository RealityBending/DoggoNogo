/**
 * @file A generic runner for playing cutscene animation sequences.
 */

import { DoggoNogoCore, DoggoNogoUI } from "./game.js"
// Cutscene assets, loaded on first use. The keys mirror the filenames on disk, which are
// still `intro_*` - renaming those is an asset-folder change, not a code one.
export const DoggoNogoCutsceneAssets = {
    imgIntroBackground: new Image(),
    soundIntroMetalDoor: new Audio(),
    soundIntroDogWhining: new Audio(),
    loaded: false,
    load(base) {
        if (this.loaded) return Promise.resolve(this)
        const b = base || ""
        this.imgIntroBackground.src = b + "level1/intro_background.webp"
        this.soundIntroMetalDoor.src = b + "level1/sound_intro_metaldoor.mp3"
        this.soundIntroDogWhining.src = b + "level1/sound_intro_dogwhining.mp3"
        const refs = [this.imgIntroBackground, this.soundIntroMetalDoor, this.soundIntroDogWhining]
        return DoggoNogoCore.loadAssets(refs).then(() => {
            this.loaded = true
            return this
        })
    },
}

export const CutsceneRunner = {
    /**
     * Runs a cutscene sequence.
     * @param {HTMLCanvasElement} canvas - The canvas to draw on.
     * @param {Array<object>} sequence - The array of sequence steps.
     * @param {object} assets - The loaded assets object from the level.
     * @returns {Promise<void>} - A promise that resolves when the cutscene is complete.
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
            // Step sequencing/skipping state: bumping `stepSeq` invalidates any animation
            // still running for a previous step; `_commitCurrent` finalizes a mid-flight
            // step (e.g. locks in a fading background) when the player advances past it.
            this.stepSeq = 0
            this._commitCurrent = null
            this._lastAdvance = 0
            // Ignore SPACE for a moment: the press that dismissed the cover screen can
            // auto-repeat into the cutscene and skip the first beat unintentionally.
            this._spaceArmedAt = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 500
            // Keys: tap SPACE to advance one step, hold SPACE to skip the whole cutscene.
            // The advance fires on keyup (a release before the hold threshold), so a hold
            // never fast-forwards through beats on the way to the skip.
            this.spaceHold = { active: false, start: 0, threshold: 800 }
            this._holdRafId = null
            this.boundKeyHandler = (e) => {
                if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
                    e.preventDefault() // Space would otherwise scroll the page under the canvas
                    if (e.repeat) return
                    this._beginSpaceHold()
                }
            }
            this.boundKeyUpHandler = (e) => {
                if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
                    this._endSpaceHold()
                }
            }
            document.addEventListener("keydown", this.boundKeyHandler)
            document.addEventListener("keyup", this.boundKeyUpHandler)
            // Persistent layers, in painting order: the base (a background image, or the colour
            // of the last `fill`), the sprite, then every narration line currently on the page.
            // `redrawPersistent` rebuilds the whole frame from these, so nothing on screen
            // depends on what happened to be painted there before.
            this.currentFill = null
            this.currentBackground = null
            this.currentSprite = null
            this.currentTexts = []
            this.nextStep()
        })
    },

    nextStep: function () {
        // Finalize the step being left: its fade animation may still be mid-flight (the
        // step's advance timer routinely fires a frame before the fade's last rAF frame),
        // so lock in its end state before the next step invalidates the animation.
        if (this._commitCurrent) {
            const commit = this._commitCurrent
            this._commitCurrent = null
            commit()
        }
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
           animation: 'reveal'|'emerge'|'appear' (image or text fade-in); duration only applies to reveal/emerge
           duration: wait duration (type=='wait') OR fade duration (animation=='reveal'|'emerge')
           focus: {x,y} fractions of the sprite, for 'emerge' - where the reveal starts
        */
        let advanceDelay = 0
        const animation = step.animation || "appear"
        // Any animation belonging to an earlier step stops the moment this one begins.
        const seq = ++this.stepSeq
        this._commitCurrent = null
        switch (step.type) {
            case "fill": {
                // A cut to a blank stage: it clears the page, narration included, and becomes
                // the base every later redraw paints over.
                this.currentFill = step.color || "black"
                this.currentBackground = null
                this.currentSprite = null
                this.currentTexts = []
                this.hasExplicitFill = true
                this.redrawPersistent()
                // no duration effect (immediate)
                break
            }
            case "image": {
                let img = this.assets[step.what]
                if (!img) {
                    // Attempt dynamic lazy load by path (sequences name files, e.g. 'level2/player_1.webp')
                    img = new Image()
                    let src = step.what
                    // Prepend base path for relative paths (no protocol, not root '/', and not already starting with base)
                    if (!/^https?:\/\//i.test(src) && !src.startsWith("/") && this.assetBasePath) {
                        src = this.assetBasePath + src
                    }
                    img.onload = () => {
                        this.assets[step.what] = img
                        // Re-run this step now that image exists — unless the player has
                        // already advanced past it while the file was loading.
                        if (seq !== this.stepSeq) return
                        this.processStep(step)
                    }
                    img.onerror = () => {
                        console.warn("Cutscene image asset load failed:", step.what, src)
                        if (seq !== this.stepSeq) return
                        this.nextStep()
                    }
                    img.src = src
                    return // Wait for async load; do not schedule next yet
                }
                const isBg =
                    img && img.naturalWidth && img.naturalHeight
                        ? Math.abs(img.naturalWidth / img.naturalHeight - this.canvas.width / this.canvas.height) < 0.2
                        : true
                const emerging = animation === "emerge"
                const fadeMs = animation === "reveal" || emerging ? step.duration || 1000 : 0
                // Single height parameter: interpreted as percent of canvas height.
                let customHeightPercent = null
                if (typeof step.height === "number" && !isNaN(step.height)) {
                    customHeightPercent = step.height
                } else if (typeof step.height === "string" && /%$/.test(step.height)) {
                    const v = parseFloat(step.height)
                    if (!isNaN(v)) customHeightPercent = v
                }
                const customYPercent = typeof step.y === "number" ? step.y : null
                // A new BACKGROUND is a new shot, so it also turns the narration page - the lines
                // written over the last one do not belong over this one. A sprite does not: it
                // arrives inside the shot that is already running, and Level 2's opening line is
                // deliberately still up while Nogo emerges under it.
                //
                // Clearing happens in `commit`, not when the step starts, so a line stays up
                // underneath a background that is still fading in and is covered gradually by it
                // rather than snapping out on the first frame of the fade.
                const commit = () => {
                    if (isBg) {
                        this.currentBackground = img
                        this.currentTexts = []
                    } else {
                        this.currentSprite = img
                        this.currentSpriteHeightPercent = customHeightPercent
                        this.currentSpriteYPercent = customYPercent
                    }
                }
                if (fadeMs === 0) {
                    commit()
                    this.redrawPersistent()
                } else {
                    // If the player advances past this step mid-fade, lock the image in.
                    this._commitCurrent = commit
                    let startTs = null
                    const animate = (ts) => {
                        if (this.skipRequested || this.finished || seq !== this.stepSeq) return
                        if (!startTs) startTs = ts
                        const progress = Math.min(1, (ts - startTs) / fadeMs)
                        this.redrawPersistent()
                        this.ctx.save()
                        if (emerging && !isBg) {
                            // Opacity leads the disc so the first thing to surface is already
                            // solid rather than a ghost; the mask does the rest of the work.
                            this.ctx.globalAlpha = Math.min(1, progress * 1.8)
                            this.drawSpriteEmerging(img, customHeightPercent, customYPercent, progress, step.focus)
                        } else {
                            this.ctx.globalAlpha = progress
                            if (isBg) this.drawBackground(img)
                            else this.drawSprite(img, customHeightPercent, customYPercent)
                        }
                        this.ctx.restore()
                        // Keep the letterbox bars above a background that is fading in
                        this.drawCinematicOverlay()
                        if (progress < 1) requestAnimationFrame(animate)
                        else commit()
                    }
                    requestAnimationFrame(animate)
                }
                advanceDelay = fadeMs
                break
            }
            case "text": {
                // A line is ADDED to the page rather than replacing it: give successive steps
                // different `y` values and they stack, and the earlier lines stay readable while
                // the new one arrives. Only a `fill` or a new background turns the page.
                const line = { what: step.what, fontSize: step.fontSize, color: step.color, y: step.y, font: step.font }
                const fadeMs = animation === "reveal" ? step.duration || 600 : 0
                if (fadeMs === 0) {
                    this.currentTexts.push(line)
                    this.redrawPersistent(false)
                } else {
                    // The fading line is drawn on top of the page by the loop below and only joins
                    // it once the step is left, so the reveal is not fighting an opaque copy of
                    // itself. Committing also covers a player advancing mid-reveal.
                    this._commitCurrent = () => {
                        this.currentTexts.push(line)
                        this.redrawPersistent(false)
                    }
                    let startTs = null
                    const animate = (ts) => {
                        if (this.skipRequested || this.finished || seq !== this.stepSeq) return
                        if (!startTs) startTs = ts
                        const progress = Math.min(1, (ts - startTs) / fadeMs)
                        // Optional background fill during reveal to avoid repeated overdraw artifacts
                        if (step.background) {
                            this.ctx.fillStyle = step.background
                            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
                            if (this.currentBackground) this.drawBackground(this.currentBackground)
                            if (this.currentSprite)
                                this.drawSprite(this.currentSprite, this.currentSpriteHeightPercent, this.currentSpriteYPercent)
                            this.drawTexts()
                            this.drawCinematicOverlay()
                        } else {
                            this.redrawPersistent(false)
                        }
                        this.ctx.save()
                        this.ctx.globalAlpha = progress
                        this.drawText(step.what, step.fontSize, false, step.color, step.y, step.font)
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
                    snd.onerror = () => console.warn("Cutscene sound load failed:", step.what, src)
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
                console.warn("Unknown cutscene step type", step)
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
            // Guarded so a SPACE advance in this same frame can't double-step.
            requestAnimationFrame(() => {
                if (seq === this.stepSeq) this.nextStep()
            })
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

    /**
     * SPACE pressed: start tracking a hold. A private rAF loop repaints the cinematic overlay
     * (which renders the filling skip gauge) every frame, and fires the full skip once the hold
     * crosses the threshold. Repainting only the overlay is safe: the letterbox bars are opaque,
     * so this composes with whatever step animation is also drawing.
     */
    _beginSpaceHold: function () {
        if (this.finished || this.skipRequested || this.spaceHold.active) return
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        if (now < this._spaceArmedAt) return
        this.spaceHold.active = true
        this.spaceHold.start = now
        const loop = () => {
            if (!this.spaceHold.active || this.finished || this.skipRequested) {
                this._holdRafId = null
                return
            }
            const held = (typeof performance !== "undefined" ? performance.now() : Date.now()) - this.spaceHold.start
            if (held >= this.spaceHold.threshold) {
                this.spaceHold.active = false
                this._holdRafId = null
                this.requestSkip()
                return
            }
            this.drawCinematicOverlay()
            this._holdRafId = requestAnimationFrame(loop)
        }
        this._holdRafId = requestAnimationFrame(loop)
    },

    /** SPACE released: a release before the skip threshold advances one step. */
    _endSpaceHold: function () {
        if (!this.spaceHold || !this.spaceHold.active) return
        this.spaceHold.active = false
        if (this._holdRafId) {
            cancelAnimationFrame(this._holdRafId)
            this._holdRafId = null
        }
        if (this.finished || this.skipRequested) return
        this.advanceStep()
        // Wipe the partially-filled gauge from the bottom bar.
        this.drawCinematicOverlay()
    },

    /**
     * SPACE: jump past the current step (finish its animation/wait immediately) without
     * skipping the rest of the cutscene. Debounced so a held key can't blow through the
     * whole sequence via auto-repeat.
     */
    advanceStep: function () {
        if (this.finished || this.skipRequested) return
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        if (now < this._spaceArmedAt || now - this._lastAdvance < 220) return
        this._lastAdvance = now
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout)
            this.pendingTimeout = null
        }
        // Invalidate any running step animation; nextStep() locks in its final state.
        this.stepSeq++
        this.nextStep()
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
        if (this.boundKeyUpHandler) {
            document.removeEventListener("keyup", this.boundKeyUpHandler)
            this.boundKeyUpHandler = null
        }
        if (this._holdRafId) {
            cancelAnimationFrame(this._holdRafId)
            this._holdRafId = null
        }
    },
    /**
     * Repaints the whole frame from the persistent layers: base, sprite, narration, letterbox.
     *
     * The base is repainted every time, including for a text step, which is what lets a line be
     * added to or removed from the page without leaving the previous painting underneath. That
     * needs the LAST FILL COLOUR to be remembered (`currentFill`) - redrawing only the background
     * and sprite used to be the only option on a black stage, and it meant text could accumulate
     * but never be taken back.
     *
     * `allowImplicitFill` remains for the case where neither a background nor a `fill` has been
     * seen yet, i.e. a sequence that opens on something other than `fill`.
     */
    redrawPersistent: function (allowImplicitFill = true) {
        if (this.currentBackground) {
            this.drawBackground(this.currentBackground)
        } else if (this.currentFill) {
            this.ctx.fillStyle = this.currentFill
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
        } else if (allowImplicitFill && !this.hasExplicitFill) {
            // Only auto-fill black before any explicit fill has happened
            this.ctx.fillStyle = "black"
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
        }
        if (this.currentSprite) {
            this.drawSprite(this.currentSprite, this.currentSpriteHeightPercent, this.currentSpriteYPercent)
        }
        this.drawTexts()
        this.drawCinematicOverlay()
    },

    /** Every narration line currently on the page, in the order it was written. */
    drawTexts: function () {
        for (const line of this.currentTexts || []) {
            this.drawText(line.what, line.fontSize, false, line.color, line.y, line.font)
        }
    },

    clearCanvas: function () {}, // no-op (handled per step)

    /**
     * Letterbox bars + a single ghost "SPACE to skip" button, drawn on top of every cutscene
     * frame for a filmic look. The button sits translucent in the bottom bar and charges up
     * with the accent colour while SPACE is held (the hold loop in `_beginSpaceHold` repaints
     * this overlay every frame); a tap still quietly advances one step.
     */
    drawCinematicOverlay: function () {
        const ctx = this.ctx
        const w = this.canvas.width
        const h = this.canvas.height
        const bar = Math.round(h * 0.085)
        ctx.save()
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, w, bar)
        ctx.fillRect(0, h - bar, w, bar)

        const { fx, theme } = DoggoNogoUI
        const holding = this.spaceHold && this.spaceHold.active
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        const progress = holding ? Math.min(1, (now - this.spaceHold.start) / this.spaceHold.threshold) : 0

        // Button geometry: sized to its two-part label ("SPACE" in the pixel face, "to skip"
        // in the body face), pill-shaped, tucked into the bottom-right of the bar.
        const bh = bar * 0.66
        const keyFont = `${Math.round(bh * 0.34)}px ${theme.display}`
        const tailFont = `${Math.round(bh * 0.56)}px ${theme.font}`
        ctx.font = keyFont
        const keyW = ctx.measureText("SPACE").width
        ctx.font = tailFont
        const tailW = ctx.measureText("to skip").width
        const gap = bh * 0.3
        const padX = bh * 0.55
        const bw = padX * 2 + keyW + gap + tailW
        const bx = w - bw - bh * 0.8
        const by = h - bar / 2 - bh / 2

        // Ghost body, charge fill, then rim
        fx.roundRectPath(ctx, bx, by, bw, bh, bh / 2)
        ctx.fillStyle = holding ? "rgba(255,200,87,0.1)" : "rgba(255,255,255,0.05)"
        ctx.fill()
        if (progress > 0) {
            ctx.save()
            fx.roundRectPath(ctx, bx, by, bw, bh, bh / 2)
            ctx.clip()
            ctx.fillStyle = "rgba(255,200,87,0.32)"
            ctx.fillRect(bx, by, bw * progress, bh)
            ctx.restore()
        }
        fx.roundRectPath(ctx, bx, by, bw, bh, bh / 2)
        ctx.strokeStyle = holding ? "rgba(255,200,87,0.85)" : "rgba(255,255,255,0.22)"
        ctx.lineWidth = Math.max(1, bh * 0.06)
        ctx.stroke()

        // Label
        ctx.textBaseline = "middle"
        ctx.textAlign = "left"
        const ty = h - bar / 2 + bh * 0.05
        ctx.font = keyFont
        ctx.fillStyle = holding ? theme.accent : "rgba(255,255,255,0.72)"
        ctx.fillText("SPACE", bx + padX, ty)
        ctx.font = tailFont
        ctx.fillStyle = holding ? "rgba(255,224,160,0.95)" : "rgba(255,255,255,0.42)"
        ctx.fillText("to skip", bx + padX + keyW + gap, ty)
        ctx.restore()
    },

    drawText: function (text, fontSize = 36, withOutline = false, color = "white", yPercent = 50, fontKey = "body") {
        const ctx = this.ctx
        const theme = DoggoNogoUI.theme
        const scale = (this.canvas.width / 1920 + this.canvas.height / 1080) / 2
        // Narrative text uses the terminal body face (readable at paragraph length); a step may
        // opt into the pixel display face with `font: "display"` for short dramatic beats.
        const face = fontKey === "display" ? theme.display : theme.font
        const px = Math.round(fontSize * scale * (fontKey === "display" ? 0.9 : 1.25))
        const yPos = this.canvas.height * ((yPercent || 50) / 100)
        ctx.save()
        ctx.textAlign = "center"
        ctx.fillStyle = color
        ctx.font = `600 ${px}px ${face}`
        try {
            ctx.letterSpacing = `${Math.round(px * 0.03)}px`
        } catch (e) {
            /* letter-spacing unsupported: fine */
        }
        ctx.shadowColor = "rgba(0,0,0,0.85)"
        ctx.shadowBlur = px * 0.3
        ctx.shadowOffsetY = px * 0.05
        if (withOutline) {
            ctx.strokeStyle = "black"
            ctx.lineWidth = Math.max(2, px * 0.08)
            ctx.strokeText(text, this.canvas.width / 2, yPos)
        }
        ctx.fillText(text, this.canvas.width / 2, yPos)
        ctx.restore()
    },

    drawBackground: function (img) {
        if (img && img.complete) {
            DoggoNogoUI.fx.drawImageCover(this.ctx, img, 0, 0, this.canvas.width, this.canvas.height)
        }
    },

    /** The rect `drawSprite` will draw into. Split out so a mask can be sized to it. */
    spriteRect: function (img, heightPercent, yPercentOverride) {
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
        return { x, y, width, height }
    },

    drawSprite: function (img, heightPercent, yPercentOverride) {
        if (!img || !img.complete) return
        const r = this.spriteRect(img, heightPercent, yPercentOverride)
        this.ctx.drawImage(img, r.x, r.y, r.width, r.height)
    },

    /**
     * Draws a sprite revealed through a soft-edged disc growing from a focus point, so it
     * surfaces out of the dark one region at a time instead of fading in uniformly.
     *
     * `focus` is in fractions of the sprite's own rect, and defaults to its centre. Pointing
     * it at a feature is the whole point: Nogo's eyes sit at roughly (0.36, 0.69) of his
     * sprite box - he is crouched, so his head is low and left, nowhere near the middle - and
     * aiming the reveal there is what makes the eyes arrive before the rest of the cat.
     *
     * Masking is done on an offscreen canvas with `destination-in` rather than by painting the
     * backdrop colour over the edges, so this works over artwork and not just over a flat
     * fill. The canvas is cached across frames and only reallocated when the size changes.
     */
    drawSpriteEmerging: function (img, heightPercent, yPercentOverride, progress, focus) {
        if (!img || !img.complete) return
        const r = this.spriteRect(img, heightPercent, yPercentOverride)
        const w = Math.max(1, Math.round(r.width))
        const h = Math.max(1, Math.round(r.height))
        if (!this._maskCanvas || this._maskCanvas.width !== w || this._maskCanvas.height !== h) {
            this._maskCanvas = document.createElement("canvas")
            this._maskCanvas.width = w
            this._maskCanvas.height = h
        }
        const mc = this._maskCanvas.getContext("2d")
        mc.globalCompositeOperation = "source-over"
        mc.clearRect(0, 0, w, h)
        mc.drawImage(img, 0, 0, w, h)

        const fx = w * (focus && typeof focus.x === "number" ? focus.x : 0.5)
        const fy = h * (focus && typeof focus.y === "number" ? focus.y : 0.5)
        // The disc has to clear the furthest corner AND its own soft edge by the end, or the
        // sprite never becomes fully opaque and the far side stays permanently ghosted.
        const reach = Math.hypot(Math.max(fx, w - fx), Math.max(fy, h - fy))
        const soft = Math.max(1, reach * 0.35)
        const radius = (reach + soft) * progress
        const gradient = mc.createRadialGradient(fx, fy, Math.max(0, radius - soft), fx, fy, Math.max(0.01, radius))
        gradient.addColorStop(0, "rgba(0,0,0,1)")
        gradient.addColorStop(1, "rgba(0,0,0,0)")
        mc.globalCompositeOperation = "destination-in"
        mc.fillStyle = gradient
        mc.fillRect(0, 0, w, h)
        mc.globalCompositeOperation = "source-over"

        this.ctx.drawImage(this._maskCanvas, r.x, r.y, w, h)
    },
}
