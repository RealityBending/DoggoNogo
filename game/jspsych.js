/**
 * @file Lightweight jsPsych integration helpers for the Doggo/Nogo game.
 * The engine performs global + level preloading internally, so this layer only
 * needs to create jsPsych call-function trials for running levels.
 */

import { DoggoNogoEngine } from "./engine.js"
import { level1 } from "./levels/level1.js"
import { level2 } from "./levels/level2.js"
import { level1IntroSequence, level2IntroSequence } from "./levels/intro.js"

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

export const DoggoNogo = {
    // The game trial using call-function. Keeps the game decoupled from jsPsych.
    createGameTrial: function ({
        jsPsych, // the instance returned by initJsPsych()
        width, // optional; if omitted we'll auto-compute maintaining 1792x1024 aspect
        height, // optional; ignored if width omitted (auto mode)
        maintainAspect = true,
        targetAspectWidth = 1792,
        targetAspectHeight = 1024,
        assetBasePath = "game/assets/",
        levelGetter = () => level1,
        trialsNumber,
        introSequence = null,
        skipCover = false,
        markerEnabled = false,
        markerFlashDuration = 100,
        markerSize = 60,
        fullscreen = false,
        initialFillColor = "#000", // color painted immediately to avoid a white flash while assets load
    } = {}) {
        return {
            type: jsPsychCallFunction,
            async: true,
            func: (done) => {
                if (!jsPsych) {
                    console.error("DoggoNogo: pass the instance returned by initJsPsych() as `jsPsych`.")
                    done({ error: "missing jsPsych instance" })
                    return
                }
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

                // If we're suppressing the engine's own loading screen, immediately paint a solid background
                // to avoid a brief white flash while assets load (especially between level1->level2).
                if (initialFillColor) {
                    try {
                        const ctxPre = canvas.getContext("2d")
                        ctxPre.save()
                        ctxPre.fillStyle = initialFillColor
                        ctxPre.fillRect(0, 0, canvas.width, canvas.height)
                        ctxPre.restore()
                        // Also set CSS background for consistency during resize before first draw.
                        canvas.style.background = initialFillColor
                    } catch (e) {
                        console.debug("Initial canvas fill failed", e)
                    }
                }

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
                    otherLevels: [level1, level2],
                    jsPsych,
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
                                e.preventDefault() // Space would otherwise scroll the page under the canvas
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
        jsPsych,
        assetBasePath = "game/assets/",
        width,
        height,
        maintainAspect = true,
        trialsNumber,
        markerEnabled = false,
        markerFlashDuration = 100,
        markerSize = 60,
        fullscreen = false,
        showCover = true,
    } = {}) {
        return [
            this.createGameTrial({
                jsPsych,
                width,
                height,
                maintainAspect,
                assetBasePath: normalizeBasePath(assetBasePath),
                trialsNumber,
                introSequence: level1IntroSequence,
                skipCover: !showCover,
                markerEnabled,
                markerFlashDuration,
                markerSize,
                fullscreen,
            }),
        ]
    },
    level2: function ({
        jsPsych,
        assetBasePath = "game/assets/",
        width,
        height,
        maintainAspect = true,
        trialsNumber,
        markerEnabled = false,
        markerFlashDuration = 100,
        markerSize = 60,
        fullscreen = false,
        showCover = false,
        initialFillColor = "#000",
    } = {}) {
        return [
            this.createGameTrial({
                jsPsych,
                width,
                height,
                maintainAspect,
                assetBasePath: normalizeBasePath(assetBasePath),
                trialsNumber,
                levelGetter: () => level2,
                introSequence: level2IntroSequence,
                skipCover: !showCover,
                markerEnabled,
                markerFlashDuration,
                markerSize,
                fullscreen,
                initialFillColor,
            }),
        ]
    },
}
