/**
 * Level 1 Intro Sequence Specification
 * ------------------------------------
 * Unified step object fields:
 *   type: fill | text | image | sound | wait
 *   what: (string) text content for type=text, asset key for image/sound, ignored for fill/wait
 *   color: (optional) for fill/text (defaults: black for fill, white for text)
 *   animation: 'reveal' (fade in over duration) | 'appear' (instant). Applies to image/text only.
 *   duration: ONLY used when (a) type == 'wait' (wait length in ms) OR (b) animation == 'reveal' (fade duration).
 *             All other temporal spacing must be expressed with explicit wait steps. (No hidden holding.)
 *   Image sizing:
 *       height: number or string percentage ("35%") always interpreted as percent of canvas height.
 *               If number provided, 40 -> 40% canvas height. Values clamped to [1,100].
 *       If omitted: defaults to 40% canvas height.
 *   Image positioning:
 *       y: number (percent of canvas height for image centre) to vertically position sprites.
 *   Text reveal background fill (anti-ghosting):
 *       For animation='reveal', optional background: "#000" (or color string) repaints each frame
 *       during fade to avoid semi-transparent accumulation (useful for large text like title).
 *
 * Semantics:
 *  - "text": draws centered text (optionally with reveal fade). Appears instantly unless animation='reveal'. Add a following wait to keep it on screen.
 *  - "image": sets background or sprite; if animation='reveal' it fades over its duration, else appears instantly. Add waits for hold time.
 *  - "sound": plays immediately and advances; pair with waits as needed.
 *  - "fill": clears canvas to a color (defaults black) and advances.
 *  - "wait": passive delay for given duration.
 *
 * Composition pattern examples:
 *  - Fade in background then narrate: image -> sound (optional) -> text -> wait
 *  - Show sprite + narration: image (sprite) -> text
 *
 * Asset keys (loaded in level1.js):
 *  imgIntroBackground, imgPlayer1, soundIntroMetalDoor, soundIntroDogWhining
 * All strings kept ASCII to avoid encoding issues.
 */
const level1IntroSequence = [
    { type: "fill", color: "black" },
    {
        type: "text",
        what: "You are an investigator tasked with bringing down criminals that mistreat animals.",
        animation: "appear",
    },
    { type: "wait", duration: 3000 },
    { type: "sound", what: "level1/sound_intro_metaldoor.mp3" },
    { type: "image", what: "level1/intro_background.png", animation: "reveal", duration: 1000 },
    { type: "wait", duration: 1500 },
    { type: "text", what: "But during your last raid, you heard something...", animation: "appear" },
    { type: "wait", duration: 1500 },
    { type: "sound", what: "level1/sound_intro_dogwhining.mp3" },
    { type: "wait", duration: 1500 },
    { type: "image", what: "level1/player_1.png", animation: "reveal", duration: 800 },
    { type: "wait", duration: 1000 },
    { type: "image", what: "level1/intro_background.png", animation: "appear" },
    { type: "image", what: "level1/player_1.png", animation: "appear" },
    { type: "text", what: "You decide to take him home, and name him...", animation: "appear", y: 80 },
    { type: "wait", duration: 2000 },
    { type: "fill", color: "black" },
    { type: "text", what: "Doggo", animation: "reveal", duration: 1000, fontSize: 96, background: "black" },
    { type: "wait", duration: 1000 },
]
