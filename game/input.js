/**
 * @file Touch input: one adapter that lets the whole game stay keyboard-driven.
 *
 * Every screen in this game waits on a `keydown` -- the cover screen, the cutscene runner, the
 * instruction screen, the trial handlers, the phase-break overlay, the score screen and the
 * standalone end screen, seven listener sites in all. Rather than teach each of them about
 * pointers, this module turns a tap into a synthetic `KeyboardEvent` dispatched on `document`, so
 * those listeners keep working untouched and there is exactly one place where touch is understood.
 *
 * What a tap means depends on what is on screen, which the adapter does not try to infer: hosts
 * declare it with `setMode()`, either as a fixed spec or as a function re-read on every tap (the
 * form levels use, because a tap during a phase break means SPACE and a tap during a trial means
 * the response key).
 *
 *   setMode({ keys: ["Space"] })                    tap anywhere -> SPACE
 *   setMode({ keys: ["ArrowDown"] })                tap anywhere -> the one response key
 *   setMode({ keys: ["ArrowLeft", "ArrowRight"] })  tap the left half -> first key, right -> second
 *   setMode(null)                                   taps are ignored and left to the page
 *
 * Two details matter for measurement:
 *
 *  - The synthetic event is dispatched synchronously from inside the real pointer handler, so the
 *    browser's user-activation window is still open: fullscreen requests and audio starts made by
 *    the keyboard handlers downstream still count as gestures.
 *  - A dispatched event's own `timeStamp` is the moment of dispatch, not the moment of the touch.
 *    The gap is small but it is avoidable, so the pointer event's timestamp is carried across on
 *    `doggoSourceTime` and `DoggoNogoBaseLevel.eventTime` prefers it (see game/core.js).
 *
 * Touch RT is not keyboard RT -- different sampling rates, different scan-out, different hardware.
 * Runs are tagged with `modality` so the two are separable in the data rather than silently pooled.
 */

// `?touch=1` forces the adapter on (for testing the touch path on a desktop, where the pointer
// type is "mouse"); `?touch=0` forces it off. Anything else: detect the device.
function readOverride() {
    if (typeof window === "undefined" || !window.location) return null
    const raw = new URLSearchParams(window.location.search).get("touch")
    if (raw === null) return null
    return raw !== "0" && raw !== "false"
}

/**
 * A touch device is one with touch points AND a coarse primary pointer. The second half matters:
 * plenty of laptops report touch points for a touchscreen nobody uses, and those participants
 * have a keyboard in front of them.
 */
function detectTouch() {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const points = navigator.maxTouchPoints || 0
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches
    return points > 0 && coarse
}

const override = readOverride()

