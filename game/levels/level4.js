/**
 * @file Level 4 — Müller-Lyer illusion (two-alternative forced choice on bone length).
 *
 * Both bones lie horizontal, but (story: Nogo's mischief) they carry ribbon blades at their tips.
 * Blades swept outward past the tip make a bone look longer; folded back over the shaft they make
 * it look shorter. Both bones always wear ribbons — what varies is the sweep away from the
 * perpendicular-neutral position (90° to the bone's axis): strength = that sweep in degrees, with
 * the boosted side getting the outward set (90 − S) and the other the inward set (90 + S). At
 * strength 0 both would be plain perpendicular ribbons with no distortion.
 *
 * The ribbon is drawn procedurally (see `drawBone`'s `fins` option in game/stimuli.js), so any
 * blade angle is available: a red band wrapped around the shaft where it meets each end lobe,
 * with the blades rooted at that band — blades behind the bone, bands over it, so the bone's own
 * silhouette (the extent being judged) stays intact and the ribbon reads as tied around it.
 *
 * All task logic, the two-parameter design (`TaskDifficulty` / `IllusionStrength`, both signed),
 * and the phase ramp live in `DoggoNogoIllusionLevel` (game/levels/illusion.js); this file only
 * supplies the ribboned-bone geometry, the per-phase ranges, and the level's text.
 */

import { DoggoNogoStimuli } from "../stimuli.js"
import { DoggoNogoIllusionLevel, illusionDefaultParams, borrowedLevel1Assets, round1 } from "./illusion.js"

const finDeg = (item) => (item && typeof item.finAngleDeg === "number" ? round1(item.finAngleDeg) : "NA")

export const level4 = {
    levelNumber: 4,
    illusion: "mullerlyer",

    params: {
        ...illusionDefaultParams(),

        // Phase ramp: learn the comparison, then feel the illusion, then the measurement block.
        // difficultyRange = proportional length difference (log-uniform); strengthRange = blade
        // sweep in degrees away from perpendicular-neutral (uniform).
        phases: [
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 10] }, // obvious difference, near-neutral ribbons
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 40] }, // obvious difference, full sweep range
            { difficultyRange: [0.04, 0.35], strengthRange: [0, 40] }, // full difficulty x full illusion
        ],

        // Stimulus geometry (fractions of canvas height, so the pair scales as one shape).
        // No outlines on the illusion stimuli: a flat fill on the uniform backdrop keeps the
        // percept as simple as possible — psychometric quality over art style.
        stimulusLength: 0.26, // shorter than Level 3's bones: the blades add extent past the tips
        stimulusThickness: 0.035, // shaft width (the lobed ends are ~2x this)
        boneFill: "#ffffff",
        // The ribbon: a band wrapped around the shaft, well inside the end lobes, with the blades
        // rooted at that band. The band is exactly as tall as the shaft (it hugs the middle part
        // of the bone rather than sticking past it).
        finLength: 0.1, // blade length, measured from the band
        finThickness: 0.02, // blade width
        finInset: 0.055, // band centre's distance in from each bone tip
        finBandWidth: 0.016, // band extent along the bone's axis
        finBandHeight: 0.035, // band extent across the bone = stimulusThickness (the shaft's height)
        finFill: "#e0392a", // ribbon red (Nogo's gift ribbons)
    },

    assets: borrowedLevel1Assets(),

    // Mutable runtime data. Replaced by a fresh object on every `start()` (see illusion.js).
    state: null,

    instructionTitle: "The way home",
    instructionLines: [
        "Nogo is luring Doggo home with a trail of ribboned bones.",
        "Press the arrow key pointing at the LONGER bone -",
        "and don't let the ribbons fool your eyes.",
    ],

    /** Example pair: same true length, outward vs inward ribbons (the illusion at full tilt). */
    drawInstructionDemo: function (ctx, canvas, midY) {
        const demo = [
            { x: 0.3, finAngleDeg: 60 },
            { x: 0.7, finAngleDeg: 120 },
        ]
        demo.forEach((d) => {
            this._drawRibbonedBone(ctx, canvas, canvas.width * d.x, midY, canvas.height * 0.24, d.finAngleDeg)
        })
    },

    /** Phase-break overlay lines announcing the ramp (see `params.phases`). */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            return ["The frenzy is fading... Nogo sweeps the ribbons wider -", "they warp the bones' looks!", "", "Press SPACE to continue"]
        } else if (this.state.phaseIndex === 2) {
            return ["Almost home. The differences get subtle now.", "Look closely!", "", "Press SPACE to continue"]
        }
        return ["Press SPACE to continue"]
    },

    /**
     * Hook (see illusion.js): two horizontal bones, lengths differing by the trial's difficulty,
     * ribbons swept outward on the boosted side and inward on the other.
     */
    composeStimulusItems: function (cfg, trial) {
        const p = this.params
        const jitter = (span) => (Math.random() * 2 - 1) * span
        const baseLength = p.stimulusLength * (1 + jitter(p.stimulusSizeJitter))
        return ["left", "right"].map((side) => ({
            side,
            ...this.sampleItemCentre(side),
            lengthFrac: baseLength * (side === trial.longerSide ? 1 + trial.difficultyAbs : 1),
            finAngleDeg: side === trial.boostedSide ? 90 - trial.strengthAbs : 90 + trial.strengthAbs,
        }))
    },

    /** Hook (see illusion.js): one ribboned bone, converted from fractions to pixels at draw time. */
    drawStimulusItem: function (item) {
        const canvas = this.state.canvas
        this._drawRibbonedBone(
            this.state.ctx,
            canvas,
            canvas.width * item.cxFrac,
            canvas.height * item.cyFrac,
            canvas.height * item.lengthFrac,
            item.finAngleDeg,
        )
    },

    /** One horizontal bone with ribbon bands + blades, shared by the task and the instruction demo. */
    _drawRibbonedBone: function (ctx, canvas, centerX, centerY, length, finAngleDeg) {
        const p = this.params
        DoggoNogoStimuli.drawBone(ctx, {
            centerX,
            centerY,
            length,
            thickness: canvas.height * p.stimulusThickness,
            angle: 0,
            fill: p.boneFill,
            fins: {
                angle: (finAngleDeg * Math.PI) / 180,
                length: canvas.height * p.finLength,
                thickness: canvas.height * p.finThickness,
                inset: canvas.height * p.finInset,
                bandWidth: canvas.height * p.finBandWidth,
                bandHeight: canvas.height * p.finBandHeight,
                fill: p.finFill,
            },
        })
    },

    /** Hook (see illusion.js): raw on-screen geometry for the data log. */
    getStimulusLogFields: function (stim) {
        return {
            LengthLeft: stim ? Math.round(stim.items[0].lengthFrac * 1e4) / 1e4 : "NA",
            LengthRight: stim ? Math.round(stim.items[1].lengthFrac * 1e4) / 1e4 : "NA",
            FinAngleLeft: stim ? finDeg(stim.items[0]) : "NA",
            FinAngleRight: stim ? finDeg(stim.items[1]) : "NA",
        }
    },
}

// Inherit the shared illusion-task logic (which itself inherits the base gameplay mechanics).
Object.setPrototypeOf(level4, DoggoNogoIllusionLevel)
level4.state = level4.getInitialState()
