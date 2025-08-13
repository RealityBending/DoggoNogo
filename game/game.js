/* Simple shared UI helpers for Doggo/Nogo */
;(function (global) {
    const drawCenteredText = (ctx, canvas, lines = [], fontSize = 30, color = "black") => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.textAlign = "center"
        ctx.fillStyle = color
        ctx.font = `${fontSize}px Arial`
        const startY = canvas.height / 2 - ((lines.length - 1) * (fontSize + 10)) / 2
        lines.forEach((t, i) => ctx.fillText(t, canvas.width / 2, startY + i * (fontSize + 10)))
    }

    const UI = {
        showLoading(canvas, text = "Loading...") {
            const ctx = canvas.getContext("2d")
            drawCenteredText(ctx, canvas, [text], 30, "black")
        },

        showStartScreen(canvas, text = "Press Down Arrow to Start") {
            const ctx = canvas.getContext("2d")
            drawCenteredText(ctx, canvas, [text], 30, "black")
        },

        showScoreScreen(canvas, scores = [], options = {}) {
            const { hint } = options || {}
            const ctx = canvas.getContext("2d")
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
            const lines = ["Game Over!", `Average RT: ${avg.toFixed(2)} ms`]
            if (hint) {
                lines.push("", hint)
            }
            drawCenteredText(ctx, canvas, lines, 28, "black")
        },
    }

    global.DoggoNogoUI = UI
})(typeof window !== "undefined" ? window : globalThis)
