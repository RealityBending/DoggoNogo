/*
  Lightweight jsPsych integration helpers for the Doggo/Nogo game.
  Usage (in HTML):
    <script src="https://unpkg.com/@jspsych/plugin-preload"></script>
    <script src="https://unpkg.com/@jspsych/plugin-call-function"></script>
    <script src="game/levels/level1.js"></script>
    <script src="game/jspsych_integration.js"></script>

    Then build timeline with DoggoNogo.create* helpers.
*/

;(function (global) {
    const Integration = {
        // Preload images/audio to reduce in-game stalls. Pass a base path and asset lists.
        createPreloadTrial: function ({ assetBasePath = "game/", images = [], audio = [] } = {}) {
            const imagePaths = images.map((p) => assetBasePath + p)
            const audioPaths = audio.map((p) => assetBasePath + p)
            return {
                type: jsPsychPreload,
                auto_preload: false,
                images: imagePaths,
                audio: audioPaths,
                // optional: show progress bar
                show_detailed_errors: true,
                message: "Loading assets...",
            }
        },

        // The game trial using call-function. Keeps the game decoupled from jsPsych.
        createGameTrial: function ({
            width = 800,
            height = 600,
            assetBasePath = "game/",
            levelGetter = () => (typeof level1 !== "undefined" ? level1 : undefined),
            trialsNumber,
        } = {}) {
            return {
                type: jsPsychCallFunction,
                async: true,
                func: (done) => {
                    const el = jsPsych.getDisplayElement()
                    const canvas = document.createElement("canvas")
                    canvas.id = "gameCanvas"
                    canvas.width = width
                    canvas.height = height
                    canvas.style.border = "1px solid #000"
                    el.appendChild(canvas)

                    const level = levelGetter()
                    if (!level) {
                        console.error("Level object not found. Ensure your level script is loaded.")
                        done({ error: "level not loaded" })
                        return
                    }

                    // Use the centralized game engine
                    DoggoNogoEngine.run(canvas, level, {
                        assetBasePath,
                        levelParams: { trialsNumber },
                        continueHint: "Press SPACE to continue",
                        onFinish: (finalState) => {
                            // Data to be saved by jsPsych
                            const trialData = {
                                reaction_times: finalState.reactionTimes,
                                data_log: finalState.data,
                                total_score: finalState.score,
                                trials_presented: finalState.trials,
                                phases_completed: finalState.phaseIndex + 1,
                            }

                            // Wait for spacebar press to formally end the trial
                            const onSpace = (e) => {
                                if (e.code === "Space") {
                                    document.removeEventListener("keydown", onSpace)
                                    el.innerHTML = "" // Clean up canvas
                                    done(trialData) // End jsPsych trial
                                }
                            }
                            document.addEventListener("keydown", onSpace)
                        },
                    }).catch((err) => {
                        console.error("Failed to run game engine", err)
                        done({ error: String(err) })
                    })
                },
            }
        },

        // Convenience: build a complete Level 1 sequence with optional preload and a single game trial
        level1: function ({
            includePreload = false,
            assetBasePath = "game/",
            preloadImages,
            preloadAudio,
            width = 800,
            height = 600,
            trialsNumber,
        } = {}) {
            const trials = []

            // Defaults for level1 assets if not provided
            const defaultImages = [
                "assets/level1/player_1.png",
                "assets/level1/player_2.png",
                "assets/level1/player_3.png",
                "assets/level1/stimulus.png",
                "assets/level1/background.png",
                "assets/level1/feedback_slow1.png",
                "assets/level1/feedback_late1.png",
                "assets/level1/feedback_fast1.png",
                "assets/level1/feedback_fast2.png",
                "assets/level1/feedback_fast3.png",
            ]
            const defaultAudio = ["assets/level1/sound_background.mp3", "assets/level1/sound_correct.mp3", "assets/level1/sound_evolve.mp3"]

            if (includePreload) {
                trials.push(
                    this.createPreloadTrial({
                        assetBasePath,
                        images: preloadImages || defaultImages,
                        audio: preloadAudio || defaultAudio,
                    })
                )
            }

            // Single in-canvas game trial that includes native-like start and score screens
            trials.push(this.createGameTrial({ width, height, assetBasePath, trialsNumber }))

            return trials
        },
    }

    // Expose
    global.DoggoNogo = Integration
})(typeof window !== "undefined" ? window : globalThis)
