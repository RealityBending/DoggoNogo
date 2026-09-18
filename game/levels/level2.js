/**
 * @file Level 2 — Gamified Simon task (directional variant).
 *
 * Shared gameplay mechanics live in `DoggoNogoBaseLevel` (game/core.js). This file defines only what
 * is specific to Level 2: its `params`/`assets`/`state`, asset loading, instructions, the
 * region/congruency stimulus logic, player mirroring, the fixed phase-target strategy, and the
 * directional (ArrowLeft/ArrowRight) response handling/scoring.
 *
 * Cognitive design:
 *   Phase 1 (index 0): CONGRUENT only (left/right position matches required direction).
 *   Phase 2 (index 1): CONGRUENT + NEUTRAL (vertical top/bottom spawns; no lateral position cue).
 *   Phase 3 (index 2): CONGRUENT + INCONGRUENT (left/right; some orientations conflict). No neutral.
 *   Conflict category per trial is logged as "congruent" | "neutral" | "incongruent".
 *
 * Configurable conflict proportions:
 *   params.neutralProportionPhase2 (default 0.5)   probability a Phase 2 trial is NEUTRAL.
 *   params.incongruentProportionPhase3 (default 0.5) probability a Phase 3 trial is INCONGRUENT.
 *
 * Scoring:
 *   Fast  (<= threshold)               : + minScore..maxScore (scaled by RT)
 *   Slow  (> threshold, before timeout): + minScore/2
 *   Error (wrong direction)            : - minScore/2
 *   Early (before stimulus visible)    : - minScore
 *   Timeout (no response)              : 0
 *   Only correct fast/slow trials update the adaptive median RT.
 *
 * Phase targets (simplified, fixed): perPhaseTrials = ceil(trialsNumber/3); each phase target =
 * perPhaseTrials * minScore (constant across all three phases).
 */

import { DoggoNogoBaseLevel } from "../core.js"
import { DoggoNogoCore, DoggoNogoUI, DoggoNogoTrialTypes as TrialTypes } from "../game.js"
import { DoggoNogoStimuli } from "../stimuli.js"

