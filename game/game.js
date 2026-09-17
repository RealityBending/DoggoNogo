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

// Design canvas: 16:9, the aspect of nearly every screen the game runs on. (It was 7:4, which is
// what the image model outputs; that left letterbox bars on every real display.)
const REF_W = 1920
const REF_H = 1080
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

// ---------------------------------------------------------------------------
// Shared visual theme + canvas drawing helpers (`DoggoNogoUI.theme` / `.fx`).
// Everything is drawn in code. Two retro webfonts (below) are fetched at
// import time; every font stack carries system fallbacks, so an offline run
// simply renders with those and nothing breaks.
// ---------------------------------------------------------------------------
const THEME = {
    // Body/UI text: a CRT-terminal face. VT323 only ships weight 400; the weights
    // in font strings are kept for the fallback stack.
    font: `"VT323", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
    // Display/titles/score: a chunky arcade-cabinet pixel face. Glyphs are ~1em
    // wide, so display text runs much wider than the fallback — size accordingly.
    display: `"Press Start 2P", "Trebuchet MS", "Segoe UI", Arial, sans-serif`,
    ink: "#f4f6fb",
    inkSoft: "rgba(244,246,251,0.72)",
    inkFaint: "rgba(244,246,251,0.45)",
    bgDeep: "#0a0d18",
    bgMid: "#131a2e",
    panel: "rgba(9, 13, 25, 0.78)",
    panelBorder: "rgba(255,255,255,0.14)",
    accent: "#ffc857",
    accentHot: "#ff9f1c",
    accentSoft: "rgba(255,200,87,0.35)",
    // Secondary arcade accents: cool counterweights to the gold, used for trims,
    // brackets, rank tiers and the odd spark so the UI isn't monochrome-amber.
    accentCyan: "#4cc9f0",
    accentCyanSoft: "rgba(76,201,240,0.45)",
    accentPurple: "#c77dff",
    good: "#7bd88f",
    bad: "#ff6b6b",
    barTrack: "rgba(8, 10, 20, 0.55)",
    // Progress-bar segments, one per phase: a saturated green ramp (lime -> deep green -> cyan)
    // rather than the old pastel green/blue/purple. Two constraints shaped the picks. The gloss in
    // `drawProgressBar` lightens whatever goes under it, so these are chosen deeper than they read
    // on screen. And the middle one cannot be as deep as its hue invites: a much darker green in the
    // middle of a left-to-right ramp reads as a dark *band*, as if that phase were unlit, so its
    // lightness is lifted until the ramp climbs evenly while staying clearly deeper than the other
    // two. They also tint the phase-break banner (`drawBreakOverlay` in core.js), which is the other
    // reason they must stay distinguishable from each other.
    barColors: ["#9de000", "#00c25f", "#00d1e0"],
}

const easeOutCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
const easeOutBack = (t) => {
    const c = 1.70158
    const x = Math.min(1, Math.max(0, t)) - 1
    return 1 + (c + 1) * x * x * x + c * x * x
}
/** 0..1 sine pulse for breathing prompts. */
const pulse01 = (ms, period = 1200) => 0.5 + 0.5 * Math.sin((ms / period) * Math.PI * 2)

function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
}

/**
 * Draws `img` scaled to COVER the rectangle (x, y, w, h): the image keeps its own aspect ratio
 * and whatever overflows is cropped equally on both sides, like CSS `object-fit: cover`.
 *
 * Every background is painted this way rather than stretched to the canvas. The artwork comes
 * out of the image model at 7:4 while the stage is 16:9, and stretching would squash it by a
 * couple of percent; covering crops a sliver off the top and bottom instead, which nothing in
 * the scenes places anything essential in. `opts.focusY` (0..1, default 0.5) picks which part
 * survives a vertical crop.
 */
function drawImageCover(ctx, img, x, y, w, h, opts = {}) {
    if (!img || !img.naturalWidth || !img.naturalHeight || w <= 0 || h <= 0) return
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const sw = w / scale
    const sh = h / scale
    const sx = (img.naturalWidth - sw) / 2
    const sy = (img.naturalHeight - sh) * (opts.focusY ?? 0.5)
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/**
 * Translucent dark panel with border, soft drop shadow, a faint top bevel, and arcade-style
 * corner brackets (pass `opts.corners: false` to suppress them).
 */
function drawPanel(ctx, x, y, w, h, r, opts = {}) {
    // The radius the path actually gets (roundRectPath clamps it); the brackets must follow it.
    const rr = Math.min(r, w / 2, h / 2)
    ctx.save()
    ctx.shadowColor = "rgba(0,0,0,0.45)"
    ctx.shadowBlur = h * 0.15
    ctx.shadowOffsetY = h * 0.03
    roundRectPath(ctx, x, y, w, h, rr)
    ctx.fillStyle = opts.fill || THEME.panel
    ctx.fill()
    ctx.shadowColor = "transparent"
    // Top bevel: a soft light catching the upper edge, clipped to the panel so it rounds with it.
    ctx.save()
    roundRectPath(ctx, x, y, w, h, rr)
    ctx.clip()
    const bevel = ctx.createLinearGradient(0, y, 0, y + h * 0.18)
    bevel.addColorStop(0, "rgba(255,255,255,0.09)")
    bevel.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = bevel
    ctx.fillRect(x, y, w, h * 0.18)
    ctx.restore()
    ctx.strokeStyle = opts.border || THEME.panelBorder
    ctx.lineWidth = Math.max(1, h * 0.008)
    ctx.stroke()
    // Corner brackets: short cyan ticks hugging each corner, like a CRT menu frame — the cool
    // counterpoint to the theme's golden accent. Each bracket bends around its corner on an arc
    // concentric with the panel's own corner, so a rounded panel gets rounded brackets: the
    // square-elbowed ticks this used to draw read as a second, sharper frame inside the first.
    if (opts.corners !== false) {
        const L = Math.min(w, h) * 0.1
        const inset = Math.max(2, rr * 0.35)
        const cr = Math.max(0, rr - inset) // bracket corner radius, concentric with the panel's
        ctx.strokeStyle = opts.cornerColor || THEME.accentCyanSoft
        ctx.lineWidth = Math.max(1.5, h * 0.012)
        ctx.lineCap = "round"
        const corner = (cx, cy, dx, dy) => {
            ctx.beginPath()
            ctx.moveTo(cx + dx * (cr + L), cy)
            ctx.arcTo(cx, cy, cx, cy + dy * (cr + L), cr)
            ctx.lineTo(cx, cy + dy * (cr + L))
            ctx.stroke()
        }
        corner(x + inset, y + inset, 1, 1)
        corner(x + w - inset, y + inset, -1, 1)
        corner(x + inset, y + h - inset, 1, -1)
        corner(x + w - inset, y + h - inset, -1, -1)
    }
    ctx.restore()
}

/**
 * Draws a 3D-looking keyboard keycap centered on (cx, cy). `h` is the cap height;
 * labels longer than 2 chars (e.g. "SPACE") get a wide cap. Returns the cap width.
 */
function drawKeycap(ctx, cx, cy, h, label, opts = {}) {
    const isWord = String(label).length > 2
    const w = isWord ? h * 2.9 : h * 1.05
    const x = cx - w / 2
    const y = cy - h / 2
    const r = h * 0.22
    ctx.save()
    // Base (gives the key its depth)
    roundRectPath(ctx, x, y + h * 0.1, w, h, r)
    ctx.fillStyle = "rgba(0,0,0,0.5)"
    ctx.fill()
    // Cap body
    const g = ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, opts.top || "#2c3450")
    g.addColorStop(1, opts.bottom || "#161b2b")
    roundRectPath(ctx, x, y, w, h, r)
    ctx.fillStyle = g
    ctx.fill()
    // Cyan-tinted rim: reads as backlit arcade-cabinet keys.
    ctx.strokeStyle = opts.border || "rgba(140,215,255,0.45)"
    ctx.lineWidth = Math.max(1, h * 0.05)
    ctx.stroke()
    // Glyph. Words get the pixel display face (arcade cabinet keys); single glyphs like
    // "▼" stay on the body stack, which actually has the arrow glyphs.
    ctx.fillStyle = opts.ink || THEME.ink
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.font = isWord ? `${Math.round(h * 0.3)}px ${THEME.display}` : `700 ${Math.round(h * 0.52)}px ${THEME.font}`
    ctx.fillText(label, cx, cy + h * 0.03)
    ctx.restore()
    return w
}

/**
 * Text-with-glow sprite cache. `shadowBlur` on text is rasterized in software and costs
 * many milliseconds per frame at title sizes — re-drawing it every rAF is what made the
 * phase-break banner stutter. Each (text, size, style) combination is rendered once to an
 * offscreen canvas and blitted afterwards; animated text scales the cached sprite via
 * `opts.scale` instead of re-rendering at a new font size every frame.
 */
const textSpriteCache = new Map()

/**
 * Fetches the two retro webfonts (Press Start 2P for display text, VT323 for body text) from
 * Google Fonts. Canvas font strings fall back silently while a webfont is missing, so text drawn
 * before the fonts arrive is rendered with the system fallback and *cached that way* by
 * `getTextSprite` — hence the cache is cleared the moment the fonts become usable, and every
 * sprite re-rasterizes in the real face on its next draw. Offline (or with the CDN blocked) the
 * load simply never resolves and the fallback stacks stay in place.
 */
function ensureRetroFonts() {
    if (typeof document === "undefined" || document.getElementById("doggonogo-retro-fonts")) return
    try {
        const preconnect = (href, cross) => {
            const l = document.createElement("link")
            l.rel = "preconnect"
            l.href = href
            if (cross) l.crossOrigin = "anonymous"
            document.head.appendChild(l)
        }
        preconnect("https://fonts.googleapis.com")
        preconnect("https://fonts.gstatic.com", true)
        const link = document.createElement("link")
        link.id = "doggonogo-retro-fonts"
        link.rel = "stylesheet"
        link.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
        const armReload = () => {
            if (!document.fonts || !document.fonts.load) return
            Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('16px "VT323"')])
                .then(() => textSpriteCache.clear())
                .catch(() => {})
        }
        // The families are unknown until the stylesheet itself lands, so load them from its
        // onload; `fonts.ready` is a belt-and-braces second trigger.
        link.onload = armReload
        document.head.appendChild(link)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => textSpriteCache.clear()).catch(() => {})
    } catch (e) {
        console.debug("Retro font injection failed (fallback fonts in use)", e)
    }
}
ensureRetroFonts()

function getTextSprite(text, px, opts = {}) {
    const weight = opts.weight || 800
    const font = opts.font || THEME.display
    const color = opts.color || THEME.ink
    const glow = opts.glow || "rgba(0,0,0,0.85)"
    const glowSize = opts.glowSize ?? 0.25
    const letterSpacing = opts.letterSpacing || "0px"
    // Optional arcade-marquee extras (used by the title lockup): a hard keyline around the
    // glyphs and a flat offset shadow behind them. Both are baked into the sprite, so they
    // cost nothing per frame; leaving them off reproduces the plain glow text exactly.
    const outline = opts.outline || null
    const outlineWidth = opts.outlineWidth ?? 0.14 // fraction of the font size
    const hardShadow = opts.hardShadow || null
    const hardShadowDx = opts.hardShadowDx ?? 0
    const hardShadowDy = opts.hardShadowDy ?? 0.09
    const sizePx = Math.max(1, Math.round(px))
    const key = [text, sizePx, weight, font, color, glow, glowSize, letterSpacing, outline, outlineWidth, hardShadow, hardShadowDx, hardShadowDy].join("|")
    const hit = textSpriteCache.get(key)
    if (hit) return hit
    // Sprites are keyed by canvas size among other things; a resize repopulates the cache,
    // so keep it bounded rather than growing across resizes.
    if (textSpriteCache.size > 64) textSpriteCache.clear()
    const c = document.createElement("canvas")
    const g = c.getContext("2d")
    const setFont = () => {
        g.font = `${weight} ${sizePx}px ${font}`
        try {
            g.letterSpacing = letterSpacing
        } catch (e) {
            /* older browsers: no letter-spacing on canvas */
        }
    }
    setFont()
    const textW = g.measureText(text).width
    // The keyline is centered on the glyph edge and the drop shadow sits outside it, so both
    // widen the sprite; without the extra padding they would be clipped at the sprite's edge.
    const strokePx = outline ? Math.max(1, sizePx * outlineWidth) : 0
    const sdx = hardShadow ? sizePx * hardShadowDx : 0
    const sdy = hardShadow ? sizePx * hardShadowDy : 0
    const pad = Math.ceil(sizePx * (glowSize + 0.3) + strokePx + Math.max(Math.abs(sdx), Math.abs(sdy)))
    c.width = Math.max(1, Math.ceil(textW) + pad * 2)
    c.height = Math.max(1, Math.ceil(sizePx * 1.5) + pad * 2)
    setFont() // resizing a canvas resets its context state
    g.textAlign = "left"
    g.textBaseline = "alphabetic"
    g.lineJoin = "round"
    g.lineCap = "round"
    const baselineY = pad + sizePx
    // Flat offset shadow first: the glyph silhouette (fill plus keyline, so it matches the
    // outlined shape rather than the thinner letterform inside it).
    if (hardShadow) {
        g.fillStyle = hardShadow
        g.strokeStyle = hardShadow
        g.lineWidth = strokePx
        if (strokePx) g.strokeText(text, pad + sdx, baselineY + sdy)
        g.fillText(text, pad + sdx, baselineY + sdy)
    }
    g.shadowColor = glow
    g.shadowBlur = sizePx * glowSize
    g.shadowOffsetY = sizePx * 0.04
    // The halo belongs to the outermost layer, so it goes on the keyline when there is one
    // and is then switched off, or the fill would stamp a second halo over the keyline.
    if (outline) {
        g.strokeStyle = outline
        g.lineWidth = strokePx
        g.strokeText(text, pad, baselineY)
        g.shadowColor = "transparent"
    }
    g.fillStyle = color
    g.fillText(text, pad, baselineY)
    const sprite = { canvas: c, pad, baselineY, textW }
    textSpriteCache.set(key, sprite)
    return sprite
}

/**
 * Width of the glyphs `drawGlowText` would draw at `px`, before `opts.scale`. Lets a caller
 * lay out a multi-part lockup (and fit it to the canvas) without measuring text itself —
 * which matters because the retro faces and their system fallbacks have very different
 * metrics, so the same string is not the same width everywhere.
 */
function measureGlowText(text, px, opts = {}) {
    return getTextSprite(text, px, opts).textW
}

/**
 * Bold display text with a soft dark halo, for titles over artwork. Rendered through the
 * sprite cache above. To animate size, keep `px` constant and pass `opts.scale` (0..1+).
 * Honors the current `ctx.globalAlpha`.
 */
function drawGlowText(ctx, text, x, y, px, opts = {}) {
    if (!text) return
    const scale = opts.scale ?? 1
    if (scale <= 0.01) return
    const sprite = getTextSprite(text, px, opts)
    const align = opts.align || "center"
    let originX = x - sprite.pad * scale
    if (align === "center") originX = x - (sprite.pad + sprite.textW / 2) * scale
    else if (align === "right") originX = x - (sprite.pad + sprite.textW) * scale
    const originY = y - sprite.baselineY * scale
    ctx.drawImage(sprite.canvas, originX, originY, sprite.canvas.width * scale, sprite.canvas.height * scale)
}

/**
 * Draws a horizontal prompt row centered on (cx, cy), mixing plain text and keycaps.
 * `segments` is an array of `{ t: "Press" }` (text) or `{ k: "▼" }` (keycap) items,
 * e.g. [{t:"Press"},{k:"SPACE"},{t:"to continue"}]. `capH` sets the keycap height.
 */
function drawPromptRow(ctx, cx, cy, capH, segments, opts = {}) {
    ctx.save()
    const font = `600 ${Math.round(capH * 0.62)}px ${THEME.font}`
    ctx.font = font
    const gap = capH * 0.45
    const items = segments.map((s) => {
        if (s.k !== undefined) {
            const isWord = String(s.k).length > 2
            return { ...s, w: isWord ? capH * 2.9 : capH * 1.05 }
        }
        return { ...s, w: ctx.measureText(s.t).width }
    })
    let total = 0
    items.forEach((it, i) => {
        total += it.w
        if (i < items.length - 1) total += gap
    })
    let x = cx - total / 2
    for (const it of items) {
        if (it.k !== undefined) {
            drawKeycap(ctx, x + it.w / 2, cy, capH, it.k)
        } else {
            ctx.font = font
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillStyle = opts.color || THEME.ink
            ctx.shadowColor = "rgba(0,0,0,0.8)"
            ctx.shadowBlur = capH * 0.25
            ctx.fillText(it.t, x, cy + capH * 0.04)
            ctx.shadowColor = "transparent"
        }
        x += it.w + gap
    }
    ctx.restore()
}

/**
 * Tri-colour title underline: a slim cyan -> gold -> purple gradient rule that fades out at
 * both ends, centered on (cx). The one-line way to give a heading some arcade sparkle.
 */
function drawTitleRule(ctx, cx, y, width, thick) {
    const g = ctx.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0)
    g.addColorStop(0, "rgba(76,201,240,0)")
    g.addColorStop(0.22, THEME.accentCyan)
    g.addColorStop(0.5, THEME.accent)
    g.addColorStop(0.78, THEME.accentPurple)
    g.addColorStop(1, "rgba(199,125,255,0)")
    ctx.save()
    ctx.fillStyle = g
    ctx.fillRect(cx - width / 2, y, width, Math.max(1.5, thick))
    ctx.restore()
}

/** Darkens the canvas edges so UI and artwork read against any background. */
function drawVignette(ctx, w, h, strength = 0.55) {
    ctx.save()
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72)
    g.addColorStop(0, "rgba(0,0,0,0)")
    g.addColorStop(1, `rgba(0,0,0,${strength})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
}

