/**
 * @file Manages the overall game state, including loading, start screen, game loop, and score screen.
 */

const canvas = document.getElementById("gameCanvas")
const ctx = canvas.getContext("2d")

// The current level object. This can be swapped out to change levels.
let currentLevel = level1
// ID for the requestAnimationFrame loop, used to cancel it when the game ends.
let animationFrameId

/**
 * Displays the final score screen with reaction times and the average RT.
 * @param {number[]} scores - An array of reaction times from the completed level.
 */
function showScoreScreen(scores) {
    const averageRT = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = "30px Arial"
    ctx.fillStyle = "black"
    ctx.textAlign = "center"
    ctx.fillText("Game Over!", canvas.width / 2, canvas.height / 2 - 50)
    ctx.fillText(`Average RT: ${averageRT.toFixed(2)}ms`, canvas.width / 2, canvas.height / 2)
}

/**
 * Displays the start screen, prompting the user to begin the game.
 */
function showStartScreen() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = "30px Arial"
    ctx.fillStyle = "black"
    ctx.textAlign = "center"
    ctx.fillText("Press Down Arrow to Start", canvas.width / 2, canvas.height / 2)
}

/**
 * The main game loop, which calls the current level's update function on each frame.
 */
function gameLoop() {
    currentLevel.update()
    animationFrameId = requestAnimationFrame(gameLoop)
}

/**
 * Initializes the game by loading assets, showing the start screen, and starting the game loop.
 */
function startGame() {
    // Display a loading message while assets are being loaded.
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = "30px Arial"
    ctx.fillStyle = "black"
    ctx.textAlign = "center"
    ctx.fillText("Loading...", canvas.width / 2, canvas.height / 2)

    // Load the current level's assets.
    currentLevel.load(canvas).then(() => {
        showStartScreen()
        // Wait for the player to press the down arrow to start the game.
        const startHandler = (e) => {
            if (e.key === "ArrowDown") {
                document.removeEventListener("keydown", startHandler)
                // Start the level and provide a callback for when the level ends.
                currentLevel.start(canvas, (scores) => {
                    cancelAnimationFrame(animationFrameId)
                    showScoreScreen(scores)
                })
                // Start the game loop.
                gameLoop()
            }
        }
        document.addEventListener("keydown", startHandler)
    })
}

// Start the game when the script is loaded.
startGame()
