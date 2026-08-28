/**
 * @file Asset manifest for the global preloader (`DoggoNogoCore.preloadAll`).
 * Paths are relative to the configured `assetBasePath`.
 */

export const DoggoNogoAssets = {
    shared: {
        images: ["cover1_noText.png", "text.png"],
        audio: ["sound_levelup.mp3", "sound_phasecomplete.mp3", "sound_start.mp3"],
    },
    level1: {
        images: [
            "level1/player_1.png",
            "level1/player_2.png",
            "level1/player_3.png",
            "level1/stimulus.png",
            "level1/background.png",
            "level1/feedback_slow1.png",
            "level1/feedback_late1.png",
            "level1/feedback_early1.png",
            "level1/feedback_fast1.png",
            "level1/feedback_fast2.png",
            "level1/feedback_fast3.png",
            "level1/intro_background.png",
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
            "level2/player_1.png",
            "level2/player_2.png",
            "level2/player_3.png",
            "level2/stimulus_1.png",
            "level2/stimulus_2.png",
            "level2/background.png",
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
