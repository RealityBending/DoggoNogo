/**
 * @file Plain (non-gamified) screens, for the `?gamified=0` comparison condition.
 *
 * REMOVABLE: see the header of ./stimuli.js.
 *
 * Everything the game paints between trials — cover art, wordmark, badges, glow type, keycaps,
 * panels, confetti, the percentile gauge — is replaced here by black system text on the same flat
 * mid-grey the trials run on, so a participant never leaves that backdrop.
 *
 * These screens are static in content but, like the game's, they REPAINT EVERY FRAME. That is not
 * decoration: `sizeCanvas()` in the host page reassigns `canvas.width` on every resize, which
 * resets the backing store to transparent. A screen painted once therefore vanishes the moment the
 * window changes size — including at the fullscreen transition the start screen itself triggers.
 * Running the same requestAnimationFrame lifecycle the game uses also means the instruction screen
 * is torn down by `beginLevel` -> `cancelInstructionScreen` exactly as the game's is.
 *
 * Wording adapts to touch the same way the game's does (`DoggoNogoInput.isTouch`), because the
 * response hardware is a property of the session, not of the condition.
 */

import { DoggoNogoUI } from "../game.js"
import { DoggoNogoInput } from "../input.js"

/** Mid-grey backdrop and near-black ink: the same surface the trials are drawn on. */
export const PLAIN_THEME = {
    background: "#808080",
    ink: "#111111",
    inkSoft: "#333333",
    font: `"Helvetica Neue", Arial, sans-serif`,
}

/** "Press SPACE" / "Tap the screen", depending on what the participant is actually using. */
function pressSpace(verb = "continue") {
    return DoggoNogoInput.isTouch ? `Tap the screen to ${verb}` : `Press SPACE to ${verb}`
}

/** A level's prompt names its own keys, so it is given as a function and read at paint time. */
function resolvePrompt(prompt) {
    return typeof prompt === "function" ? prompt() : prompt
}

/**
 * Paints a centred block of text on the plain backdrop.
 *
 * Sizes come from `DoggoNogoUI.fx.scaleFontPx`, the same 1920x1080 reference scaling the game uses,
 * so the two conditions put type at the same visual size on the same display.
 */
function paintTextBlock(canvas, { title, lines = [], prompt }) {
    const ctx = canvas.getContext("2d")
    const { scaleFontPx } = DoggoNogoUI.fx
    const w = canvas.width
    const h = canvas.height

    ctx.save()
    ctx.fillStyle = PLAIN_THEME.background
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const bodyPx = scaleFontPx(30, canvas)
    const titlePx = scaleFontPx(44, canvas)
    const lineH = bodyPx * 1.9
    // The block is centred as a whole, title included, so screens with different numbers of lines
    // still sit on the same optical centre.
    const blockH = (title ? titlePx * 2.2 : 0) + lines.length * lineH
    let y = h / 2 - blockH / 2

    if (title) {
        ctx.fillStyle = PLAIN_THEME.ink
        ctx.font = `bold ${titlePx}px ${PLAIN_THEME.font}`
        ctx.fillText(title, w / 2, y + titlePx * 0.6)
        y += titlePx * 2.2
    }
    ctx.fillStyle = PLAIN_THEME.ink
    ctx.font = `${bodyPx}px ${PLAIN_THEME.font}`
    lines.forEach((line, i) => ctx.fillText(line, w / 2, y + i * lineH + lineH / 2))

    const promptText = resolvePrompt(prompt)
    if (promptText) {
        ctx.fillStyle = PLAIN_THEME.inkSoft
        ctx.font = `${scaleFontPx(26, canvas)}px ${PLAIN_THEME.font}`
        ctx.fillText(promptText, w / 2, h * 0.88)
    }
    ctx.restore()
}

/**
 * Start screen, in place of `DoggoNogoEngine.showCoverScreen`.
 *
 * This screen is NOT droppable, however bare it looks: it carries the session's first user gesture,
 * which is the only context in which a browser honours a fullscreen request. Fullscreen fixes the
 * viewport, and therefore the visual angle the stimuli subtend — so skipping it would leave the two
 * conditions running at different stimulus sizes. The fullscreen and orientation-lock calls below
 * mirror `showCoverScreen`'s exactly.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} engine  the DoggoNogoEngine, for `_browserFullscreen` and `_lockLandscape`
 * @returns {Promise<void>}
 */
