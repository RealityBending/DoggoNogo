/**
 * @file Asset manifest for the global preloader (`DoggoNogoCore.preloadAll`).
 * Paths are relative to the configured `assetBasePath`.
 *
 * Task stimuli are absent by design: every level traces its own in code (see game/stimuli.js), so
 * there is nothing to preload and nothing that can arrive late or at the wrong size.
 */

export const DoggoNogoAssets = {
    shared: {
        images: ["cover1_noText.png", "text.png"],
        audio: ["sound_levelup.mp3", "sound_phasecomplete.mp3", "sound_start.mp3"],
    },
    level1: {
        images: [
            "level1/player_1.webp",
            "level1/player_2.webp",
            "level1/player_3.webp",
            "level1/background.webp",
            "level1/feedback_slow1.png",
            "level1/feedback_late1.png",
            "level1/feedback_early1.png",
            "level1/feedback_fast1.png",
            "level1/feedback_fast2.png",
            "level1/feedback_fast3.png",
            "level1/intro_background.webp",
        ],
        audio: [
            "level1/sound_background.mp3",
            "level1/sound_fast.mp3",
            "level1/sound_slow.mp3",
            "level1/sound_early.mp3",
            "level1/sound_evolve.mp3",
            "level1/sound_intro_metaldoor.mp3",
            "level1/sound_intro_dogwhining.mp3",
        ],
    },
    level2: {
        images: [
            "level2/player_1.webp",
            "level2/player_2.webp",
            "level2/player_3.webp",
            "level2/background.webp",
            "level2/feedback_slow1.png",
            "level2/feedback_late1.png",
            "level2/feedback_fast1.png",
            "level2/feedback_fast2.png",
            "level2/feedback_fast3.png",
            "level2/feedback_error1.png",
            "level2/feedback_early1.png",
        ],
        audio: [
            "level2/sound_evolve.mp3",
            "level2/sound_error.mp3",
            "level2/sound_fast.mp3",
            "level2/sound_slow.mp3",
            "level2/Fishbone.mp3",
        ],
    },
}
