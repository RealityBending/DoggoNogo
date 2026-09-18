/**
 * @file Level 4 — Müller-Lyer illusion (two-alternative forced choice on sausage length).
 *
 * Both stimuli are tied sausages lying horizontal: a cured-sausage body with a string knotted
 * around the pinched casing at each end, the twisted casing stub showing beyond the knot, and the
 * string's two loose ends splayed from the knot. Those loose ends are the illusion's fins. Ends
 * splayed outward past the tip make a sausage look longer; folded back over the body they make it
 * look shorter. Both sausages always carry the string — what varies is the sweep away from the
 * perpendicular-neutral position (90° to the long axis): strength = that sweep in degrees, with the
 * boosted side getting the outward set (90 − S) and the other the inward set (90 + S). At strength
 * 0 both would have perpendicular string ends and no distortion.
 *
 * The sausage replaced an earlier ribboned bone (Sept 2026): a sausage's tip is a single point on
 * the axis rather than two lobe rims with a notch, and its link string is the classic fin with
 * nothing to justify. The stimulus is drawn procedurally (`DoggoNogoStimuli.drawSausage`), so any
 * string angle is available and the knot — the illusion vertex — sits a fixed 0.46 body-heights
 * inside each tip on both stimuli.
 *
 * TODO (narrative rework): the instruction text, phase-break lines, cutscene (cutscenes.js) and
 * the planned art still tell the ribboned-bone story ("Nogo's gift ribbons"). They have been
 * minimally re-worded to name sausages and strings so the screen is not wrong, but the story
 * needs a proper pass around strings of sausages (see README, Level 4).
 *
 * All task logic, the two-parameter design (`TaskDifficulty` / `IllusionStrength`, both signed),
 * and the phase ramp live in `DoggoNogoIllusionLevel` (game/levels/illusion.js); this file only
 * supplies the tied-sausage geometry, the per-phase ranges, and the level's text.
 */

import { DoggoNogoStimuli } from "../stimuli.js"
import { DoggoNogoUI } from "../game.js"
import { DoggoNogoIllusionLevel, illusionDefaultParams, borrowedLevel1Assets, round1 } from "./illusion.js"

const finDeg = (item) => (item && typeof item.finAngleDeg === "number" ? round1(item.finAngleDeg) : "NA")

