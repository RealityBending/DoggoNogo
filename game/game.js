/**
 * @file Shared UI helpers (`DoggoNogoUI`) and shared non-level mechanics (`DoggoNogoCore`).
 */

import { DoggoNogoAssets } from "./assets.js"

// Shared audio instance reused across levels for the phase-complete cue.
let phaseCompleteAudio = null
// Pending one-shot listener that restarts refused background music on the next user gesture.
let musicRetryHandler = null
// One-shot guard for the `file://` diagnosis below.
let unservedWarningShown = false
// requestAnimationFrame handle of the end-of-level score animation, so it can be cancelled.
// Without this the animation keeps repainting over whatever the next level draws (see
// `cancelScoreScreen`).
let scoreScreenRafId = null

/**
 * Opened as a local file, the game looks like it has simply lost its sound: images load normally,
 * but every media element is refused ("MEDIA_ELEMENT_ERROR: Media load rejected by URL safety
 * check"), so sprites appear and nothing is audible. Say that once and plainly, rather than leaving
 * one confusing "sound unavailable" warning per file as the only clue.
 */
function isUnserved() {
    return typeof location !== "undefined" && location.protocol === "file:"
}
function warnIfUnserved() {
    if (!isUnserved()) return false
    if (!unservedWarningShown) {
        unservedWarningShown = true
        console.error(
            "DoggoNogo is open as a local file (file://), so the browser refuses to load every sound. " +
                "Images are unaffected, which makes this look like an audio bug. Serve the folder over HTTP " +
                "instead: run `python -m http.server` in the repo root and open " +
                "http://localhost:8000/game/index.html",
        )
    }
    return true
}
// Preloaded elements are kept referenced: a media element collected mid-download has its fetch
// aborted, which fires an error on every element sharing that URL.
const preloadedAudio = []
const preloadedImages = []

const REF_W = 1792
const REF_H = 1024
function scaleFontPx(base, canvas) {
    // Scale relative to width to keep proportions; clamp for readability
    const factor = (canvas.width / REF_W + canvas.height / REF_H) / 2
    return Math.round(base * factor)
}
const drawCenteredText = (ctx, canvas, lines = [], fontSize = 30, color = "black") => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.textAlign = "center"
    ctx.fillStyle = color
    ctx.font = `${scaleFontPx(fontSize, canvas)}px Arial`
    const startY = canvas.height / 2 - ((lines.length - 1) * (fontSize + 10)) / 2
    lines.forEach((t, i) => ctx.fillText(t, canvas.width / 2, startY + i * (fontSize + 10)))
}