export const level2 = {
    startKeys: ["ArrowLeft", "ArrowRight"],

    params: {
        trialsNumber: 18,
        minTrialsPerPhase: 4,
        minISI: 500, // Floor (ms)
        maxISI: 3500, // Ceiling (ms)
        meanISIDecay: 1000, // Scale parameter (ms) for the pseudoexponential ISI distribution
        minScore: 100,
        maxScore: 200,
        gameDifficulty: 1,
        populationMean: 300,
        populationSD: 20,
        gravity: 0.5,
        maxJumpStrength: -8,
        minJumpStrength: -1,
        stimulusFallDistance: 0.05,
        playerHeight: 0.36, // % of canvas height
        playerY: 0.63, // vertical centre of the sprite box; paws land at ~0.81, on the alley floor
        // Contact shadow: the sheet leaves ~2.5% of the box empty under the paws, so the shadow is
        // raised to sit under them rather than a little below.
        jumpShadow: { yOffset: -0.04 },

        // --- Stimulus geometry. The fishbone is traced in code and fills its box exactly. The old
        // sprite's ink filled only 62% of its box height, so the same `stimulusHeight` meant a
        // smaller physical stimulus here than in Level 1; these numbers reproduce the sprite's
        // apparent size while making the box and the shape the same rectangle.
        stimulusHeight: 0.065, // full fishbone height (set by the tail lobes), fraction of canvas height
        stimulusAspect: 2.1, // nose-to-tail length / full height
        fishFill: "#f6fbff", // used for both directions when stimulusColorMode is "single"
        // Matched-luminance pair for "orthogonal" mode (relative luminance ~0.48 each), so colour
        // can vary without changing how detectable the stimulus is. Note the outline below is
        // shared by both members, so a pair should be chosen to read against it.
        fishFillPair: ["#4cc9f0", "#f0a24c"],
        stimulusColorMode: "single", // "single" | "orthogonal"; see the file header
        // Outermost first, widths as fractions of the full fishbone height. A near-white bone on a
        // blue contour: the pale fill is the bright mass that makes the stimulus pop against the
        // dark alley, and the blue holds the silhouette together and keeps the ribs from merging
        // into one another at the on-screen size.
        fishOutlines: [{ color: "#1d6fd0", width: 0.05 }],
        fishEyeColor: "#1d6fd0", // must read against the pale fill, so it takes the outline's blue

        flashDuration: 150, // ms duration of red flash for errors/early presses
        flashTintColor: "255,0,0", // base RGB; alpha animated
        feedbackBubbleHeight: 0.2, // % of canvas height for feedback bubbles
        // Spawn Y positions (fractions of canvas height) for vertical regions introduced in phase 2+
        stimulusLocationTopY: 0.45,
        stimulusLocationBottomY: 0.9,
        // Conflict proportion parameters (see header documentation)
        neutralProportionPhase2: 0.5,
        incongruentProportionPhase3: 0.5,

        // Phase-break "evolution" sparkle burst (red); consumed by the base `playBreakEffects`
        breakSparkles: {
            count: 40,
            speedMin: 1,
            speedMax: 5,
            sizeMin: 2,
            sizeMax: 5,
            lifeMin: 40,
            lifeMax: 90,
            colorFn: () => `hsl(${Math.random() * 20}, 100%, ${60 + Math.random() * 20}%)`,
        },
    },

    assets: {
        imgPlayer: new Image(),
        imgPlayer1: new Image(),
        imgPlayer2: new Image(),
        imgPlayer3: new Image(),
        imgBackground: new Image(),
        soundEvolve: new Audio(),
        soundLevelUp: new Audio(),
        soundError: new Audio(),
        soundFast: new Audio(),
        soundSlow: new Audio(),
        soundBackground: new Audio(),
        soundStart: new Audio(),
        // Cover screen art (shared); the title itself is drawn in code by the engine.
        imgCover: new Image(),
        // Feedback images
        imgFeedbackSlow: new Image(),
        imgFeedbackLate: new Image(),
        imgFeedbackFast1: new Image(),
        imgFeedbackFast2: new Image(),
        imgFeedbackFast3: new Image(),
        imgFeedbackError: new Image(),
        imgFeedbackEarly: new Image(),
    },

    // Mutable runtime data. Replaced by a fresh object on every `start()`.
    state: null,

    /** Builds a clean runtime state, so a re-run of the level never inherits stale data. */
    getInitialState: function () {
        return {
            gameState: "playing",
            score: 0,
            trials: 0,
            reactionTimes: [],
            particles: [],
            data: [],
            player: { x: 0, y: 0, width: 100, height: 100, velocityY: 0, jumping: false, originalY: 0 },
            playerFacing: "left", // 'left' | 'right' for sprite mirroring
            // Fill colours available this session. One entry in "single" mode; two in "orthogonal",
            // in a per-session random order so any residual colour preference is counter-balanced.
            fillPalette: [],
            stimulus: {
                x: 0,
                y: 0,
                width: 50,
                height: 50,
                visible: false,
                exiting: false,
                exitType: "catch",
                exitDuration: 200,
                exitStartTime: 0,
                exitInitialX: 0,
                exitInitialY: 0,
                initialY: 0,
                exitInitialWidth: 0,
                exitInitialHeight: 0,
                side: null, // 'left' | 'right'
                region: null, // spawn region: 'left','right','top','bottom'
                difficulty: null, // 'congruent' | 'neutral' | 'incongruent'
                fill: null, // the fill actually drawn this trial; logged as StimulusColor
            },
            // Trial timing, all in the level clock (see core.js)
            frameTime: 0, // timestamp of the frame being processed
            clockOffset: 0, // performance clock -> level clock
            startTime: 0, // stimulus onset, stamped from the frame that presented it
            stimulusScheduledTime: 0, // when the current trial's ISI started
            stimulusDueTime: null, // frame time at which the stimulus should appear
            responseDeadline: null, // frame time at which the response window closes
            responseWindowClosedAt: null, // frame time of the last timeout (see isBelatedResponse)
            onsetPending: false, // drawn, but not yet presented
            medianRT: 1000,
            maxRT: 2000,
            scoreText: "",
            scoreTextVisible: false,
            scoreTextTimeout: null,
            scoreTextPoints: 0,
            phaseIndex: 0,
            inBreak: false,
            breakState: "idle",
            breakStartTime: 0,
            showBreakText: false,
            phaseRequiredScores: [0, 0, 0],
            phaseTargetsCache: null, // memoized getPhaseTargets() result (see core.js)
            phaseFloorScore: 0,
            canvas: null,
            ctx: null,
            endOverlayVisible: false,
            endButtonRect: { x: 0, y: 0, w: 0, h: 0 },
            showContinueButton: false,
            continueLabel: "Continue",
            flashUntil: 0, // timestamp until which the player sprite flashes (error/early feedback)
            tintedSpriteCache: {},
            feedbackBubbles: [],
            lastTrialType: null,
            lastFastFeedback: 0,
        }
    },

    load: function (canvas, options) {
        const base = (options && options.assetBasePath) || ""
        this.assets.imgPlayer1.src = base + "level2/player_1.webp"
        this.assets.imgPlayer2.src = base + "level2/player_2.webp"
        this.assets.imgPlayer3.src = base + "level2/player_3.webp"
        this.assets.imgBackground.src = base + "level2/background.webp"
        this.assets.soundEvolve.src = base + "level2/sound_evolve.mp3"
        this.assets.soundLevelUp.src = base + "sound_levelup.mp3" // shared root-level sound
        this.assets.soundError.src = base + "level2/sound_error.mp3"
        this.assets.soundFast.src = base + "level2/sound_fast.mp3"
        this.assets.soundSlow.src = base + "level2/sound_slow.mp3"
        this.assets.soundBackground.src = base + "level2/Fishbone.mp3"
        this.assets.soundStart.src = base + "sound_start.mp3"
        this.assets.imgCover.src = base + "cover.webp"
        this.assets.imgFeedbackSlow.src = base + "level2/feedback_slow1.webp"
        this.assets.imgFeedbackLate.src = base + "level2/feedback_late1.webp"
        this.assets.imgFeedbackFast1.src = base + "level2/feedback_fast1.webp"
        this.assets.imgFeedbackFast2.src = base + "level2/feedback_fast2.webp"
        this.assets.imgFeedbackFast3.src = base + "level2/feedback_fast3.webp"
        this.assets.imgFeedbackError.src = base + "level2/feedback_error1.webp"
        this.assets.imgFeedbackEarly.src = base + "level2/feedback_early1.webp"
        const assetRefs = [
            this.assets.imgPlayer1,
            this.assets.imgPlayer2,
            this.assets.imgPlayer3,
            this.assets.imgBackground,
            this.assets.imgCover,
            this.assets.imgFeedbackSlow,
            this.assets.imgFeedbackLate,
            this.assets.imgFeedbackFast1,
            this.assets.imgFeedbackFast2,
            this.assets.imgFeedbackFast3,
            this.assets.imgFeedbackError,
            this.assets.imgFeedbackEarly,
            this.assets.soundBackground,
            this.assets.soundError,
            this.assets.soundFast,
            this.assets.soundSlow,
            this.assets.soundEvolve,
            this.assets.soundLevelUp,
            this.assets.soundStart,
        ]
        return DoggoNogoCore.loadAssets(assetRefs, options && options.onProgress).then(() => {
            this.initializeDimensions(canvas)
            this.placePlayer(canvas)
        })
    },

    /**
     * Level-specific instructions screen (animated; the loop is cancelled by `beginLevel`).
     */
    showInstructionScreen: function (canvas) {
        const { fx } = DoggoNogoUI
        this.runInstructionScreen(canvas, {
            badge: "LEVEL 2 · FOCUS",
            title: "Here comes NOGO",
            lines: [
                "NOGO the cat is on the lookout for fish leftovers.",
                DoggoNogoUI.input.isTouch
                    ? "Tap the side matching the DIRECTION the fishbone points —"
                    : "Press the arrow matching the DIRECTION the fishbone points —",
                "no matter where on the screen it appears!",
            ],
            promptSegments: [{ t: "Press" }, { k: "◀" }, { t: "or" }, { k: "▶" }, { t: "to start" }],
            touchPromptSegments: [{ t: "Tap" }, { k: "◀" }, { t: "or" }, { k: "▶" }, { t: "to start" }],
            drawVisual: (ctx, layout, elapsed) => {
                // One fishbone per direction with its matching keycap, bobbing in antiphase. Both are
                // drawn with the same fill, which is the point: the arrow to press is given by which
                // way the fish points and by nothing else.
                const boxHeight = Math.min((layout.bottom - layout.top) * 0.42, layout.h * 0.085)
                const geom = this.getFishboneGeometry(boxHeight)
                const cy = layout.cy - layout.h * 0.02
                const leftX = layout.w * 0.32
                const rightX = layout.w * 0.68
                const bobL = Math.sin(elapsed / 550) * layout.h * 0.007
                const bobR = Math.sin(elapsed / 550 + Math.PI) * layout.h * 0.007
                const fill = this.state.fillPalette[0] || this.params.fishFill

                for (const [x, bob, direction] of [
                    [leftX, bobL, -1],
                    [rightX, bobR, 1],
                ]) {
                    DoggoNogoStimuli.drawFishbone(ctx, {
                        centerX: x,
                        centerY: cy + bob,
                        length: geom.length,
                        height: geom.innerHeight,
                        direction,
                        fill,
                        outlines: geom.outlines,
                        eyeColor: this.params.fishEyeColor,
                    })
                }

                // Matching keys beneath each fishbone
                const capH = layout.h * 0.05
                const capY = cy + geom.height / 2 + capH * 0.9
                fx.drawKeycap(ctx, leftX, capY, capH, "◀")
                fx.drawKeycap(ctx, rightX, capY, capH, "▶")
            },
        })
    },

    start: function (canvas, endGameCallback, options) {
        this.beginLevel(canvas, endGameCallback, options)
        // Simplified phase target logic: divide the theoretical total trials equally across 3 phases.
        const targetPerPhase = this.computePhaseTarget()
        this.setPhaseTargets([targetPerPhase, targetPerPhase, targetPerPhase])
        window.level2Data = this.state.data
        this.assets.imgPlayer = this.assets.imgPlayer1
        // Fill palette for the session. Crucially the colour is NOT tied to a side here: in
        // "orthogonal" mode `placeStimulus` re-draws it per trial, so it cannot stand in for the
        // response the way the old sprite pair did.
        if (this.params.stimulusColorMode === "orthogonal") {
            const pair = this.params.fishFillPair
            this.state.fillPalette = Math.random() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]]
        } else {
            this.state.fillPalette = [this.params.fishFill]
        }
        DoggoNogoCore.startBackgroundMusic(this.assets.soundBackground)
        this.startNewTrial()
    },

    /** Text lines for the phase-break overlay (phase-specific instructions). */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            // Entering Phase 2: introduce vertical / neutral trials
            return [
                "The bone can now also appear above or below!",
                "Respond according to its DIRECTION (left/right).",
                "",
                DoggoNogoUI.words.continueHint,
            ]
        } else if (this.state.phaseIndex === 2) {
            // Entering Phase 3: introduce incongruent horizontal trials
            return ["Don't forget to respond according to the DIRECTION of the bone (left/right).", "", DoggoNogoUI.words.continueHint]
        }
        return [DoggoNogoUI.words.continueHint]
    },

    /**
     * The base class derives the stimulus box from an image's natural dimensions, and there is no
     * image any more. Handing it the fishbone's declared proportions makes the box exactly the shape.
     */
    getStimulusAspectImage: function () {
        return { naturalWidth: this.params.stimulusAspect, naturalHeight: 1 }
    },

    /** Converts a box height in px into the arguments `drawFishbone` needs, outlines included. */
    getFishboneGeometry: function (boxHeight) {
        const outlines = this.params.fishOutlines.map((o) => ({ color: o.color, width: boxHeight * o.width }))
        return { outlines, ...DoggoNogoStimuli.fishboneBox(boxHeight, this.params.stimulusAspect, outlines) }
    },

    /**
     * Draws the fishbone, pointing the way this trial requires, with the exit animations.
     *
     * `direction` mirrors the geometry about the shape's own centre, so the two directions are exact
     * reflections. The sprites were mirrored about their bounding box instead, and their ink sat a
     * pixel off-centre inside it, so left- and right-pointing stimuli landed in slightly different
     * places.
     */
    drawStimulus: function () {
        const stim = this.state.stimulus
        if (!stim.visible && !stim.exiting) return

        let x = stim.x
        let y = stim.y
        let width = stim.width
        let height = stim.height
        let alpha = 1

        if (stim.exiting) {
            const progress = Math.min((this.now() - stim.exitStartTime) / stim.exitDuration, 1)
            x = stim.exitInitialX
            y = stim.exitInitialY
            width = stim.exitInitialWidth
            height = stim.exitInitialHeight
            if (stim.exitType === "catch") {
                const pcx = this.state.player.x + this.state.player.width / 2
                const pcy = this.state.player.y + this.state.player.height / 2
                const targetX = pcx - (width * (1 - progress)) / 2
                const targetY = pcy - (height * (1 - progress)) / 2
                x += (targetX - x) * progress
                y += (targetY - y) * progress
                width *= 1 - progress
                height *= 1 - progress
            } else if (stim.exitType === "timeout") {
                const dir = x > this.state.canvas.width / 2 ? 1 : -1
                x += dir * (this.state.canvas.width / 2) * progress
                alpha = 1 - progress
            }
        }
        if (width <= 0 || height <= 0) return

        const geom = this.getFishboneGeometry(height)
        const ctx = this.state.ctx
        ctx.save()
        ctx.globalAlpha = alpha
        DoggoNogoStimuli.drawFishbone(ctx, {
            centerX: x + width / 2,
            centerY: y + height / 2,
            length: geom.length,
            height: geom.innerHeight,
            direction: stim.side === "right" ? 1 : -1,
            fill: stim.fill || this.params.fishFill,
            outlines: geom.outlines,
            eyeColor: this.params.fishEyeColor,
        })
        ctx.restore()
    },

    /** Hook (called by the base schedule): draw a region, resolve congruency, position the bone. */
    placeStimulus: function () {
        const stim = this.state.stimulus
        let region, side, difficulty
        if (this.state.phaseIndex === 0) {
            // Phase 1: only congruent horizontal trials
            region = Math.random() < 0.5 ? "left" : "right"
            side = region
            difficulty = "congruent"
        } else if (this.state.phaseIndex === 1) {
            // Phase 2: mixture of congruent horizontal and neutral vertical trials
            const pNeutral = Math.min(1, Math.max(0, this.params.neutralProportionPhase2 || 0))
            const isNeutral = Math.random() < pNeutral
            if (isNeutral) {
                region = Math.random() < 0.5 ? "top" : "bottom"
                side = Math.random() < 0.5 ? "left" : "right" // orientation independent of vertical location
                difficulty = "neutral"
            } else {
                region = Math.random() < 0.5 ? "left" : "right"
                side = region
                difficulty = "congruent"
            }
        } else {
            // Phase 3: mixture of congruent & incongruent horizontal (no neutral)
            const pIncong = Math.min(1, Math.max(0, this.params.incongruentProportionPhase3 || 0))
            region = Math.random() < 0.5 ? "left" : "right"
            const isIncong = Math.random() < pIncong
            if (isIncong) {
                side = region === "left" ? "right" : "left" // opposite = incongruent
                difficulty = "incongruent"
            } else {
                side = region
                difficulty = "congruent"
            }
        }
        stim.region = region
        stim.side = side
        stim.difficulty = difficulty
        // Colour is drawn independently of `side`, so it carries no information about the response.
        // In "single" mode the palette has one entry and this is a constant.
        const palette = this.state.fillPalette.length ? this.state.fillPalette : [this.params.fishFill]
        stim.fill = palette[Math.floor(Math.random() * palette.length)]
        // Compute position based on region
        let centerX = this.state.canvas.width * 0.5
        let centerY = this.state.canvas.height * 0.5
        if (region === "left") centerX = this.state.canvas.width * 0.25
        else if (region === "right") centerX = this.state.canvas.width * 0.75
        else if (region === "top") centerY = this.state.canvas.height * (this.params.stimulusLocationTopY || 0.25)
        else if (region === "bottom") centerY = this.state.canvas.height * (this.params.stimulusLocationBottomY || 0.75)
        stim.y = centerY - stim.height / 2
        stim.initialY = stim.y
        stim.x = centerX - stim.width / 2
    },

    /** Hook (called by the base schedule): the response window closed with no press. */
    onResponseTimeout: function () {
        this.finishTrial({
            type: TrialTypes.TIMEOUT,
            points: 0,
            includeInMedian: false,
            stimulusX: this.state.stimulus.x,
            stimulusY: this.state.stimulus.y,
            stimulusRegion: this.state.stimulus.region,
            timestamp: new Date().toISOString(),
        })
    },

    finishTrial: function (outcome) {
        this.state.score += outcome.points
        if (typeof this.state.phaseFloorScore === "number") this.state.score = Math.max(this.state.score, this.state.phaseFloorScore)
        DoggoNogoCore.showScoreDelta(this, outcome.points)
        this._handleTrialOutcomeFeedback(outcome)
        // Only update median with correct (non-error) fast/slow responses
        if (outcome.includeInMedian && typeof outcome.rt === "number" && (outcome.correct === undefined || outcome.correct === true)) {
            this.state.reactionTimes.push(outcome.rt)
            this.state.medianRT = this.computeMedian(this.state.reactionTimes)
        }
        if (outcome.timestamp) {
            const rtVal = outcome.type === "early" || outcome.type === "timeout" || outcome.type === "error" ? null : outcome.rt
            this.state.data.push({
                Level: "level 2",
                Phase: this.state.phaseIndex + 1,
                TrialType: this.getTrialTypeLabel(outcome.type),
                Time: outcome.timestamp,
                Trial: this.state.trials,
                RT: rtVal === null ? "NA" : rtVal,
                Error: outcome.type === "early" || outcome.type === "timeout" || outcome.type === "error" ? 1 : 0,
                Threshold: typeof outcome.thresholdUsed === "number" ? outcome.thresholdUsed : this.getEffectiveThreshold(),
                ISI: this.getRealizedISI() ?? "NA",
                Score: this.state.score,
                ScoreChange: outcome.points,
                StimulusSide: this.state.stimulus.side,
                StimulusRegion: this.state.stimulus.region,
                Difficulty: this.state.stimulus.difficulty || "NA",
                StimulusColor: this.state.stimulus.fill || "NA",
                ResponseKey: outcome.responseKey || "NA",
                Correct: typeof outcome.correct === "boolean" ? (outcome.correct ? 1 : 0) : "NA",
                StimulusX:
                    this.state.canvas && this.state.canvas.width
                        ? ((typeof outcome.stimulusX === "number" ? outcome.stimulusX : this.state.stimulus.x) / this.state.canvas.width) *
                          100
                        : null,
                StimulusY:
                    this.state.canvas && this.state.canvas.height
                        ? ((typeof outcome.stimulusY === "number" ? outcome.stimulusY : this.state.stimulus.y) / this.state.canvas.height) *
                          100
                        : null,
                CanvasWidth: this.state.canvas ? this.state.canvas.width : null,
                CanvasHeight: this.state.canvas ? this.state.canvas.height : null,
            })
        }
        this._checkForPhaseOrLevelEnd()
    },

    _handleTrialOutcomeFeedback: function (outcome) {
        const bubbleX = this.state.player.x + this.state.player.width / 2
        const bubbleY = this.state.player.y
        if (outcome.type === TrialTypes.SLOW) {
            this.showFeedbackBubble("slow", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.TIMEOUT) {
            this.showFeedbackBubble("late", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.EARLY) {
            this.showFeedbackBubble("early", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.ERROR) {
            this.showFeedbackBubble("error", bubbleX, bubbleY)
            this.state.lastFastFeedback = 0
        } else if (outcome.type === TrialTypes.FAST) {
            if (this.state.lastTrialType === TrialTypes.FAST) {
                this.state.lastFastFeedback = (this.state.lastFastFeedback % 3) + 1
            } else {
                this.state.lastFastFeedback = 1
            }
            this.showFeedbackBubble(`fast${this.state.lastFastFeedback}`, bubbleX, bubbleY)
        }
        this.state.lastTrialType = outcome.type
    },

    /** Fixed per-phase target = ceil(trialsNumber/3) * minScore. */
    computePhaseTarget: function () {
        const perPhaseTrials = Math.ceil(this.params.trialsNumber / 3)
        return perPhaseTrials * this.params.minScore
    },

    handleKeyDown: function (e) {
        if (this.state.gameState !== "playing") return
        // Dev/Test shortcut: 's' to skip level immediately
        if (e.key === "s" || e.key === "S") {
            DoggoNogoCore.clearTrialSchedule(this.state)
            this.endLevel()
            return
        }
        if (this.state.inBreak) {
            const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar"
            if (isSpace) this.resumeFromBreak()
            return
        }
        if (!this.isResponseKey(e.key)) return

        // Early press: before the stimulus, or before the frame carrying it reached the screen
        if ((!this.state.stimulus.visible || this.isAwaitingStimulusOnset()) && !this.state.stimulus.exiting) {
            // ...unless it is the late answer to the trial that just timed out (see core.js).
            if (this.isBelatedResponse(e)) return
            this.cancelPendingStimulus()
            DoggoNogoCore.clearTrialSchedule(this.state)
            const nowISO = new Date().toISOString()
            const thresholdUsed = this.getEffectiveThreshold()
            DoggoNogoCore.safePlay(this.assets.soundError)
            this.finishTrial({
                type: TrialTypes.EARLY,
                points: -this.params.minScore,
                includeInMedian: false,
                timestamp: nowISO,
                thresholdUsed,
            })
            this.state.flashUntil = this.state.frameTime + this.params.flashDuration
            return
        }

        // Valid press while stimulus is visible
        if (this.state.stimulus.visible && !this.state.stimulus.exiting) {
            const reactionTime = this.eventTime(e) - this.state.startTime
            this.state.responseDeadline = null
            DoggoNogoCore.startStimulusExit(this.state, () => this.state.frameTime, "catch")
            const threshold = this.getEffectiveThreshold()
            const trialMaxRT = this.state.maxRT || 2 * this.state.medianRT
            const correct =
                (e.key === "ArrowLeft" && this.state.stimulus.side === "left") ||
                (e.key === "ArrowRight" && this.state.stimulus.side === "right")
            if (!correct) {
                // Error penalty: -minScore/2
                DoggoNogoCore.safePlay(this.assets.soundError)
                if (this.state.stimulus.exiting) this.state.stimulus.exitType = "timeout" // sideways drift
                this.finishTrial({
                    type: TrialTypes.ERROR,
                    points: -this.params.minScore / 2,
                    includeInMedian: false,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    responseKey: e.key,
                    correct: false,
                })
                this.state.flashUntil = this.now() + this.params.flashDuration
                return
            }
            // Correct: update facing based on stimulus side (fast or slow)
            this.state.playerFacing = this.state.stimulus.side === "right" ? "right" : "left"
            if (reactionTime > threshold) {
                const include = reactionTime <= trialMaxRT
                DoggoNogoCore.safePlay(this.assets.soundSlow)
                this.finishTrial({
                    type: TrialTypes.SLOW,
                    points: this.params.minScore / 2, // slow correct award: +minScore/2
                    rt: reactionTime,
                    includeInMedian: include,
                    timestamp: new Date().toISOString(),
                    thresholdUsed: threshold,
                    stimulusX: this.state.stimulus.x,
                    stimulusY: this.state.stimulus.y,
                    responseKey: e.key,
                    correct: true,
                })
                return
            }
            const clampedRT = Math.min(reactionTime, trialMaxRT)
            const nRT = 1 - clampedRT / Math.max(1, trialMaxRT)
            const points = this.params.minScore + nRT * (this.params.maxScore - this.params.minScore)
            this.jump(reactionTime)
            DoggoNogoCore.safePlay(this.assets.soundFast)
            this.finishTrial({
                type: TrialTypes.FAST,
                points,
                rt: reactionTime,
                includeInMedian: true,
                timestamp: new Date().toISOString(),
                thresholdUsed: threshold,
                responseKey: e.key,
                correct: true,
            })
        }
    },
}

// Inherit shared gameplay mechanics from the base level.
Object.setPrototypeOf(level2, DoggoNogoBaseLevel)
level2.state = level2.getInitialState()
