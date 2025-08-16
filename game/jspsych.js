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
    // Inline asset manifest used for preload defaults
    if (!global.DoggoNogoAssets) {
        global.DoggoNogoAssets = {
            shared: { images: ["cover1_noText.png", "text.png"], audio: ["sound_levelup.mp3"] },
            level1: {
                images: [
                    "level1/player_1.png",
                    "level1/player_2.png",
                    "level1/player_3.png",
                    "level1/stimulus.png",
                    "level1/background.png",
                    "level1/feedback_slow1.png",
                    "level1/feedback_late1.png",
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
            // Level 2 currently has no audio and no feedback images; list only needed images
            level2: {
                images: [
                    "level2/player_1.png",
                    "level2/player_2.png",
                    "level2/player_3.png",
                    "level2/stimulus_1.png",
                    "level2/stimulus_2.png",
                    "level2/background.png",
                ],
                audio: [],
            },
        }
    }
    function normalizeBasePath(p) {
        if (!p) return ""
        // Ensure trailing slash and collapse any duplicated segments like assets/assets
        let out = p.replace(/\\+/g, "/")
        out = out.replace(/assets\/assets\//g, "assets/")
        if (!out.endsWith("/")) out += "/"
        return out
    }

    // Compute a canvas size that preserves the target 1792x1024 aspect ratio while fitting in the viewport.
    function computeResponsiveSize(targetW = 1792, targetH = 1024) {
        const ASPECT = targetW / targetH
        const maxW = window.innerWidth || targetW
        const maxH = window.innerHeight || targetH
        // Start by constraining width
        let width = Math.min(targetW, maxW)
        let height = Math.round(width / ASPECT)
        // If height doesn't fit, constrain by height instead
        if (height > maxH) {
            height = Math.min(targetH, maxH)
            width = Math.round(height * ASPECT)
        }
        return { width, height }
    }

    // Build default lists from manifest (if present)
    function getDefaultLevel1Lists(assetBasePath) {
        const manifest = global.DoggoNogoAssets
        if (!manifest || !manifest.level1) {
            return { images: [], audio: [] }
        }
        return {
            images: manifest.level1.images.slice(),
            audio: manifest.level1.audio.concat(manifest.shared ? manifest.shared.audio : []),
        }
    }
    function getDefaultLevel2Lists(assetBasePath) {
        const manifest = global.DoggoNogoAssets
        if (!manifest || !manifest.level2) return { images: [], audio: [] }
        return {
            images: manifest.level2.images.slice(),
            audio: manifest.shared ? manifest.shared.audio.slice() : [], // only shared audio (level2 silent gameplay)
        }
    }

    const Integration = {
        // Preload images/audio to reduce in-game stalls. Pass a base path and asset lists.
        createPreloadTrial: function ({ assetBasePath = "game/assets/", images = [], audio = [] } = {}) {
            const base = normalizeBasePath(assetBasePath)
            const imagePaths = images.map((p) => base + p)
            const audioPaths = audio.map((p) => base + p)
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
            width, // optional; if omitted we'll auto-compute maintaining 1792x1024 aspect
            height, // optional; ignored if width omitted (auto mode)
            maintainAspect = true,
            targetAspectWidth = 1792,
            targetAspectHeight = 1024,
            assetBasePath = "game/assets/",
            levelGetter = () => (typeof level1 !== "undefined" ? level1 : undefined),
            trialsNumber,
            introSequence = null,
            skipCover = false,
            suppressLoading = false,
            markerEnabled = false,
            markerFlashDuration = 100,
            markerSize = 60,
            fullscreen = false,
        } = {}) {
            return {
                type: jsPsychCallFunction,
                async: true,
                func: (done) => {
                    const el = jsPsych.getDisplayElement()
                    const canvas = document.createElement("canvas")
                    canvas.id = "gameCanvas"
                    let w = width
                    let h = height
                    if (!fullscreen && maintainAspect && (typeof w !== "number" || typeof h !== "number")) {
                        const size = computeResponsiveSize(targetAspectWidth, targetAspectHeight)
                        w = size.width
                        h = size.height
                    } else if (!fullscreen && maintainAspect && w && !h) {
                        // Derive h from w
                        h = Math.round(w * (targetAspectHeight / targetAspectWidth))
                    }
                    if (!fullscreen) {
                        canvas.width = w || 1792
                        canvas.height = h || 1024
                    } else {
                        // Temporary size; engine will resize & inject styles
                        canvas.width = window.innerWidth
                        canvas.height = window.innerHeight
                        canvas.style.width = "100vw"
                        canvas.style.height = "100vh"
                        canvas.style.margin = "0"
                        canvas.style.border = "0"
                    }
                    // Center canvas via container styling
                    canvas.style.display = "block"
                    canvas.style.margin = "0 auto"
                    canvas.style.border = fullscreen ? "0" : "1px solid #000"
                    el.appendChild(canvas)

                    const level = levelGetter()
                    if (!level) {
                        console.error("Level object not found. Ensure your level script is loaded.")
                        done({ error: "level not loaded" })
                        return
                    }

                    // Use the centralized game engine
                    DoggoNogoEngine.run(canvas, level, {
                        assetBasePath: normalizeBasePath(assetBasePath),
                        levelParams: { trialsNumber },
                        continueHint: "Press SPACE to continue",
                        introSequence,
                        skipCover,
                        suppressLoading,
                        markerEnabled,
                        markerFlashDuration,
                        markerSize,
                        fullscreen,
                        onFinish: (finalState) => {
                            // Data to be saved by jsPsych
                            const trialData = {
                                reaction_times: finalState.reactionTimes,
                                data_log: finalState.data,
                                total_score: finalState.score,
                                trials_presented: finalState.trials,
                                phases_completed: finalState.phaseIndex + 1,
                                game_params: finalState.gameParams || null,
                                performance: finalState.performance || null,
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
            assetBasePath = "game/assets/",
            preloadImages,
            preloadAudio,
            // Optional: override sizing, else responsive 1792x1024 preserved
            width,
            height,
            maintainAspect = true,
            trialsNumber,
            markerEnabled = false,
            markerFlashDuration = 100,
            markerSize = 60,
            fullscreen = false,
        } = {}) {
            const trials = []
            const base = normalizeBasePath(assetBasePath)
            const defaults = getDefaultLevel1Lists(base)
            const defaultImages = defaults.images
            const defaultAudio = defaults.audio

            if (includePreload) {
                trials.push(
                    this.createPreloadTrial({
                        assetBasePath: base,
                        images: preloadImages || defaultImages,
                        audio: preloadAudio || defaultAudio,
                    })
                )
            }

            // Single in-canvas game trial that includes native-like start and score screens
            trials.push(
                this.createGameTrial({
                    width,
                    height,
                    maintainAspect,
                    assetBasePath: base,
                    trialsNumber,
                    introSequence: typeof level1IntroSequence !== "undefined" ? level1IntroSequence : null,
                    skipCover: false,
                    markerEnabled,
                    markerFlashDuration,
                    markerSize,
                    fullscreen,
                })
            )

            return trials
        },
        level2: function ({
            includePreload = false,
            assetBasePath = "game/assets/",
            preloadImages,
            preloadAudio,
            width,
            height,
            maintainAspect = true,
            trialsNumber,
            markerEnabled = false,
            markerFlashDuration = 100,
            markerSize = 60,
            fullscreen = false,
        } = {}) {
            const trials = []
            const base = normalizeBasePath(assetBasePath)
            const defaults = getDefaultLevel2Lists(base)
            const defaultImages = defaults.images
            const defaultAudio = defaults.audio // currently empty
            if (includePreload) {
                trials.push(
                    this.createPreloadTrial({
                        assetBasePath: base,
                        images: preloadImages || defaultImages,
                        audio: preloadAudio || defaultAudio,
                    })
                )
            }
            trials.push(
                this.createGameTrial({
                    width,
                    height,
                    maintainAspect,
                    assetBasePath: base,
                    trialsNumber,
                    levelGetter: () => (typeof level2 !== "undefined" ? level2 : undefined),
                    introSequence: typeof level2IntroSequence !== "undefined" ? level2IntroSequence : null,
                    skipCover: true, // skip start/cover for subsequent level
                    // Hide loading splash between level 1 and 2 (standalone already preloads/suppresses)
                    suppressLoading: true,
                    markerEnabled,
                    markerFlashDuration,
                    markerSize,
                    fullscreen,
                })
            )
            return trials
        },
    }

    // Expose
    global.DoggoNogo = Integration
})(typeof window !== "undefined" ? window : globalThis)
