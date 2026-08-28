/**
 * @file Intro cutscene step sequences, consumed by `IntroRunner`.
 */
export const level1IntroSequence = [
    { type: "fill", color: "black" },
    { type: "text", what: "You are an investigator tasked with bringing down criminals that mistreat animals.", animation: "appear" },
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

export const level2IntroSequence = [
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