export const DoggoNogoInput = {
    /** Whether the game should present and accept touch rather than keys. */
    isTouch: override === null ? detectTouch() : override,

    /** Set when `?touch=` decided it, so the UI can say so and the data can be read sceptically. */
    forced: override !== null,

    /** Logged with the data: which device actually produced the responses. */
    get modality() {
        return this.isTouch ? "touch" : "keyboard"
    },

    // The element taps are measured against (for the left/right split). Listeners sit on
    // `document`, not on the canvas, so the letterbox around the stage is tappable too -- on a
    // phone the canvas rarely reaches the edges of the screen and a near-miss should still count.
    _canvas: null,
    _mode: null,
    // The key each active pointer pressed, so its release sends the matching keyup. Only the
    // first pointer down is tracked; a second finger during a trial is not a second response.
    _active: new Map(),

    /**
     * Starts translating taps. Safe to call more than once: the previous binding is removed first.
     * Does nothing on a keyboard device, so hosts can call it unconditionally.
     */
    attach: function (canvas) {
        this.detach()
        this._canvas = canvas || null
        if (!this.isTouch || typeof document === "undefined") return
        this._onDown = (e) => this._handleDown(e)
        this._onUp = (e) => this._handleUp(e)
        document.addEventListener("pointerdown", this._onDown, { passive: false })
        document.addEventListener("pointerup", this._onUp)
        document.addEventListener("pointercancel", this._onUp)
    },

    detach: function () {
        if (typeof document === "undefined") return
        if (this._onDown) document.removeEventListener("pointerdown", this._onDown)
        if (this._onUp) {
            document.removeEventListener("pointerup", this._onUp)
            document.removeEventListener("pointercancel", this._onUp)
        }
        this._onDown = null
        this._onUp = null
        this._active.clear()
    },

    /**
     * Declares what a tap currently means. Pass a spec, or a function returning one -- the function
     * is called at each tap, which is how a level keeps one mode for its whole run while a tap
     * still resolves to SPACE during a phase break and to the response key during a trial.
     */
    setMode: function (spec) {
        this._mode = spec || null
    },

    /** Convenience: the mode every "press SPACE to carry on" screen wants. */
    SPACE: { keys: ["Space"] },

    /**
     * Swallows taps without disturbing the mode, for when something is covering the stage — the
     * host page's rotate-your-phone prompt is the only user so far. A mode is a property of the
     * screen the game is on and outlives the interruption, so the two are kept apart.
     */
    suspended: false,

    _resolve: function () {
        if (this.suspended) return null
        const spec = typeof this._mode === "function" ? this._mode() : this._mode
        if (!spec || !spec.keys || !spec.keys.length) return null
        return spec
    },

    /**
     * Which key a tap at `clientX` means. One key: anywhere. Two: the halves of the stage, split
     * down the middle of the canvas rather than of the window, so the boundary is where the player
     * sees it. Taps beside the stage fall to the nearer side.
     */
    _keyForPoint: function (spec, clientX) {
        if (spec.keys.length < 2) return spec.keys[0]
        const rect = this._canvas && this._canvas.getBoundingClientRect ? this._canvas.getBoundingClientRect() : null
        const middle = rect && rect.width ? rect.left + rect.width / 2 : (window.innerWidth || 0) / 2
        return clientX < middle ? spec.keys[0] : spec.keys[1]
    },

    _handleDown: function (e) {
        // A real control on the page (the data button, anything a host puts around an embed) keeps
        // its own click. Nothing is consumed and no default is prevented.
        if (e.target && e.target.closest && e.target.closest("button, a, input, select, textarea")) return
        // On a desktop forced into touch mode with `?touch=1`, mouse presses are the only way in.
        if (e.pointerType === "mouse" && !this.forced) return
        if (this._active.size) return // one finger at a time
        const spec = this._resolve()
        if (!spec) return
        const key = this._keyForPoint(spec, e.clientX)
        this._active.set(e.pointerId, key)
        // Consume it: without this a tap can still raise the double-tap zoom or a selection
        // callout on some browsers, both of which land in the middle of a trial.
        if (e.cancelable) e.preventDefault()
        this._dispatch("keydown", key, e.timeStamp)
    },

    _handleUp: function (e) {
        const key = this._active.get(e.pointerId)
        if (key === undefined) return
        this._active.delete(e.pointerId)
        // The release matters on its own for the cutscene, where a tap advances one beat and a
        // hold skips the sequence; everywhere else nothing listens for it.
        this._dispatch("keyup", key, e.timeStamp)
    },

    _dispatch: function (type, key, sourceTime) {
        // "Space" is the name used in specs because it reads better than " "; the event itself
        // carries what the handlers actually test (`e.code === "Space"`, `e.key === " "`).
        const isSpace = key === "Space"
        const evt = new KeyboardEvent(type, {
            key: isSpace ? " " : key,
            code: isSpace ? "Space" : key,
            bubbles: true,
            cancelable: true,
        })
        // See the file header: the dispatch clock is not the touch clock.
        try {
            Object.defineProperty(evt, "doggoSourceTime", { value: sourceTime })
        } catch (err) {
            console.debug("Could not carry the touch timestamp", err)
        }
        document.dispatchEvent(evt)
    },
}
