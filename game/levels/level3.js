/**
 * @file Level 3 — Vertical-horizontal illusion (two-alternative forced choice on bone length).
 *
 * One bone lies exactly horizontal (the reference); the other is tilted toward vertical, and
 * more-vertical extents are systematically overestimated. The tilt IS the illusion, so nothing
 * jitters orientation here: strength = the tilt in degrees away from horizontal (0 = no illusion,
 * 90 = fully vertical), applied to the side `placeStimulus` (illusion.js) draws as `boostedSide`.
 * The tilt's direction (clockwise vs counter-clockwise) is cosmetic — the illusion depends only on
 * how far from horizontal the bone lies — so it is randomized to keep the display symmetric.
 *
 * All task logic, the two-parameter design (`TaskDifficulty` / `IllusionStrength`, both signed),
 * and the phase ramp live in `DoggoNogoIllusionLevel` (game/levels/illusion.js); this file only
 * supplies the bone geometry, the per-phase ranges, and the level's text.
 */

import { DoggoNogoStimuli } from "../stimuli.js"
import { DoggoNogoIllusionLevel, illusionDefaultParams, borrowedLevel1Assets, round1 } from "./illusion.js"

const angleDeg = (item) => (item && typeof item.angle === "number" ? round1((item.angle * 180) / Math.PI) : "NA")

export const level3 = {
    levelNumber: 3,
    illusion: "verticalhorizontal",

    params: {
        ...illusionDefaultParams(),

        // Phase ramp: learn the comparison, then feel the illusion, then the measurement block.
        // difficultyRange = proportional length difference (log-uniform); strengthRange = tilt in
        // degrees away from horizontal (uniform).
        phases: [
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 15] }, // obvious difference, weak tilt at most
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 90] }, // obvious difference, full tilt range
            { difficultyRange: [0.04, 0.35], strengthRange: [0, 90] }, // full difficulty x full illusion
        ],

        // Stimulus geometry (fractions of canvas height, so the pair scales as one shape).
        // No outlines on the illusion stimuli: a flat fill on the uniform backdrop keeps the
        // percept as simple as possible — psychometric quality over art style.
        stimulusLength: 0.3, // base tip-to-tip bone length
        stimulusThickness: 0.035, // shaft width (the lobed ends are ~2x this)
        boneFill: "#ffffff",
    },

    assets: borrowedLevel1Assets(),

    // Mutable runtime data. Replaced by a fresh object on every `start()` (see illusion.js).
    state: null,

    instructionTitle: "Crooked bones",
    instructionLines: [
        "Two bones appear either side of Doggo.",
        "Press the arrow key pointing at the LONGER one.",
        "Careful — tilted bones can fool your eyes!",
    ],

    /** Example pair in the phase-1 layout: horizontal reference, tilted comparison. */
    drawInstructionDemo: function (ctx, canvas, midY) {
        // A little under task size, so the tilted bone stays clear of the keycap drawn below it.
        const demo = [
            { x: 0.3, len: 0.17, angle: 0 },
            { x: 0.7, len: 0.24, angle: (-65 * Math.PI) / 180 },
        ]
        demo.forEach((d) => {
            DoggoNogoStimuli.drawBone(ctx, {
                centerX: canvas.width * d.x,
                centerY: midY,
                length: canvas.height * d.len,
                thickness: canvas.height * this.params.stimulusThickness,
                angle: d.angle,
                fill: this.params.boneFill,
            })
        })
    },

    /** Phase-break overlay lines announcing the ramp (see `params.phases`). */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            return ["The bones are tilting wildly now —", "don't trust the slanted ones!", "", "Press SPACE to continue"]
        } else if (this.state.phaseIndex === 2) {
            return ["Final phase: the differences get subtle.", "Look closely!", "", "Press SPACE to continue"]
        }
        return ["Press SPACE to continue"]
    },

    /**
     * Hook (see illusion.js): the reference bone at 0° and, on the boosted side, the comparison
     * tilted by the trial's strength. Lengths differ by the trial's difficulty.
     */
    composeStimulusItems: function (cfg, trial) {
        const p = this.params
        const jitter = (span) => (Math.random() * 2 - 1) * span
        const baseLength = p.stimulusLength * (1 + jitter(p.stimulusSizeJitter))
        const tiltSign = Math.random() < 0.5 ? -1 : 1
        return ["left", "right"].map((side) => ({
            side,
            ...this.sampleItemCentre(side),
            lengthFrac: baseLength * (side === trial.longerSide ? 1 + trial.difficultyAbs : 1),
            angle: side === trial.boostedSide ? (tiltSign * trial.strengthAbs * Math.PI) / 180 : 0,
        }))
    },

    /** Hook (see illusion.js): one bone, converted from fractions to pixels at draw time. */
    drawStimulusItem: function (item) {
        const canvas = this.state.canvas
        const p = this.params
        DoggoNogoStimuli.drawBone(this.state.ctx, {
            centerX: canvas.width * item.cxFrac,
            centerY: canvas.height * item.cyFrac,
            length: canvas.height * item.lengthFrac,
            thickness: canvas.height * p.stimulusThickness,
            angle: item.angle,
            fill: p.boneFill,
        })
    },

    /** Hook (see illusion.js): raw on-screen geometry for the data log. */
    getStimulusLogFields: function (stim) {
        return {
            LengthLeft: stim ? Math.round(stim.items[0].lengthFrac * 1e4) / 1e4 : "NA",
            LengthRight: stim ? Math.round(stim.items[1].lengthFrac * 1e4) / 1e4 : "NA",
            AngleLeft: stim ? angleDeg(stim.items[0]) : "NA",
            AngleRight: stim ? angleDeg(stim.items[1]) : "NA",
        }
    },
}

// Inherit the shared illusion-task logic (which itself inherits the base gameplay mechanics).
Object.setPrototypeOf(level3, DoggoNogoIllusionLevel)
level3.state = level3.getInitialState()