export function plainCoverScreen(canvas, engine) {
    return new Promise((resolve) => {
        const spec = {
            title: "Reaction time tasks",
            lines: ["You will complete a series of short tasks.", "Instructions are given before each one."],
            prompt: () => pressSpace("begin"),
        }
        let rafId = requestAnimationFrame(function paint() {
            paintTextBlock(canvas, spec)
            rafId = requestAnimationFrame(paint)
        })

        const handler = (e) => {
            if (e.code !== "Space") return
            e.preventDefault() // Space would otherwise scroll the page under the canvas
            document.removeEventListener("keydown", handler)
            cancelAnimationFrame(rafId)
            if (engine._browserFullscreen && document.documentElement.requestFullscreen && !document.fullscreenElement) {
                document.documentElement
                    .requestFullscreen()
                    .then(() => engine._lockLandscape())
                    .catch((err) => console.debug("Fullscreen refused", err))
            }
            resolve()
        }
        DoggoNogoInput.attach(canvas)
        DoggoNogoInput.setMode(DoggoNogoInput.SPACE)
        document.addEventListener("keydown", handler)
    })
}

/**
 * Instruction frame, in place of the base's `drawInstructionFrame`.
 *
 * Plain levels override that method with this one and drive it through the base's own
 * `runInstructionScreen`, so the loop is started and cancelled by exactly the same code as the
 * game's. `elapsed` is ignored: the frame is identical every time, which is the point.
 *
 * The game spreads task-relevant information across its instruction screen AND its phase-break
 * lines (Level 2's break announces the vertical spawns; Levels 3-5 warn that the differences get
 * subtle). The plain condition has no break text, so every such fact is front-loaded into `lines`
 * here — see `plainInstructions` in ./levels.js.
 */
export function drawPlainInstructionFrame(canvas, _elapsed, config) {
    const lines = (DoggoNogoInput.isTouch && config.touchLines) || config.lines || []
    paintTextBlock(canvas, { title: config.title, lines, prompt: config.prompt })
}

/**
 * Phase-break rest, in place of `drawBreakOverlay`.
 *
 * Called from the plain `draw()` every frame while `state.inBreak`, exactly where the game's
 * overlay is called, and gated on the same `state.showBreakText` — so the break runs on the
 * identical `breakEffectsDelay` / `breakTextDelay` schedule and the rest periods stay matched.
 * It deliberately says nothing about blocks, phases or progress.
 */
export function drawPlainBreak(level) {
    paintTextBlock(level.state.canvas, {
        lines: ["Take a short break."],
        prompt: level.state.showBreakText ? pressSpace("continue") : "",
    })
}

// The plain score screen's loop, cancelled by the SPACE that dismisses it (below) and by any other
// plain screen taking the canvas.
let scoreRafId = null

/** Stops the plain end-of-level loop, if one is running. */
export function cancelPlainScoreScreen() {
    if (scoreRafId === null) return
    cancelAnimationFrame(scoreRafId)
    scoreRafId = null
}

/**
 * End-of-level screen, in place of `DoggoNogoUI.showScoreScreen`.
 *
 * Takes the same arguments so it can be passed straight in as the engine's `scoreScreen` option;
 * `quantile` is ignored on purpose. The performance summary is still computed and stored on
 * `state.performance` either way — the engine no longer ties that to the screen.
 *
 * Dismissal is the SPACE the host page is already listening for to advance; this only stops the
 * repaint, and does not consume the event.
 */
export function plainScoreScreen(canvas, _quantile, options = {}) {
    cancelPlainScoreScreen()
    const isLast = /finish/i.test(options.hint || "")
    const spec = { lines: ["Task complete."], prompt: () => pressSpace(isLast ? "finish" : "continue") }
    scoreRafId = requestAnimationFrame(function paint() {
        paintTextBlock(canvas, spec)
        scoreRafId = requestAnimationFrame(paint)
    })
    const dismiss = (e) => {
        if (e.code !== "Space") return
        document.removeEventListener("keydown", dismiss)
        cancelPlainScoreScreen()
    }
    document.addEventListener("keydown", dismiss)
}
