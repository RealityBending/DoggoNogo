/* Simple shared UI helpers for Doggo/Nogo */
;(function (global) {
    const REF_W = 1792
    const REF_H = 1024
    function scaleFontPx(base, canvas) {
        // Scale relative to width to keep proportions; clamp for readability
        const factor = (canvas.width / REF_W + canvas.height / REF_H) / 2
        return Math.round(base * factor)
    }
    const drawCenteredText = (ctx, canvas, lines = [], fontSize = 30, color = "black") => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.textAlign = "center"
        ctx.fillStyle = color
        ctx.font = `${scaleFontPx(fontSize, canvas)}px Arial`
        const startY = canvas.height / 2 - ((lines.length - 1) * (fontSize + 10)) / 2
        lines.forEach((t, i) => ctx.fillText(t, canvas.width / 2, startY + i * (fontSize + 10)))
    }

    const UI = {
        showLoading(canvas, text = "Loading...") {
            const ctx = canvas.getContext("2d")
            drawCenteredText(ctx, canvas, [text], 30, "black")
        },

        /**
         * Converts a Z-score to a quantile assuming a standard normal distribution.
         * Since lower IES is better, the quantile reflects the percentage of the population
         * that the player performed better than.
         * @param {number} z - The Z-score.
         * @returns {number} The quantile (0-100).
         */
        zScoreToQuantile(z) {
            // This is an approximation of the standard normal CDF P(X <= z)
            const t = 1 / (1 + 0.2316419 * Math.abs(z))
            const d = 0.3989423 * Math.exp((-z * z) / 2)
            let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
            if (z > 0) {
                prob = 1 - prob
            }
            // For IES, a lower score is better. A negative Z-score means the player's IES is below the mean.
            // The CDF gives the percentage of the population with a score *less than or equal to* the player's.
            // To find the percentage of people the player is *better than*, we need 1 - CDF.
            return (1 - prob) * 100
        },

        showScoreScreen(canvas, quantile, options = {}) {
            const { hint, playerSprite } = options || {}
            const ctx = canvas.getContext("2d")
            const duration = 3000 // 3 seconds for the animation
            let startTime = null

            const animateScore = (timestamp) => {
                if (!startTime) startTime = timestamp
                const progress = Math.min((timestamp - startTime) / duration, 1)
                const currentDisplayNumber = Math.floor(progress * quantile)

                // Always white background
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.fillStyle = "#ffffff"
                ctx.fillRect(0, 0, canvas.width, canvas.height)

                // 1. "Level Complete" at the top
                ctx.textAlign = "center"
                ctx.fillStyle = "black"
                ctx.font = `${scaleFontPx(48, canvas)}px Arial`
                ctx.fillText("Level Complete!", canvas.width / 2, canvas.height * 0.15)

                // 2. Player sprite on the left
                if (playerSprite && playerSprite.complete) {
                    const aspectRatio = playerSprite.naturalWidth / playerSprite.naturalHeight
                    const displayHeight = canvas.height * 0.5
                    const displayWidth = displayHeight * aspectRatio
                    const xFeedbackImg = canvas.width * 0.05
                    const yFeedbackImg = canvas.height / 2 - displayHeight / 2
                    ctx.drawImage(playerSprite, xFeedbackImg, yFeedbackImg, displayWidth, displayHeight)
                }

                // 3. Text and score on the right
                const textX = canvas.width * 0.65
                ctx.font = `${scaleFontPx(28, canvas)}px Arial`
                ctx.fillText("Based on the speed and accuracy", textX, canvas.height / 2 - 100)
                ctx.fillText("of your reflexes, you managed to beat...", textX, canvas.height / 2 - 60)

                if (progress < 1) {
                    // Flashing numbers animation
                    ctx.font = `bold ${scaleFontPx(72, canvas)}px Arial`
                    ctx.fillText(`${currentDisplayNumber}%`, textX, canvas.height / 2 + 40)
                    requestAnimationFrame(animateScore)
                } else {
                    // Final screen
                    ctx.font = `bold ${scaleFontPx(72, canvas)}px Arial`
                    ctx.fillText(`${quantile.toFixed(0)}%`, textX, canvas.height / 2 + 40)
                    ctx.font = `${scaleFontPx(28, canvas)}px Arial`
                    ctx.fillText("of the players! Well done!", textX, canvas.height / 2 + 100)

                    // Optional hint
                    if (hint) {
                        ctx.font = `${scaleFontPx(24, canvas)}px Arial`
                        ctx.fillText(hint, textX, canvas.height / 2 + 150)
                    }
                }
            }

            requestAnimationFrame(animateScore)
        },
    }

    global.DoggoNogoUI = UI
})(typeof window !== "undefined" ? window : globalThis)

// Embedded shared helpers (previously in shared_helpers.js)
;(function (global) {
    if (typeof global.DoggoNogoTrialTypes === "undefined") {
        global.DoggoNogoTrialTypes = { FAST: "fast", SLOW: "slow", EARLY: "early", TIMEOUT: "timeout", ERROR: "error" }
    }
    if (typeof global.DoggoNogoShared === "undefined") {
        global.DoggoNogoShared = {
            safePlay(audioEl, reset = true) {
                if (!audioEl) return
                try {
                    if (reset) audioEl.currentTime = 0
                    audioEl.play()
                } catch (e) {}
            },
            clearTrialTimers(state) {
                if (!state) return
                if (state.pendingStimulusTimeoutId) {
                    clearTimeout(state.pendingStimulusTimeoutId)
                    state.pendingStimulusTimeoutId = null
                }
                if (state.currentTrialTimeoutId) {
                    clearTimeout(state.currentTrialTimeoutId)
                    state.currentTrialTimeoutId = null
                }
            },
            startStimulusExit(state, nowFn, type) {
                if (!state || !state.stimulus || !nowFn) return
                const stim = state.stimulus
                stim.visible = false
                stim.exiting = true
                stim.exitType = type
                stim.exitStartTime = nowFn()
                stim.exitInitialX = stim.x
                stim.exitInitialY = stim.y
                stim.exitInitialWidth = stim.width
                stim.exitInitialHeight = stim.height
            },
            showScoreDelta(levelObj, points) {
                if (!levelObj || typeof levelObj.showScoreFeedback !== "function") return
                const sign = points > 0 ? "+" : ""
                levelObj.showScoreFeedback(`${sign}${Math.round(points)}`)
            },
            getTrialTypeLabel(type) {
                return type === "timeout" ? "Timeout" : type.charAt(0).toUpperCase() + type.slice(1)
            },
            computeMedian(arr) {
                if (!arr || !arr.length) return null
                const s = [...arr].sort((a, b) => a - b)
                const m = Math.floor(s.length / 2)
                return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
            },
        }
    }
})(typeof window !== "undefined" ? window : globalThis)
