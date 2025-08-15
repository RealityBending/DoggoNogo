/**
 * Level 2 Intro Sequence Specification
 * Simple narrative: brief black screen lines then reveal Level 2 player sprite.
 * Reuses IntroRunner step schema (fill|text|image|sound|wait).
 */
const level2IntroSequence = [
    { type: "fill", color: "black" },
    { type: "wait", duration: 1000 },
    { type: "text", what: "However, someone has been watching with great attention", animation: "appear", y: 30 },
    { type: "text", what: "the arrival of DOGGO...", animation: "appear", y: 40 },
    { type: "wait", duration: 2000 },
    { type: "image", what: "level2/intro_eyes.png", animation: "reveal", duration: 1000, height: 10, y: 60 },
    { type: "wait", duration: 2000 },
    { type: "fill", color: "black" },
    { type: "text", what: "This someone's name is NOGO", animation: "appear", y: 50 },
    { type: "wait", duration: 2000 },
    { type: "text", what: "And now, he is hungry too...", animation: "appear", y: 70 },
    { type: "wait", duration: 2000 },
]

// Exposed globally similar to level1IntroSequence
if (typeof window !== "undefined") window.level2IntroSequence = level2IntroSequence