export const DoggoNogoUI = {
    // Shared visual language: colors/fonts plus the low-level drawing helpers,
    // consumed by the engine, the intro runner and the levels.
    theme: THEME,
    fx: {
        roundRectPath,
        drawImageCover,
        drawPanel,
        drawKeycap,
        drawGlowText,
        measureGlowText,
        drawVignette,
        drawPromptRow,
        drawTitleRule,
        easeOutCubic,
        easeOutBack,
        pulse01,
        scaleFontPx,
    },

    /**
     * The artwork currently on stage, for whatever frames the canvas to paint behind it.
     *
     * The stage keeps a fixed aspect for the sake of the measurements, so on any screen of a
     * different shape there is a letterbox. A flat colour there reads as bars; the host page
     * (`game/index.html`) instead paints a blurred, darkened, cover-scaled copy of the current
     * scene into it, the way video players extend a picture. The engine calls `set()` at each
     * scene change (cover art, cutscene, level background, phase-break swap, score screen) and
     * the host subscribes with `onChange()`. `null` means "nothing on stage", and the host falls
     * back to its plain gradient. Embedded hosts that don't subscribe are unaffected.
     */
    ambient: {
        image: null,
        _listeners: new Set(),
        set(img) {
            const next = img && img.naturalWidth ? img : null
            if (next === this.image) return
            this.image = next
            this._listeners.forEach((fn) => {
                try {
                    fn(next)
                } catch (e) {
                    console.debug("ambient listener failed", e)
                }
            })
        },
        onChange(fn) {
            this._listeners.add(fn)
            return () => this._listeners.delete(fn)
        },
    },

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

    /**
     * End-of-level report card: dark stage, the player's sprite in a spotlight, an animated
     * ring gauge counting up to the percentile, a rank title and celebratory confetti.
     * The loop keeps running (confetti + pulsing hint) until `cancelScoreScreen()` — which the
     * engine calls before every run and on stop.
     */
    showScoreScreen(canvas, quantile, options = {}) {
        const { hint, playerSprite } = options || {}
        const ctx = canvas.getContext("2d")
        const countDuration = 2400 // ms for the gauge/number count-up
        let startTime = null
        // Never leave two of these animating the same canvas.
        DoggoNogoUI.cancelScoreScreen()

        const q = Math.min(100, Math.max(0, quantile || 0))
        const rank = q >= 90 ? "LEGENDARY REFLEXES" : q >= 70 ? "BLAZING FAST" : q >= 50 ? "QUICK PAWS" : q >= 25 ? "SOLID EFFORT" : "WARMING UP"
        // Rank tiers carry their own colour, like arcade medal grades.
        const rankColor = q >= 90 ? THEME.accentPurple : q >= 70 ? THEME.accent : q >= 50 ? THEME.accentCyan : q >= 25 ? THEME.good : THEME.inkSoft
        const confettiColors = [THEME.accent, "#4cc9f0", "#7bd88f", "#ff6b6b", "#c77dff", "#ffffff"]
        const confetti = []
        const spawnConfetti = (n, w, h) => {
            for (let i = 0; i < n; i++) {
                confetti.push({
                    x: Math.random() * w,
                    y: -Math.random() * h * 0.6,
                    size: (Math.random() * 0.6 + 0.4) * h * 0.012,
                    vy: (Math.random() * 0.9 + 0.5) * h * 0.0035,
                    sway: Math.random() * Math.PI * 2,
                    swaySpeed: Math.random() * 0.06 + 0.02,
                    rot: Math.random() * Math.PI,
                    vrot: (Math.random() - 0.5) * 0.15,
                    color: confettiColors[i % confettiColors.length],
                })
            }
        }

        const animateScore = (timestamp) => {
            if (!startTime) {
                startTime = timestamp
                spawnConfetti(Math.round(120), canvas.width, canvas.height)
            }
            const elapsed = timestamp - startTime
            const progress = Math.min(elapsed / countDuration, 1)
            const eased = easeOutCubic(progress)
            const shown = eased * q
            const w = canvas.width
            const h = canvas.height

            // Stage
            const bg = ctx.createLinearGradient(0, 0, 0, h)
            bg.addColorStop(0, THEME.bgMid)
            bg.addColorStop(1, THEME.bgDeep)
            ctx.fillStyle = bg
            ctx.fillRect(0, 0, w, h)
            drawVignette(ctx, w, h, 0.5)

            // Title
            drawGlowText(ctx, "LEVEL COMPLETE", w / 2, h * 0.14, h * 0.052, {
                color: THEME.ink,
                letterSpacing: `${Math.round(h * 0.002)}px`,
            })
            drawTitleRule(ctx, w / 2, h * 0.162, w * 0.24, h * 0.004)
            // Rank reveal once the counter settles
            if (progress >= 1) {
                const rankIn = easeOutBack(Math.min(1, (elapsed - countDuration) / 400))
                ctx.save()
                ctx.globalAlpha = Math.min(1, (elapsed - countDuration) / 300)
                drawGlowText(ctx, rank, w / 2, h * 0.225, h * 0.026, {
                    color: rankColor,
                    letterSpacing: `${Math.round(h * 0.002)}px`,
                    scale: rankIn,
                })
                ctx.restore()
            }

            // Player sprite in a spotlight, gently bobbing
            const spriteCx = w * 0.28
            const spriteCy = h * 0.58
            ctx.save()
            const spot = ctx.createRadialGradient(spriteCx, spriteCy, h * 0.02, spriteCx, spriteCy, h * 0.34)
            spot.addColorStop(0, "rgba(255, 220, 150, 0.18)")
            spot.addColorStop(1, "rgba(255, 220, 150, 0)")
            ctx.fillStyle = spot
            ctx.fillRect(0, 0, w, h)
            ctx.restore()
            if (playerSprite && playerSprite.complete) {
                const bob = Math.sin(elapsed / 620) * h * 0.008
                const aspectRatio = playerSprite.naturalWidth / playerSprite.naturalHeight
                const displayHeight = h * 0.46
                const displayWidth = displayHeight * aspectRatio
                // Ground shadow
                ctx.save()
                ctx.fillStyle = "rgba(0,0,0,0.4)"
                ctx.beginPath()
                ctx.ellipse(spriteCx, spriteCy + displayHeight / 2, displayWidth * 0.36, h * 0.02, 0, 0, Math.PI * 2)
                ctx.fill()
                ctx.restore()
                ctx.drawImage(playerSprite, spriteCx - displayWidth / 2, spriteCy - displayHeight / 2 + bob, displayWidth, displayHeight)
            }

            // Percentile ring gauge
            const ringCx = w * 0.66
            const ringCy = h * 0.55
            const ringR = h * 0.2
            const ringW = h * 0.028
            drawGlowText(ctx, "Speed and accuracy of your reflexes:", ringCx, ringCy - ringR - h * 0.06, h * 0.034, {
                color: THEME.inkSoft,
                weight: 600,
                font: THEME.font,
            })
            ctx.save()
            ctx.lineWidth = ringW
            ctx.lineCap = "round"
            // Track
            ctx.strokeStyle = "rgba(255,255,255,0.1)"
            ctx.beginPath()
            ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2)
            ctx.stroke()
            // Fill arc
            if (shown > 0.2) {
                const a0 = -Math.PI / 2
                const a1 = a0 + (Math.PI * 2 * shown) / 100
                const rg = ctx.createLinearGradient(ringCx - ringR, ringCy, ringCx + ringR, ringCy)
                rg.addColorStop(0, THEME.accentHot)
                rg.addColorStop(1, THEME.accent)
                ctx.strokeStyle = rg
                ctx.shadowColor = THEME.accentSoft
                ctx.shadowBlur = ringW * 1.4
                ctx.beginPath()
                ctx.arc(ringCx, ringCy, ringR, a0, a1)
                ctx.stroke()
            }
            ctx.restore()
            // Number inside the ring
            ctx.save()
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillStyle = THEME.ink
            ctx.font = `${Math.round(h * 0.075)}px ${THEME.display}`
            ctx.fillText(`${Math.floor(shown)}%`, ringCx, ringCy - h * 0.012)
            ctx.fillStyle = THEME.inkSoft
            ctx.font = `600 ${Math.round(h * 0.028)}px ${THEME.font}`
            ctx.fillText("OF PLAYERS BEATEN", ringCx, ringCy + h * 0.058)
            ctx.restore()

            // Confetti (starts falling immediately; recycled for the first few seconds)
            ctx.save()
            for (const c of confetti) {
                c.y += c.vy
                c.sway += c.swaySpeed
                c.x += Math.sin(c.sway) * h * 0.0012
                c.rot += c.vrot
                if (c.y > h + c.size && elapsed < 6000) {
                    c.y = -c.size * 2
                    c.x = Math.random() * w
                }
                if (c.y > h + c.size) continue
                ctx.save()
                ctx.translate(c.x, c.y)
                ctx.rotate(c.rot)
                ctx.fillStyle = c.color
                ctx.globalAlpha = 0.9
                ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2)
                ctx.restore()
            }
            ctx.restore()

            // Continue hint, breathing, once the count has settled
            if (hint && progress >= 1) {
                ctx.save()
                ctx.globalAlpha = 0.55 + 0.45 * pulse01(elapsed, 1400)
                drawGlowText(ctx, hint, w / 2, h * 0.92, h * 0.028, { color: THEME.accent, weight: 600, font: THEME.font })
                ctx.restore()
            }

            scoreScreenRafId = requestAnimationFrame(animateScore)
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
            const w = target.width
            const h = target.height
            ctx.save()
            // Dark stage with a faint center glow
            const bg = ctx.createLinearGradient(0, 0, 0, h)
            bg.addColorStop(0, THEME.bgMid)
            bg.addColorStop(1, THEME.bgDeep)
            ctx.fillStyle = bg
            ctx.fillRect(0, 0, w, h)
            const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.6)
            glow.addColorStop(0, "rgba(255, 200, 87, 0.06)")
            glow.addColorStop(1, "rgba(255, 200, 87, 0)")
            ctx.fillStyle = glow
            ctx.fillRect(0, 0, w, h)

            // Two-tone logo. The colours are the cover screen's wordmark, word for word (see
            // `styleDoggo` / `styleNogo` / `styleSlash` in engine.js `showCoverScreen`): gold
            // hero, cyan villain, purple slash. The loading screen used to run them the other
            // way round, so the title changed colour between the two screens.
            const titlePx = Math.round(h * 0.045)
            ctx.font = `800 ${titlePx}px ${THEME.display}`
            const wDog = ctx.measureText("DOGGO").width
            const wSlash = ctx.measureText(" / ").width
            const wNogo = ctx.measureText("NOGO").width
            let tx = w / 2 - (wDog + wSlash + wNogo) / 2
            drawGlowText(ctx, "DOGGO", tx, h * 0.42, titlePx, { color: THEME.accent, align: "left" })
            drawGlowText(ctx, " / ", tx + wDog, h * 0.42, titlePx, { color: THEME.accentPurple, align: "left" })
            drawGlowText(ctx, "NOGO", tx + wDog + wSlash, h * 0.42, titlePx, { color: THEME.accentCyan, align: "left" })
            ctx.textAlign = "center"
            ctx.fillStyle = THEME.inkSoft
            ctx.font = `600 ${Math.round(h * 0.032)}px ${THEME.font}`
            ctx.fillText(message, w / 2, h * 0.5)

            if (typeof progress === "number") {
                const p = Math.min(1, Math.max(0, progress))
                const barW = w * 0.4
                const barH = Math.max(8, Math.round(h * 0.016))
                const barX = w / 2 - barW / 2
                const barY = h * 0.56
                // Track
                roundRectPath(ctx, barX, barY, barW, barH, barH / 2)
                ctx.fillStyle = "rgba(255,255,255,0.09)"
                ctx.fill()
                ctx.strokeStyle = "rgba(255,255,255,0.15)"
                ctx.lineWidth = 1
                ctx.stroke()
                // Fill
                if (p > 0.01) {
                    const fg = ctx.createLinearGradient(barX, 0, barX + barW, 0)
                    fg.addColorStop(0, THEME.accentHot)
                    fg.addColorStop(1, THEME.accent)
                    ctx.save()
                    roundRectPath(ctx, barX, barY, barW * p, barH, barH / 2)
                    ctx.shadowColor = THEME.accentSoft
                    ctx.shadowBlur = barH
                    ctx.fillStyle = fg
                    ctx.fill()
                    ctx.restore()
                }
                ctx.fillStyle = THEME.inkFaint
                ctx.font = `600 ${Math.round(h * 0.02)}px ${THEME.font}`
                ctx.fillText(`${Math.round(p * 100)}%`, w / 2, barY + barH + h * 0.035)
            }
            ctx.restore()
        } else if (target instanceof HTMLElement) {
            target.innerHTML =
                `<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;background:#0a0d18;font:600 20px 'Segoe UI',Arial,sans-serif;color:#f4f6fb;">` +
                `<div style="text-align:center;">${message}</div></div>`
        }
    },
    /**
     * The curtain: painted once there is no level left to run, so the last score screen does not
     * just sit there with a "Press SPACE to finish" prompt that finishes nothing.
     *
     * Standalone only. An embedded run (jsPsych) has a timeline to go back to, and telling that
     * participant to close the tab would lose the rest of the study, so `game/jspsych.js` never
     * calls this — see `runLevel` in game/index.html for the one caller.
     *
     * Deliberately terminal: nothing is bound to a key here, because there is nothing left to
     * advance to.
     */
    renderEndScreen(target, message = "You can now close this tab.") {
        if (!(target instanceof HTMLCanvasElement)) return
        const ctx = target.getContext("2d")
        if (!ctx) return
        // The score screen this replaces is still animating: its confetti-and-pulsing-hint loop
        // runs until cancelled (see `showScoreScreen`), and the engine only cancels it on its way
        // INTO the next level — which is exactly what does not happen when there is no next level.
        // Without this, the end screen is painted and repainted over on the following frame, and
        // pressing SPACE looks like it does nothing at all.
        DoggoNogoUI.cancelScoreScreen()
        const w = target.width
        const h = target.height
        ctx.save()
        // Same dark stage as the loading screen, so the session opens and closes on one backdrop.
        const bg = ctx.createLinearGradient(0, 0, 0, h)
        bg.addColorStop(0, THEME.bgMid)
        bg.addColorStop(1, THEME.bgDeep)
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.6)
        glow.addColorStop(0, "rgba(255, 200, 87, 0.07)")
        glow.addColorStop(1, "rgba(255, 200, 87, 0)")
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, w, h)

        const titlePx = Math.round(h * 0.06)
        drawGlowText(ctx, "THE END.", w / 2, h * 0.46, titlePx, { color: THEME.accent, font: THEME.display })
        drawTitleRule(ctx, w / 2, h * 0.54, w * 0.22, Math.max(2, h * 0.004))

        ctx.textAlign = "center"
        ctx.fillStyle = THEME.ink
        ctx.font = `600 ${Math.round(h * 0.036)}px ${THEME.font}`
        ctx.fillText("Thanks for playing.", w / 2, h * 0.63)
        ctx.fillStyle = THEME.inkSoft
        ctx.font = `600 ${Math.round(h * 0.03)}px ${THEME.font}`
        ctx.fillText(message, w / 2, h * 0.69)

        drawVignette(ctx, w, h, 0.5)
        ctx.restore()
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
    // Draw the top progress bar — an arcade "life bar": a slanted metal casing holding twelve
    // energy cells across the three phase segments, with a hot leading edge, a travelling shine,
    // spark bursts while the bar is charging, and a flash + shockwave ring when a phase segment
    // fills. Purely visual: the fill eases toward the true score each frame, but the underlying
    // score/phase logic is untouched.
    drawProgressBar(level, opts = {}) {
        if (!level || !level.state) return
        const ctx = level.state.ctx
        const canvas = level.state.canvas
        const state = level.state
        const widthRatio = opts.widthRatio || 0.5
        const heightRatio = opts.heightRatio || 0.033
        const topOffsetRatio = opts.topOffsetRatio || 0.033
        const colors = opts.colors || THEME.barColors
        const barWidth = canvas.width * widthRatio
        const barHeight = canvas.height * heightRatio
        const x = canvas.width / 2 - barWidth / 2
        const y = canvas.height * topOffsetRatio
        const t = typeof state.frameTime === "number" && state.frameTime ? state.frameTime : Date.now()

        // Smoothed display score (visual only)
        if (typeof state._barDisplayScore !== "number") state._barDisplayScore = state.score
        state._barDisplayScore += (state.score - state._barDisplayScore) * 0.14
        if (Math.abs(state.score - state._barDisplayScore) < 0.5) state._barDisplayScore = state.score
        const displayScore = state._barDisplayScore
        // How hard the bar is currently working, 0 at rest to 1 while a fresh award is
        // still being absorbed, measured in units of one minimum award. The resting bar
        // used to bloom at full strength permanently, which read as activity when nothing
        // was happening; the effects below scale with this instead.
        const award = (level.params && level.params.minScore) || 100
        const charging = Math.min(1, Math.max(0, (state.score - displayScore) / award))

        const segWidth = barWidth / 3
        const phaseTargets = typeof level.getPhaseTargets === "function" ? level.getPhaseTargets() : [1, 1, 1]

        // Per-run effect bookkeeping (visual only; lives on state so a restart resets it)
        if (!state._barFx) state._barFx = { sparks: [], flashUntil: 0, flashX: x + barWidth, cleared: 0 }
        const fx = state._barFx

        // Per-segment fill fractions and the position of the leading edge
        const bounds = []
        let acc = 0
        for (let i = 0; i < 3; i++) {
            acc += phaseTargets[i] || 0
            bounds.push(acc)
        }
        const fracs = []
        let tipX = null
        for (let i = 0; i < 3; i++) {
            const startScore = i === 0 ? 0 : bounds[i - 1]
            const span = Math.max(1e-6, bounds[i] - startScore)
            const frac = Math.min(1, Math.max(0, (displayScore - startScore) / span))
            fracs.push(frac)
            if (frac > 0 && frac < 1 && tipX === null) tipX = x + i * segWidth + segWidth * frac
        }
        if (tipX === null && displayScore > 0 && displayScore >= bounds[2] - 0.5) tipX = x + barWidth

        // Segment-clear detection: flash + ring the moment a boundary (or the full bar) lights up.
        let cleared = 0
        for (let i = 0; i < 3; i++) if (displayScore >= bounds[i] - 0.5 && bounds[i] > 0) cleared = i + 1
        if (cleared > fx.cleared) {
            fx.flashUntil = t + 520
            fx.flashX = x + cleared * segWidth
        }
        fx.cleared = cleared

        // Everything up to the ring/sparks is drawn in a sheared frame, which turns plain rects
        // into the slanted parallelograms of a fighting-game health bar. The shear pivots on the
        // bar's vertical center, so x coordinates at mid-height are unchanged.
        const shear = 0.5
        const yMid = y + barHeight / 2
        ctx.save()
        ctx.transform(1, 0, -shear, 1, shear * yMid, 0)

        // Casing: dark metal shell with a top bevel
        const pad = barHeight * 0.32
        ctx.save()
        ctx.shadowColor = "rgba(0,0,0,0.55)"
        ctx.shadowBlur = barHeight * 0.7
        ctx.shadowOffsetY = barHeight * 0.18
        const shell = ctx.createLinearGradient(0, y - pad, 0, y + barHeight + pad)
        shell.addColorStop(0, "#39415c")
        shell.addColorStop(0.5, "#191f31")
        shell.addColorStop(1, "#0b0e18")
        ctx.fillStyle = shell
        ctx.fillRect(x - pad, y - pad, barWidth + pad * 2, barHeight + pad * 2)
        ctx.restore()
        ctx.strokeStyle = "rgba(0,0,0,0.65)"
        ctx.lineWidth = Math.max(1, barHeight * 0.08)
        ctx.strokeRect(x - pad, y - pad, barWidth + pad * 2, barHeight + pad * 2)
        ctx.fillStyle = "rgba(255,255,255,0.18)"
        ctx.fillRect(x - pad, y - pad, barWidth + pad * 2, Math.max(1, barHeight * 0.07))

        // Track: near-black well with an inner top shadow
        ctx.fillStyle = "#05070d"
        ctx.fillRect(x, y, barWidth, barHeight)
        const well = ctx.createLinearGradient(0, y, 0, y + barHeight * 0.55)
        well.addColorStop(0, "rgba(0,0,0,0.6)")
        well.addColorStop(1, "rgba(0,0,0,0)")
        ctx.fillStyle = well
        ctx.fillRect(x, y, barWidth, barHeight * 0.55)

        // Fills, gloss, cells, sweep and flash all stay inside the track
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, barWidth, barHeight)
        ctx.clip()

        for (let i = 0; i < 3; i++) {
            const frac = fracs[i]
            if (frac <= 0) continue
            const base = colors[i % colors.length]
            const fx0 = x + i * segWidth
            const fw = segWidth * frac
            ctx.fillStyle = base
            ctx.fillRect(fx0, y, fw, barHeight)
            // Arcade gloss: bright cap on the top half, weight on the bottom
            // Arcade gloss. The top highlight is deliberately lighter than a classic glass bevel:
            // at 0.55 white it washed the segment colours out to pastel, which defeated the point
            // of a saturated palette. The dark weight underneath does most of the shaping instead.
            const gloss = ctx.createLinearGradient(0, y, 0, y + barHeight)
            gloss.addColorStop(0, "rgba(255,255,255,0.30)")
            gloss.addColorStop(0.42, "rgba(255,255,255,0.07)")
            gloss.addColorStop(0.55, "rgba(255,255,255,0)")
            gloss.addColorStop(1, "rgba(0,0,0,0.38)")
            ctx.fillStyle = gloss
            ctx.fillRect(fx0, y, fw, barHeight)
            // Near-full pulse: the segment breathes as it approaches its boundary
            if (frac > 0.92 && frac < 1) {
                ctx.fillStyle = `rgba(255,255,255,${0.07 + 0.09 * pulse01(t, 420)})`
                ctx.fillRect(fx0, y, fw, barHeight)
            }
        }

        // Energy-cell dividers (12 cells; boundaries between phases get studs instead)
        ctx.fillStyle = "rgba(0,0,0,0.4)"
        for (let j = 1; j < 12; j++) {
            if (j % 4 === 0) continue
            ctx.fillRect(x + (barWidth / 12) * j - barHeight * 0.035, y, Math.max(1, barHeight * 0.07), barHeight)
        }

        // Travelling shine: a soft diagonal band sweeping the filled portion
        if (displayScore > 0) {
            const sweepX = x + ((t % 2600) / 2600) * (barWidth + barHeight * 4) - barHeight * 2
            const shine = ctx.createLinearGradient(sweepX - barHeight * 1.4, 0, sweepX + barHeight * 1.4, 0)
            shine.addColorStop(0, "rgba(255,255,255,0)")
            shine.addColorStop(0.5, "rgba(255,255,255,0.22)")
            shine.addColorStop(1, "rgba(255,255,255,0)")
            ctx.fillStyle = shine
            for (let i = 0; i < 3; i++) {
                if (fracs[i] > 0) ctx.fillRect(x + i * segWidth, y, segWidth * fracs[i], barHeight)
            }
        }

        // Hot leading edge: a seam marking the fill position, with a glow bloom behind it.
        // Bloom, seam and flicker depth all scale with `charging`, so at rest this is a calm
        // position marker and it only turns white-hot while points are landing. The seam
        // keeps a floor of its own: it is the one part that carries information (where the
        // fill has reached) and has to stay legible on a bar nobody is feeding.
        if (tipX !== null && displayScore < bounds[2] - 0.5) {
            const flickerDepth = 0.08 + 0.27 * charging
            const flicker = 1 - flickerDepth + flickerDepth * Math.sin(t / 70)
            const bloom = (0.12 + 0.38 * charging) * flicker
            const seam = (0.4 + 0.45 * charging) * flicker
            const glow = ctx.createRadialGradient(tipX, yMid, 0, tipX, yMid, barHeight * 1.5)
            glow.addColorStop(0, `rgba(255,240,200,${bloom})`)
            glow.addColorStop(1, "rgba(255,240,200,0)")
            ctx.fillStyle = glow
            ctx.fillRect(tipX - barHeight * 1.5, y, barHeight * 3, barHeight)
            ctx.fillStyle = `rgba(255,255,255,${seam})`
            ctx.fillRect(tipX - Math.max(1, barHeight * 0.06), y, Math.max(2, barHeight * 0.12), barHeight)
        }

        // Segment-clear flash: white surge fading out over the whole bar
        if (t < fx.flashUntil) {
            const rem = (fx.flashUntil - t) / 520
            ctx.fillStyle = `rgba(255,255,255,${0.55 * rem * rem})`
            ctx.fillRect(x, y, barWidth, barHeight)
        }
        ctx.restore() // un-clip

        // Phase-boundary studs: diamond rivets that ignite once their segment is cleared
        for (let i = 1; i < 3; i++) {
            const px = x + i * segWidth
            const lit = displayScore >= bounds[i - 1] - 0.5 && bounds[i - 1] > 0
            const s = barHeight * 0.42
            ctx.save()
            ctx.translate(px, yMid)
            ctx.rotate(Math.PI / 4)
            if (lit) {
                // Halved: a stud stays lit for the rest of the level, so its glow is
                // permanent and was carrying much of the bar's resting brightness.
                ctx.shadowColor = THEME.accent
                ctx.shadowBlur = barHeight * 0.45
            }
            ctx.fillStyle = lit ? THEME.accent : "#0a0d18"
            ctx.fillRect(-s / 2, -s / 2, s, s)
            ctx.shadowColor = "transparent"
            ctx.strokeStyle = lit ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)"
            ctx.lineWidth = Math.max(1, barHeight * 0.06)
            ctx.strokeRect(-s / 2, -s / 2, s, s)
            ctx.restore()
        }
        ctx.restore() // un-shear

        // Shockwave ring on segment clear (drawn unsheared so it stays circular)
        if (t < fx.flashUntil) {
            const p = 1 - (fx.flashUntil - t) / 520
            ctx.save()
            ctx.strokeStyle = THEME.accent
            ctx.globalAlpha = (1 - p) * 0.9
            ctx.lineWidth = Math.max(1.5, barHeight * 0.12 * (1 - p))
            ctx.beginPath()
            ctx.arc(fx.flashX, yMid, barHeight * (0.4 + 2.8 * easeOutCubic(p)), 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
        }

        // Charging sparks: embers fly off the leading edge while the fill is catching up
        if (tipX !== null && state.score - displayScore > 1 && fx.sparks.length < 60) {
            const n = 1 + Math.floor(Math.random() * 2)
            for (let i = 0; i < n; i++) {
                const roll = Math.random() // mostly gold embers, with white and cyan glints mixed in
                const sparkColor = roll < 0.55 ? THEME.accent : roll < 0.82 ? "#ffffff" : THEME.accentCyan
                fx.sparks.push({
                    x: tipX,
                    y: yMid + (Math.random() - 0.5) * barHeight * 0.8,
                    vx: (Math.random() * 1.6 + 0.4) * (Math.random() < 0.8 ? 1 : -0.4) * (barHeight * 0.06),
                    vy: -(Math.random() * 1.4 + 0.3) * (barHeight * 0.06),
                    size: Math.max(1.5, (Math.random() * 0.5 + 0.3) * barHeight * 0.22),
                    life: Math.random() * 22 + 16,
                    maxLife: 38,
                    color: sparkColor,
                })
            }
        }
        if (fx.sparks.length) {
            ctx.save()
            for (let i = fx.sparks.length - 1; i >= 0; i--) {
                const s = fx.sparks[i]
                s.x += s.vx
                s.y += s.vy
                s.vy += barHeight * 0.004 // light gravity
                s.life -= 1
                if (s.life <= 0) {
                    fx.sparks.splice(i, 1)
                    continue
                }
                ctx.globalAlpha = Math.max(0, s.life / s.maxLife)
                ctx.fillStyle = s.color
                ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size)
            }
            ctx.restore()
        }
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
    // Draw score feedback (delta) to the right of the progress bar: pops in with a small
    // overshoot, floats upward and fades out. Purely visual.
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

        const now = typeof level.state.frameTime === "number" && level.state.frameTime ? level.state.frameTime : level.now ? level.now() : Date.now()
        const shownAt = level.state.scoreTextShownAt || now
        const elapsed = Math.max(0, now - shownAt)
        const life = 1000
        const t = Math.min(1, elapsed / life)
        const pop = easeOutBack(Math.min(1, elapsed / 200))
        const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35
        const rise = easeOutCubic(t) * barHeight * 1.1

        ctx.save()
        ctx.globalAlpha = Math.max(0, alpha)
        ctx.fillStyle = color
        ctx.font = `800 ${Math.round(fontSize * pop)}px ${THEME.display}`
        ctx.textAlign = "left"
        ctx.shadowColor = "rgba(0,0,0,0.75)"
        ctx.shadowBlur = fontSize * 0.2
        ctx.shadowOffsetY = fontSize * 0.05
        const textY = barY + barHeight * 0.75 - rise
        ctx.fillText(level.state.scoreText, textX, textY)
        ctx.restore()
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
        // Timestamp drives the pop/rise/fade animation in drawScoreFeedback.
        levelObj.state.scoreTextShownAt = levelObj.now ? levelObj.now() : Date.now()
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