export const level4 = {
    levelNumber: 4,
    illusion: "mullerlyer",

    params: {
        ...illusionDefaultParams(),

        // Phase ramp: learn the comparison, then feel the illusion, then the measurement block.
        // difficultyRange = proportional length difference (log-uniform); strengthRange = string
        // sweep in degrees away from perpendicular-neutral (uniform).
        phases: [
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 10] }, // obvious difference, near-neutral strings
            { difficultyRange: [0.2, 0.35], strengthRange: [0, 40] }, // obvious difference, full sweep range
            { difficultyRange: [0.04, 0.35], strengthRange: [0, 40] }, // full difficulty x full illusion
        ],

        // Stimulus geometry (fractions of canvas height, so the pair scales as one shape).
        stimulusLength: 0.26, // tip-to-tip, casing stubs included; the string ends add extent past the tips
        stimulusThickness: 0.035, // body height (the string knots stay within it)
        // Skin: a floury cured sausage (saucisson). Shade, bloom and highlight all stop a fixed
        // distance inside the body's caps, so none of them offers a second endpoint to compare.
        sausageFill: "#9c5346",
        sausageShade: "#6b3129",
        sausageHighlight: "#c98f80",
        sausageBloom: "rgba(245,238,228,0.32)",
        casingFill: "#f0d7c3",
        // One thin dark contour, width as a fraction of the body height (same convention as
        // level3.js, where it is a fraction of the bone's full height). The backdrop is plain grey
        // for now, but the contour keeps the sausage's edge — and the string's — constant when the
        // level gets painted scenes, and it stays thin so it dilutes the length difference as
        // little as possible (it spills equally past both stimuli).
        sausageOutlines: [{ color: "#1b1410", width: 0.07 }],
        // The string: red on the pale cured body (as on a real saucisson). `stringLength` is the
        // loose ends' length from the knot, as a fraction of canvas height.
        stringLength: 0.115,
        stringFill: "#d9412b",
        stringDark: "#8a2216",
    },

    assets: borrowedLevel1Assets(),

    // Mutable runtime data. Replaced by a fresh object on every `start()` (see illusion.js).
    state: null,

    // TODO (narrative rework): placeholder wording — see the file header.
    instructionTitle: "The way home",
    instructionLines: [
        "Nogo is luring Doggo home with a trail of tied sausages.",
        "Press the arrow key pointing at the LONGER sausage -",
        "and don't let the strings fool your eyes.",
    ],
    // Same beats, named for a screen rather than a keyboard (see `showInstructionScreen` in illusion.js).
    touchInstructionLines: [
        "Nogo is luring Doggo home with a trail of tied sausages.",
        "Tap the side with the LONGER sausage -",
        "and don't let the strings fool your eyes.",
    ],

    /** Example pair: same true length, outward vs inward string ends (the illusion at full tilt). */
    drawInstructionDemo: function (ctx, canvas, midY) {
        const demo = [
            { x: 0.3, finAngleDeg: 60 },
            { x: 0.7, finAngleDeg: 120 },
        ]
        demo.forEach((d) => {
            this._drawTiedSausage(ctx, canvas, canvas.width * d.x, midY, canvas.height * 0.24, d.finAngleDeg)
        })
    },

    /** Phase-break overlay lines announcing the ramp (see `params.phases`). */
    getBreakOverlayLines: function () {
        // TODO (narrative rework): placeholder wording — see the file header.
        if (this.state.phaseIndex === 1) {
            return ["The frenzy is fading... Nogo pulls the strings wider -", "they warp the sausages' looks!", "", DoggoNogoUI.words.continueHint]
        } else if (this.state.phaseIndex === 2) {
            return ["Almost home. The differences get subtle now.", "Look closely!", "", DoggoNogoUI.words.continueHint]
        }
        return [DoggoNogoUI.words.continueHint]
    },

    /**
     * Hook (see illusion.js): two horizontal sausages, lengths differing by the trial's difficulty,
     * string ends splayed outward on the boosted side and folded inward on the other.
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

    /** Hook (see illusion.js): one tied sausage, converted from fractions to pixels at draw time. */
    drawStimulusItem: function (item) {
        const canvas = this.state.canvas
        this._drawTiedSausage(
            this.state.ctx,
            canvas,
            canvas.width * item.cxFrac,
            canvas.height * item.cyFrac,
            canvas.height * item.lengthFrac,
            item.finAngleDeg,
        )
    },

    /** One horizontal tied sausage, shared by the task and the instruction demo. */
    _drawTiedSausage: function (ctx, canvas, centerX, centerY, length, finAngleDeg) {
        const p = this.params
        const thickness = canvas.height * p.stimulusThickness
        DoggoNogoStimuli.drawSausage(ctx, {
            centerX,
            centerY,
            length,
            thickness,
            angle: 0,
            fill: p.sausageFill,
            shade: p.sausageShade,
            highlight: p.sausageHighlight,
            bloom: p.sausageBloom,
            casingFill: p.casingFill,
            outlines: (p.sausageOutlines || []).map((o) => ({ color: o.color, width: o.width * thickness })),
            string: {
                angle: (finAngleDeg * Math.PI) / 180,
                length: canvas.height * p.stringLength,
                fill: p.stringFill,
                dark: p.stringDark,
            },
        })
    },

    /** Hook (see illusion.js): raw on-screen geometry for the data log. */
    getStimulusLogFields: function (stim) {
        return {
            LengthLeft: stim ? Math.round(stim.items[0].lengthFrac * 1e4) / 1e4 : "NA",
            LengthRight: stim ? Math.round(stim.items[1].lengthFrac * 1e4) / 1e4 : "NA",
            // "Fin" is the Müller-Lyer term for the string's loose ends; the column name is kept.
            FinAngleLeft: stim ? finDeg(stim.items[0]) : "NA",
            FinAngleRight: stim ? finDeg(stim.items[1]) : "NA",
        }
    },
}

// Inherit the shared illusion-task logic (which itself inherits the base gameplay mechanics).
Object.setPrototypeOf(level4, DoggoNogoIllusionLevel)
level4.state = level4.getInitialState()