export const DoggoNogoUI = {
    /**
     * Converts a Z-score to a quantile assuming a standard normal distribution.
     * Since lower IES is better, the quantile reflects the percentage of the population
     * that the player performed better than.
     * @param {number} z - The Z-score.
     * @returns {number} The quantile (0-100).
     */
    zScoreToQuantile(z) {
        // This is an approximation of the standard normal CDF P(X <= z)
        const t = 1 / (1 + 0.2316419 * Math.abs(z))
        const d = 0.3989423 * Math.exp((-z * z) / 2)
        let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
        if (z > 0) {
            prob = 1 - prob
        }
        // For IES, a lower score is better. A negative Z-score means the player's IES is below the mean.
        // The CDF gives the percentage of the population with a score *less than or equal to* the player's.
        // To find the percentage of people the player is *better than*, we need 1 - CDF.
        return (1 - prob) * 100
    },

    /**
     * Cancels a score animation still in flight.
     *
     * The "Press SPACE to continue" listener is armed the moment a level ends, but the animation
     * below runs for three seconds. A participant who presses SPACE early used to start the next
     * level *while* this loop kept repainting the white score screen over its intro, which looked
     * exactly like a broken transition. The engine calls this before every run and on `stop()`.
     */
    cancelScoreScreen() {
        if (scoreScreenRafId === null) return
        cancelAnimationFrame(scoreScreenRafId)
        scoreScreenRafId = null
    },

    showScoreScreen(canvas, quantile, options = {}) {
        const { hint, playerSprite } = options || {}
        const ctx = canvas.getContext("2d")
        const duration = 3000 // 3 seconds for the animation
        let startTime = null
        // Never leave two of these animating the same canvas.
        DoggoNogoUI.cancelScoreScreen()

        const animateScore = (timestamp) => {
            if (!startTime) startTime = timestamp
            const progress = Math.min((timestamp - startTime) / duration, 1)
            const currentDisplayNumber = Math.floor(progress * quantile)

            // Always white background
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            // 1. "Level Complete" at the top
            ctx.textAlign = "center"
            ctx.fillStyle = "black"
            ctx.font = `${scaleFontPx(48, canvas)}px Arial`
            ctx.fillText("Level Complete!", canvas.width / 2, canvas.height * 0.15)

            // 2. Player sprite on the left
            if (playerSprite && playerSprite.complete) {
                const aspectRatio = playerSprite.naturalWidth / playerSprite.naturalHeight
                const displayHeight = canvas.height * 0.5
                const displayWidth = displayHeight * aspectRatio
                const xFeedbackImg = canvas.width * 0.05
                const yFeedbackImg = canvas.height / 2 - displayHeight / 2
                ctx.drawImage(playerSprite, xFeedbackImg, yFeedbackImg, displayWidth, displayHeight)
            }

            // 3. Text and score on the right
            const textX = canvas.width * 0.65
            ctx.font = `${scaleFontPx(28, canvas)}px Arial`
            ctx.fillText("Based on the speed and accuracy", textX, canvas.height / 2 - 100)
            ctx.fillText("of your reflexes, you managed to beat...", textX, canvas.height / 2 - 60)

            if (progress < 1) {
                // Flashing numbers animation
                ctx.font = `bold ${scaleFontPx(72, canvas)}px Arial`
                ctx.fillText(`${currentDisplayNumber}%`, textX, canvas.height / 2 + 40)
                scoreScreenRafId = requestAnimationFrame(animateScore)
            } else {
                scoreScreenRafId = null
                // Final screen
                ctx.font = `bold ${scaleFontPx(72, canvas)}px Arial`
                ctx.fillText(`${quantile.toFixed(0)}%`, textX, canvas.height / 2 + 40)
                ctx.font = `${scaleFontPx(28, canvas)}px Arial`
                ctx.fillText("of the players! Well done!", textX, canvas.height / 2 + 100)

                // Optional hint
                if (hint) {
                    ctx.font = `${scaleFontPx(24, canvas)}px Arial`
                    ctx.fillText(hint, textX, canvas.height / 2 + 150)
                }
            }
        }

        scoreScreenRafId = requestAnimationFrame(animateScore)
    },
}

export const DoggoNogoTrialTypes = { FAST: "fast", SLOW: "slow", EARLY: "early", TIMEOUT: "timeout", ERROR: "error" }

