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
 * Story ("Bone fever"): a bone thrown from a passing car lures Doggo out of the garden and into
 * the city, and he cannot stop wanting the bigger bone. The three phases are his descent: happy on
 * a restaurant terrace, loony at the kitchen's back door, berserk inside the kitchen with the Chef
 * throwing bones to keep him back — which is also why bones land at odd angles. Each phase has its
 * own sprite AND its own background (`assets.imgPlayer{1,2,3}` / `assets.imgBackground{1,2,3}`, both
 * swapped by the base `playBreakEffects`). This is the first illusion level with art of its own, so
 * it declares `artFolder` / `backgrounds` and the shared `load` (illusion.js) picks those up instead
 * of Level 1's sprites and the grey backdrop; the feedback bubbles and sounds are still borrowed.
 * Drawing the bones over painted scenes rather than flat grey is also what `params.boneOutlines`
 * below is for.
 *
 * All task logic, the two-parameter design (`TaskDifficulty` / `IllusionStrength`, both signed),
 * and the phase ramp live in `DoggoNogoIllusionLevel` (game/levels/illusion.js); this file only
 * supplies the bone geometry, the per-phase ranges, and the level's text.
 */

import { DoggoNogoStimuli } from "../stimuli.js"
import { DoggoNogoUI } from "../game.js"
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

        // Doggo, bigger and lower than the illusion default (0.2 at mid-height): that default was
        // set for a borrowed sprite floating on flat grey, and these scenes have a floor — the
        // pavement, the alley, the kitchen tiles all run through the lower half, and the sprite now
        // carries the story beat (loony eyes, then drool), which is lost at 20% of the height. Both
        // stimuli stay clear of him: they sit at +-25% of the canvas WIDTH from centre, and even the
        // longest jittered bone's inner tip stops short of the sprite box.
        playerHeight: 0.28, // % of canvas height
        playerY: 0.6, // vertical centre, so the paws land on the scene's floor

        // Stimulus geometry (fractions of canvas height, so the pair scales as one shape).
        stimulusLength: 0.3, // base tip-to-tip bone length
        stimulusThickness: 0.035, // shaft width (the lobed ends are ~2x this)
        boneFill: "#ffffff",
        // One thin dark contour, width as a fraction of the full bone height (same convention as
        // level1.js). The three scenes are pale and busy exactly where the bones land — sunlit
        // pavement, then a checked kitchen floor — and a white fill on those is a low-contrast
        // stimulus whose visibility would depend on the patch it landed on. The contour holds the
        // bone's edge constant whatever is behind it. It stays thin on purpose: an outline spills
        // past the geometry on both bones alike, so it dilutes the proportional length difference
        // the task manipulates (at this weight by ~0.03% of the difference — negligible, but it
        // grows with the width), and a heavy ring would start to read as extent of its own.
        boneOutlines: [{ color: "#1b1410", width: 0.06 }],
    },

    // Feedback art and sounds are still Level 1's (see `borrowedLevel1Assets`); the sprites and the
    // three scenes are this level's own, declared by `artFolder` / `backgrounds` below and loaded by
    // the shared `load`. `imgBackground` is whichever scene is currently on screen.
    assets: {
        ...borrowedLevel1Assets(),
        imgBackground: new Image(),
        imgBackground1: new Image(),
        imgBackground2: new Image(),
        imgBackground3: new Image(),
    },

    artFolder: "level3", // player_1..3.webp come from assets/level3/ rather than assets/level1/
    backgrounds: ["level3/background_1.webp", "level3/background_2.webp", "level3/background_3.webp"],

    // Mutable runtime data. Replaced by a fresh object on every `start()` (see illusion.js).
    state: null,

    instructionTitle: "Bone fever",
    instructionLines: [
        "Doggo has followed a bone into the city - and he wants MORE.",
        "Bones land either side of him: grab the LONGER one with its arrow key.",
        "Careful - a bone landing on its end looks longer than it is!",
    ],
    // Same beats, named for a screen rather than a keyboard (see `showInstructionScreen` in illusion.js).
    touchInstructionLines: [
        "Doggo has followed a bone into the city - and he wants MORE.",
        "Bones land either side of him: tap the side with the LONGER one.",
        "Careful - a bone landing on its end looks longer than it is!",
    ],

    /**
     * The outline stack in pixels, from the weights in `params.boneOutlines`. Widths are fractions
     * of the full bone height (`2 * thickness`), so they scale with the canvas like the bone does.
     */
    boneOutlinesPx: function (thicknessPx) {
        return this.params.boneOutlines.map((o) => ({ color: o.color, width: 2 * thicknessPx * o.width }))
    },

    /** Example pair in the phase-1 layout: horizontal reference, tilted comparison. */
    drawInstructionDemo: function (ctx, canvas, midY) {
        // A little under task size, so the tilted bone stays clear of the keycap drawn below it.
        const demo = [
            { x: 0.3, len: 0.17, angle: 0 },
            { x: 0.7, len: 0.24, angle: (-65 * Math.PI) / 180 },
        ]
        const thickness = canvas.height * this.params.stimulusThickness
        demo.forEach((d) => {
            DoggoNogoStimuli.drawBone(ctx, {
                centerX: canvas.width * d.x,
                centerY: midY,
                length: canvas.height * d.len,
                thickness,
                angle: d.angle,
                fill: this.params.boneFill,
                outlines: this.boneOutlinesPx(thickness),
            })
        })
    },

    /**
     * Phase-break overlay lines: the story beat of the descent (terrace -> kitchen door -> kitchen)
     * plus what the ramp does (see `params.phases`).
     */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            return [
                "Doggo can't stop. He sniffs his way to the kitchen door...",
                "Bones fly out at every angle - don't trust the ones on end!",
                "",
                DoggoNogoUI.words.continueHint,
            ]
        } else if (this.state.phaseIndex === 2) {
            return [
                "Doggo has lost it! He is IN the kitchen.",
                "The Chef throws bones just to keep him back - the differences get subtle. Look closely!",
                "",
                DoggoNogoUI.words.continueHint,
            ]
        }
        return [DoggoNogoUI.words.continueHint]
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
        const thickness = canvas.height * p.stimulusThickness
        DoggoNogoStimuli.drawBone(this.state.ctx, {
            centerX: canvas.width * item.cxFrac,
            centerY: canvas.height * item.cyFrac,
            length: canvas.height * item.lengthFrac,
            thickness,
            angle: item.angle,
            fill: p.boneFill,
            outlines: this.boneOutlinesPx(thickness),
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