function mergeManifests(manifest) {
    const out = { images: [], audio: [] }
    if (!manifest) return out
    const pushUniq = (arr, v) => {
        if (arr.indexOf(v) === -1) arr.push(v)
    }
    ;["shared", "level1", "level2", "level3"].forEach((k) => {
        if (manifest[k]) {
            ;(manifest[k].images || []).forEach((p) => pushUniq(out.images, p))
            ;(manifest[k].audio || []).forEach((p) => pushUniq(out.audio, p))
        }
    })
    return out
}
export const DoggoNogoCore = {
    // Render a unified white loading screen (standalone & jsPsych use the same look)
    /**
     * Loading screen. `progress` (0..1) draws a bar so a slow asset load reads as progress rather
     * than a hung black screen.
     */
    renderLoadingScreen(target, message = "Loading the game...", progress = null) {
        // target can be a canvas or a DOM element container
        if (!target) return
        if (target instanceof HTMLCanvasElement) {
            const ctx = target.getContext("2d")
            if (!ctx) return
            ctx.save()
            ctx.fillStyle = "#fff"
            ctx.fillRect(0, 0, target.width, target.height)
            ctx.fillStyle = "#000"
            ctx.textAlign = "center"
            // Simple responsive font size
            const fs = Math.round(Math.min(target.width, target.height) * 0.035)
            ctx.font = `${fs}px Arial`
            ctx.fillText(message, target.width / 2, target.height / 2 - fs)
            if (typeof progress === "number") {
                const barW = target.width * 0.4
                const barH = Math.max(6, Math.round(target.height * 0.012))
                const barX = target.width / 2 - barW / 2
                const barY = target.height / 2 + fs
                ctx.fillStyle = "#ddd"
                ctx.fillRect(barX, barY, barW, barH)
                ctx.fillStyle = "#4CAF50"
                ctx.fillRect(barX, barY, barW * Math.min(1, Math.max(0, progress)), barH)
                ctx.strokeStyle = "#999"
                ctx.lineWidth = 1
                ctx.strokeRect(barX, barY, barW, barH)
            }
            ctx.restore()
        } else if (target instanceof HTMLElement) {
            target.innerHTML =
                `<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;background:#fff;font:20px Arial;color:#000;">` +
                `<div style="text-align:center;">${message}</div></div>`
        }
    },
    // Plays a cue if it can. Never throws and never rejects: sound is allowed to be missing.
    safePlay(audioEl, reset = true) {
        if (!audioEl) return
        try {
            if (reset) audioEl.currentTime = 0
            const played = audioEl.play()
            if (played && typeof played.catch === "function") played.catch((e) => console.debug("safePlay blocked", e))
        } catch (e) {
            console.debug("safePlay failed", e)
        }
    },
    /**
     * Starts the looping background music.
     *
     * Every other cue is played from inside a `keydown` handler, which is a user-gesture context the
     * autoplay policy always honours. The music is the one sound started from a promise continuation
     * (after the intro, after `waitForStart`), so it is the one a browser can refuse -- and it refuses
     * by rejecting the promise `play()` returns, which a `try`/`catch` around the call never sees.
     * That is why the music could go missing while the effects kept working. The rejection is caught
     * here and the music is re-armed to start on the next real gesture.
     */
    startBackgroundMusic(audioEl) {
        if (!audioEl) return
        audioEl.loop = true
        if (!audioEl.paused) return
        let played
        try {
            played = audioEl.play()
        } catch (e) {
            this.armBackgroundMusicRetry(audioEl, e)
            return
        }
        if (played && typeof played.catch === "function") played.catch((e) => this.armBackgroundMusicRetry(audioEl, e))
    },
    /** Retries the music on the next real user gesture, where playback cannot be refused. */
    armBackgroundMusicRetry(audioEl, reason) {
        console.debug("Background music blocked; retrying on next user gesture", reason)
        if (musicRetryHandler) return
        musicRetryHandler = () => {
            this.clearBackgroundMusicRetry()
            this.startBackgroundMusic(audioEl)
        }
        document.addEventListener("keydown", musicRetryHandler, true)
        document.addEventListener("pointerdown", musicRetryHandler, true)
    },
    clearBackgroundMusicRetry() {
        if (!musicRetryHandler) return
        document.removeEventListener("keydown", musicRetryHandler, true)
        document.removeEventListener("pointerdown", musicRetryHandler, true)
        musicRetryHandler = null
    },
    /** Stops the music and cancels any pending retry, so it cannot resume after the level ends. */
    stopBackgroundMusic(audioEl) {
        this.clearBackgroundMusicRetry()
        if (!audioEl) return
        try {
            audioEl.pause()
            audioEl.currentTime = 0
        } catch (e) {
            console.debug("Failed to stop background music", e)
        }
    },
    // Pseudoexponential ISIs offer an important advantage over uniformly distributed ISIs because
    // they introduce variability in delay while minimising temporal expectation effects. With a
    // uniform distribution, the conditional probability of stimulus onset increases as the interval
    // progresses, such that longer elapsed delays become increasingly predictive of imminent stimulus
    // onset and may induce anticipatory changes in attention, motor preparation, or evidence sampling.
    // By contrast, a pseudoexponential distribution exploits the memoryless property of the exponential
    // distribution to produce an approximately constant hazard function, meaning that the passage of
    // time provides relatively little information about when the stimulus will occur. A minimum floor
    // can prevent implausibly abrupt onsets, while a maximum ceiling limits excessively long waits
    // that could promote attentional lapses (Boag et al., 2025; Luce, 1991). Thus, pseudoexponential
    // ISIs help decouple the effects of actual delay duration from temporal expectancy, making it
    // easier to interpret relationships between ISI and subsequent decision-making parameters as
    // effects of elapsed time itself rather than increasing anticipation of the upcoming stimulus.
    // Min. ISI = 500ms, Max. ISI = 3500ms, Mean decay = 1000ms (default values) correspond to ~5%
    // of clipped trials at the upper bound (average of 1450ms).
    samplePseudoExponentialISI(minISI = 500, maxISI = 3500, meanDecay = 1000) {
        const expDelay = -meanDecay * Math.log(1 - Math.random())
        return Math.min(maxISI, minISI + expDelay)
    },
    /**
     * Resolves once an asset is genuinely usable: an image decoded, audio buffered far enough to
     * play through. The browser can abort a media fetch on its own (a competing download is
     * enough), so a load *error* is retried before giving up — that abort is what silently cost the
     * background music. A load that is merely slow is not retried; restarting a big download would
     * only make it slower, so whatever arrived is used as-is.
     *
     * Only after that do the two kinds diverge: audio resolves regardless, because sound is
     * decoration and must never block a session, while a failed image rejects, because a broken
     * sprite throws on `drawImage` and poisons sprite sizing.
     */
    whenAssetReady(asset, { timeout = 20000, retries = 1 } = {}) {
        if (!asset) return Promise.resolve()
        const isImage = asset instanceof HTMLImageElement
        const isReady = () => (isImage ? asset.complete && asset.naturalWidth > 0 : asset.readyState >= 4)
        const attempt = (triesLeft) =>
            new Promise((resolve, reject) => {
                let settled = false
                let timer = null
                const giveUp = (detail) => {
                    if (isImage) return reject(new Error(`Failed to load image: ${asset.src} (${detail})`))
                    // On `file://` the cause is the scheme, not this file: report it once, then stay quiet.
                    if (warnIfUnserved()) return resolve()
                    console.warn(`Sound unavailable, continuing without it: ${asset.src} (${detail})`)
                    resolve()
                }
                const finish = (outcome, detail) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    asset.onload = null
                    asset.oncanplaythrough = null
                    asset.onerror = null
                    if (outcome === "ready") return resolve()
                    if (outcome === "error" && triesLeft > 0) {
                        // Re-issue the request; an aborted fetch usually succeeds the second time.
                        if (isImage) asset.src = asset.src
                        else asset.load()
                        return resolve(attempt(triesLeft - 1))
                    }
                    // Out of time rather than broken: audio that buffered enough to start is fine.
                    if (outcome === "timeout" && !isImage && asset.readyState >= 2) return resolve()
                    giveUp(detail)
                }
                if (isReady()) return finish("ready")
                timer = setTimeout(() => finish("timeout", "timed out"), timeout)
                asset.onerror = () => finish("error", "load error")
                if (isImage) asset.onload = () => finish("ready")
                else asset.oncanplaythrough = () => finish("ready")
            })
        return attempt(retries)
    },

    /**
     * Waits for a list of assets, reporting completion counts so the caller can show progress.
     * Image failures reject (see `whenAssetReady`); audio failures are reported and tolerated.
     */
    loadAssets(assets, onProgress) {
        const list = (assets || []).filter(Boolean)
        let done = 0
        const tick = () => {
            done++
            if (typeof onProgress === "function") onProgress(done, list.length)
        }
        if (typeof onProgress === "function") onProgress(0, list.length)
        return Promise.all(
            list.map((asset) =>
                this.whenAssetReady(asset).then(
                    () => tick(),
                    (err) => {
                        tick()
                        throw err
                    },
                ),
            ),
        )
    },
    // General asset preloader for standalone mode.
    // Accepts a basePath and optional manifest object ({ images:[], audio:[] }).
    // Returns a Promise that resolves when all listed assets are loaded (best-effort).
    preloadAll({ basePath = "assets/", manifest, onProgress } = {}) {
        warnIfUnserved()
        if (!basePath.endsWith("/")) basePath += "/"
        const m = manifest || mergeManifests(DoggoNogoAssets)
        const assets = []
        ;(m.images || []).forEach((rel) => {
            const img = new Image()
            img.src = basePath + rel
            preloadedImages.push(img)
            assets.push(img)
        })
        ;(m.audio || []).forEach((rel) => {
            const a = new Audio()
            a.src = basePath + rel
            preloadedAudio.push(a)
            // Optionally store specific shared audios globally for reuse
            if (rel.endsWith("sound_phasecomplete.mp3")) phaseCompleteAudio = a
            assets.push(a)
        })
        // A missing asset here is not fatal: the level reloads its own copies and reports properly.
        return this.loadAssets(assets, onProgress).catch((e) => console.warn("Preload incomplete", e))
    },
    // Draw the top progress bar (3 segments) based on current score and phase targets.
    drawProgressBar(level, opts = {}) {
        if (!level || !level.state) return
        const ctx = level.state.ctx
        const canvas = level.state.canvas
        const widthRatio = opts.widthRatio || 0.5
        const heightRatio = opts.heightRatio || 0.033
        const topOffsetRatio = opts.topOffsetRatio || 0.033
        const colors = opts.colors || ["#4CAF50", "#00BCD4", "#2196F3"]
        const barWidth = canvas.width * widthRatio
        const barHeight = canvas.height * heightRatio
        const x = canvas.width / 2 - barWidth / 2
        const y = canvas.height * topOffsetRatio
        ctx.fillStyle = "#555"
        ctx.fillRect(x, y, barWidth, barHeight)
        const segWidth = barWidth / 3
        const phaseTargets = typeof level.getPhaseTargets === "function" ? level.getPhaseTargets() : [1, 1, 1]
        for (let i = 0; i < 3; i++) {
            const startScore = i === 0 ? 0 : phaseTargets.slice(0, i).reduce((a, b) => a + b, 0)
            const endScore = startScore + (phaseTargets[i] || 0)
            if (endScore <= startScore) continue
            const raw = (level.state.score - startScore) / (endScore - startScore)
            const frac = Math.min(1, Math.max(0, raw))
            if (frac <= 0) continue
            ctx.fillStyle = colors[i % colors.length]
            ctx.fillRect(x + i * segWidth, y, segWidth * frac, barHeight)
        }
        ctx.strokeStyle = "#000"
        ctx.strokeRect(x, y, barWidth, barHeight)
    },
    // Compute dynamic style (color, fontSize) for score delta text.
    computeScoreFeedbackStyle(points, minScore, maxScore, baseFontPx) {
        let color = "white"
        let fontSize = baseFontPx
        if (points < 0) {
            color = "#ff3b30"
        } else if (points > minScore) {
            const span = Math.max(1, maxScore - minScore)
            const f = Math.min(1, Math.max(0, (points - minScore) / span))
            const r = Math.round(255 * (1 - f))
            const g = 255
            const b = Math.round(255 * (1 - f))
            color = `rgb(${r},${g},${b})`
            fontSize = baseFontPx * (1 + 0.5 * f)
        }
        return { color, fontSize }
    },
    // Draw score feedback (delta) to the right of the progress bar.
    drawScoreFeedback(level, opts = {}) {
        if (!level || !level.state || !level.state.scoreTextVisible) return
        const canvas = level.state.canvas
        const ctx = level.state.ctx
        const barWidth = canvas.width * (opts.widthRatio || 0.5)
        const barHeight = canvas.height * (opts.heightRatio || 0.033)
        const barX = canvas.width / 2 - barWidth / 2
        const barY = canvas.height * (opts.topOffsetRatio || 0.033)
        const padding = opts.padding || 30
        const textX = barX + barWidth + padding
        const baseFontPx = canvas.height * (opts.baseFontRatio || 0.03)
        const points = level.state.scoreTextPoints || 0
        const minScore = level.params ? level.params.minScore : 0
        const maxScore = level.params ? level.params.maxScore : minScore + 1
        const { color, fontSize } = this.computeScoreFeedbackStyle(points, minScore, maxScore, baseFontPx)
        ctx.fillStyle = color
        ctx.font = `${fontSize}px Arial`
        ctx.textAlign = "left"
        const textY = barY + barHeight * 0.75
        ctx.fillText(level.state.scoreText, textX, textY)
    },
    // Particle helpers
    createParticles(level, x, y, count, config = {}) {
        if (!level || !level.state) return
        const particles = level.state.particles
        const speedMin = config.speedMin ?? 1
        const speedMax = config.speedMax ?? 5
        const sizeMin = config.sizeMin ?? 2
        const sizeMax = config.sizeMax ?? 4
        const lifeMin = config.lifeMin ?? 40
        const lifeMax = config.lifeMax ?? 90
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = Math.random() * (speedMax - speedMin) + speedMin
            const size = Math.random() * (sizeMax - sizeMin) + sizeMin
            const life = Math.random() * (lifeMax - lifeMin) + lifeMin
            const colorFn = config.colorFn || (() => `hsl(${Math.random() * 360},100%,70%)`)
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size,
                life,
                maxLife: life,
                color: colorFn(),
                fade: config.fade !== false,
            })
        }
    },
    updateParticles(level) {
        if (!level || !level.state) return
        const arr = level.state.particles
        for (let i = arr.length - 1; i >= 0; i--) {
            const p = arr[i]
            p.x += p.vx
            p.y += p.vy
            p.life -= 1
            if (p.life <= 0) arr.splice(i, 1)
        }
    },
    drawParticles(level) {
        if (!level || !level.state) return
        const ctx = level.state.ctx
        ctx.save()
        for (const p of level.state.particles) {
            const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1
            ctx.globalAlpha = alpha
            ctx.fillStyle = p.color
            ctx.fillRect(p.x, p.y, p.size, p.size)
        }
        ctx.restore()
    },
    // Feedback bubble helpers
    createFeedbackBubble(level, img, x, y, width, height, lifespan = 1500) {
        if (!level || !level.state) return
        level.state.feedbackBubbles.push({
            img,
            x: x - width / 2,
            y: y - height,
            width,
            height,
            creationTime: level.now ? level.now() : Date.now(),
            lifespan,
            opacity: 1,
        })
    },
    updateFeedbackBubbles(level, fadeMs = 500) {
        if (!level || !level.state) return
        const now = level.now ? level.now() : Date.now()
        const arr = level.state.feedbackBubbles
        for (let i = arr.length - 1; i >= 0; i--) {
            const b = arr[i]
            const elapsed = now - b.creationTime
            if (elapsed > b.lifespan) arr.splice(i, 1)
            else if (b.lifespan - elapsed < fadeMs) b.opacity = (b.lifespan - elapsed) / fadeMs
        }
    },
    drawFeedbackBubbles(level) {
        if (!level || !level.state) return
        const ctx = level.state.ctx
        ctx.save()
        for (const b of level.state.feedbackBubbles) {
            ctx.globalAlpha = b.opacity
            ctx.drawImage(b.img, b.x, b.y, b.width, b.height)
        }
        ctx.restore()
    },
    // Cancels a pending stimulus onset and the open response window.
    clearTrialSchedule(state) {
        if (!state) return
        state.stimulusDueTime = null
        state.responseDeadline = null
        state.onsetPending = false
    },
    ensureSharedPhaseCompleteSound(levelObj, basePath) {
        if (!levelObj) return null
        if (!phaseCompleteAudio && typeof Audio !== "undefined") {
            try {
                const a = new Audio()
                // basePath expected to end with '/'
                const base = basePath || ""
                a.src = base + "sound_phasecomplete.mp3"
                phaseCompleteAudio = a
            } catch (e) {
                console.debug("Failed to create phase-complete audio", e)
            }
        }
        return phaseCompleteAudio || null
    },
    playPhaseComplete(levelObj) {
        const shared = this.ensureSharedPhaseCompleteSound(
            levelObj,
            levelObj?.params?.assetBasePath
                ? levelObj.params.assetBasePath.endsWith("/")
                    ? levelObj.params.assetBasePath
                    : levelObj.params.assetBasePath + "/"
                : (levelObj && levelObj.assets && levelObj.assets.basePath) || "assets/",
        )
        if (shared) this.safePlay(shared, true)
    },
    startStimulusExit(state, nowFn, type) {
        if (!state || !state.stimulus || !nowFn) return
        const stim = state.stimulus
        stim.visible = false
        stim.exiting = true
        stim.exitType = type
        stim.exitStartTime = nowFn()
        stim.exitInitialX = stim.x
        stim.exitInitialY = stim.y
        stim.exitInitialWidth = stim.width
        stim.exitInitialHeight = stim.height
    },
    // Cache & tint a sprite. Cache stored on level.state.tintedSpriteCache
    getTintedSprite(level, img, color) {
        if (!img || !img.naturalWidth) return img
        if (!level.state.tintedSpriteCache) level.state.tintedSpriteCache = {}
        const key =
            img.src +
            "|" +
            color.replace(/(rgba\([^,]+,[^,]+,[^,]+,)([0-9]*\.?[0-9]+)\)/, (m, pre, a) => pre + parseFloat(a).toFixed(2) + ")")
        if (level.state.tintedSpriteCache[key]) return level.state.tintedSpriteCache[key]
        const c = document.createElement("canvas")
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        g.globalCompositeOperation = "source-atop"
        g.fillStyle = color
        g.fillRect(0, 0, c.width, c.height)
        level.state.tintedSpriteCache[key] = c
        return c
    },
    showScoreDelta(levelObj, points) {
        if (!levelObj) return
        const sign = points > 0 ? "+" : ""
        if (levelObj.state) levelObj.state.scoreTextPoints = points
        if (typeof levelObj.showScoreFeedback === "function") {
            levelObj.showScoreFeedback(`${sign}${Math.round(points)}`)
        } else {
            this.showScoreFeedback(levelObj, `${sign}${Math.round(points)}`)
        }
    },
    // Centralized helper to display transient score feedback text
    showScoreFeedback(levelObj, text, durationMs = 1000) {
        if (!levelObj || !levelObj.state) return
        levelObj.state.scoreText = text
        levelObj.state.scoreTextVisible = true
        if (levelObj.state.scoreTextTimeout) clearTimeout(levelObj.state.scoreTextTimeout)
        levelObj.state.scoreTextTimeout = setTimeout(() => {
            levelObj.state.scoreTextVisible = false
        }, durationMs)
    },
    // Centralized feedback bubble creator selecting correct asset by type
    showFeedbackBubble(levelObj, type, x, y, lifespan = 1500) {
        if (!levelObj || !levelObj.state) return
        const assets = levelObj.assets || {}
        const map = {
            slow: assets.imgFeedbackSlow,
            late: assets.imgFeedbackLate,
            early: assets.imgFeedbackEarly,
            fast1: assets.imgFeedbackFast1,
            fast2: assets.imgFeedbackFast2,
            fast3: assets.imgFeedbackFast3,
            error: assets.imgFeedbackError,
        }
        const img = map[type]
        if (!img || !img.naturalWidth) return
        const aspect = img.naturalWidth / img.naturalHeight
        const height = levelObj.state.canvas.height * (levelObj.params?.feedbackBubbleHeight || 0.1)
        const width = height * aspect
        levelObj.state.feedbackBubbles.push({
            img,
            x: x - width / 2,
            y: y - height,
            width,
            height,
            creationTime: levelObj.now ? levelObj.now() : Date.now(),
            lifespan,
            opacity: 1,
        })
    },
    getTrialTypeLabel(type) {
        return type === "timeout" ? "Timeout" : type.charAt(0).toUpperCase() + type.slice(1)
    },
    computeMedian(arr) {
        if (!arr || !arr.length) return null
        const s = [...arr].sort((a, b) => a - b)
        const m = Math.floor(s.length / 2)
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    },
    /**
     * Compute the end-of-level performance summary from a trial data log.
     * Performance score is the Inverse Efficiency Score (IES = meanCorrectRT / (1 - errorRate)),
     * Z-scored against population parameters and converted to a percentile.
     * @param {Array<object>} data - level.state.data records (with RT and Error fields).
     * @param {{populationMean?: number, populationSD?: number}} [params]
     * @returns {{meanRT:number, errorRate:number, ies:number, zIES:number, quantile:number}}
     */
    computeIES(data = [], params = {}) {
        const populationMean = params.populationMean || 300
        const populationSD = params.populationSD || 20
        const correctTrials = data.filter((d) => d.Error === 0 && d.RT !== "NA" && typeof d.RT === "number")

        if (!correctTrials.length || data.length === 0) {
            return { meanRT: null, errorRate: 1, ies: Infinity, zIES: Infinity, quantile: 0 }
        }

        const meanRT = correctTrials.reduce((a, d) => a + d.RT, 0) / correctTrials.length
        const errorRate = data.filter((d) => d.Error === 1).length / data.length

        if (errorRate >= 1) {
            return { meanRT, errorRate, ies: Infinity, zIES: Infinity, quantile: 0 }
        }

        const ies = meanRT / (1 - errorRate)
        const zIES = (ies - populationMean) / populationSD
        const quantile = DoggoNogoUI?.zScoreToQuantile ? DoggoNogoUI.zScoreToQuantile(zIES) : 0
        return { meanRT, errorRate, ies, zIES, quantile }
    },
}
