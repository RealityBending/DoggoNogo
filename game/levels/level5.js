/**
 * @file Level 5 — Ebbinghaus illusion (two-alternative forced choice on disc size).
 *
 * Two target discs, each surrounded by a ring of context discs; a target ringed by small
 * context looks larger, ringed by large context looks smaller. The player picks the truly
 * bigger target ("treat"). Plain circles for now — assets and narrative come later.
 *
 * The geometry is a direct port of Pyllusion's parametrization
 * (https://github.com/RealityBending/Pyllusion, pyllusion/Ebbinghaus/ebbinghaus_parameters.py):
 *
 *  - Targets: the larger one's DIAMETER is sqrt(1 + difficulty) times the smaller one's, so
 *    `TaskDifficulty` here is a proportional AREA difference (Pyllusion's `difference`
 *    convention for circles) — unlike Levels 3-4, where it is a proportional length difference.
 *  - Context: each ring's base size is its own target's size (as in Pyllusion), then the
 *    strength S is halved and the boosted side's context is divided by sqrt(1 + S/2) while the
 *    other side's is multiplied by it — small context inflates the percept, so the boosted side
 *    gets the small ring. At S = 0 both rings simply mirror their targets (no distortion).
 *  - Ring layout: ring radius = target radius + context radius + a small gap, and the number of
 *    context discs is what fits one-diameter apart along that ring's perimeter (so big-context
 *    figures naturally get ~5 discs and small-context figures ~8+, like the classic figure).
 *    The ring's rotation phase is randomized per side per trial.
 *
 * All task logic, the two-parameter design (`TaskDifficulty` / `IllusionStrength`, both signed),
 * and the phase ramp live in `DoggoNogoIllusionLevel` (game/levels/illusion.js); this file only
 * supplies the disc geometry, the per-phase ranges, and the level's text.
 */

import { DoggoNogoStimuli } from "../stimuli.js"
import { DoggoNogoIllusionLevel, illusionDefaultParams, borrowedLevel1Assets, round4 } from "./illusion.js"

export const level5 = {
    levelNumber: 5,
    illusion: "ebbinghaus",

    params: {
        ...illusionDefaultParams(),

        // Phase ramp: learn the comparison, then feel the illusion, then the measurement block.
        // difficultyRange = proportional AREA difference between the targets (log-uniform);
        // strengthRange = Pyllusion-style context-size strength (uniform; the Illusion Game's
        // main task used up to 1.5).
        phases: [
            { difficultyRange: [0.25, 0.5], strengthRange: [0, 0.3] }, // obvious difference, near-neutral rings
            { difficultyRange: [0.25, 0.5], strengthRange: [0, 1.5] }, // obvious difference, full ring range
            { difficultyRange: [0.05, 0.5], strengthRange: [0, 1.5] }, // full difficulty x full illusion
        ],

        // Stimulus geometry (fractions of canvas height, so each figure scales as one shape).
        // No outlines on the illusion stimuli: a flat fill on the uniform backdrop keeps the
        // percept as simple as possible — psychometric quality over art style.
        stimulusDiameter: 0.1, // base target diameter
        contextGap: 0.01, // clearance between a target's rim and its context ring
        ballFill: "#e8913a", // placeholder "treat"
        contextFill: "#5b6270", // context discs: neutral slate, clearly not the treat
    },

    assets: borrowedLevel1Assets(),

    // Mutable runtime data. Replaced by a fresh object on every `start()` (see illusion.js).
    state: null,

    instructionTitle: "Decoy treats",
    instructionLines: [
        "Two treats appear either side of Doggo.",
        "Press the arrow key pointing at the BIGGER one.",
        "Ignore the circles around them — they play tricks!",
    ],

    /**
     * Example pair: the illusion at full tilt (small treat in a big ring, big treat in a small
     * ring). Drawn a little under task size so the big-context figure fits the instruction
     * frame's visual band (its ring reaches ~0.15 of the canvas height from the centre).
     */
    drawInstructionDemo: function (ctx, canvas, midY) {
        const cyFrac = midY / canvas.height
        const demo = [
            { cxFrac: 0.3, d: 0.075, c: 0.115 },
            { cxFrac: 0.7, d: 0.105, c: 0.06 },
        ]
        demo.forEach((it) => {
            this._drawEbbinghausItem(ctx, canvas, {
                cxFrac: it.cxFrac,
                cyFrac,
                diameterFrac: it.d,
                contextDiameterFrac: it.c,
                ...this._ringLayout(it.d, it.c),
                ringPhase: Math.PI / 2,
            })
        })
    },

    /** Phase-break overlay lines announcing the ramp (see `params.phases`). */
    getBreakOverlayLines: function () {
        if (this.state.phaseIndex === 1) {
            return ["The circles around the treats grow bolder —", "judge only the treat in the middle!", "", "Press SPACE to continue"]
        } else if (this.state.phaseIndex === 2) {
            return ["Final phase: the differences get subtle.", "Look closely!", "", "Press SPACE to continue"]
        }
        return ["Press SPACE to continue"]
    },

    /** Ring radius and context count for one figure, Pyllusion's rules (see the file header). */
    _ringLayout: function (targetDiameterFrac, contextDiameterFrac) {
        const ringRadiusFrac = targetDiameterFrac / 2 + contextDiameterFrac / 2 + this.params.contextGap
        const contextCount = Math.max(3, Math.floor((2 * Math.PI * ringRadiusFrac) / contextDiameterFrac))
        return { ringRadiusFrac, contextCount }
    },

    /**
     * Hook (see illusion.js): two ringed targets. Target areas differ by the trial's difficulty
     * (diameters by its square root); the boosted side's context shrinks and the other side's
     * grows by the same sqrt(1 + S/2) factor.
     */
    composeStimulusItems: function (cfg, trial) {
        const p = this.params
        const jitter = (span) => (Math.random() * 2 - 1) * span
        const baseDiameter = p.stimulusDiameter * (1 + jitter(p.stimulusSizeJitter))
        const contextFactor = Math.sqrt(1 + trial.strengthAbs / 2)
        return ["left", "right"].map((side) => {
            const diameterFrac = baseDiameter * (side === trial.longerSide ? Math.sqrt(1 + trial.difficultyAbs) : 1)
            const contextScale = trial.boostedSide === null ? 1 : side === trial.boostedSide ? 1 / contextFactor : contextFactor
            const contextDiameterFrac = diameterFrac * contextScale
            return {
                side,
                ...this.sampleItemCentre(side),
                diameterFrac,
                contextDiameterFrac,
                ...this._ringLayout(diameterFrac, contextDiameterFrac),
                ringPhase: Math.random() * Math.PI * 2,
            }
        })
    },

    /** Hook (see illusion.js): one ringed target, converted from fractions to pixels at draw time. */
    drawStimulusItem: function (item) {
        this._drawEbbinghausItem(this.state.ctx, this.state.canvas, item)
    },

    /** One Ebbinghaus figure (context ring behind, target on top), shared with the instruction demo. */
    _drawEbbinghausItem: function (ctx, canvas, item) {
        const p = this.params
        const cx = canvas.width * item.cxFrac
        const cy = canvas.height * item.cyFrac
        const ringRadius = canvas.height * item.ringRadiusFrac
        for (let i = 0; i < item.contextCount; i++) {
            const a = item.ringPhase + (i * 2 * Math.PI) / item.contextCount
            DoggoNogoStimuli.drawBall(ctx, {
                centerX: cx + ringRadius * Math.cos(a),
                centerY: cy + ringRadius * Math.sin(a),
                diameter: canvas.height * item.contextDiameterFrac,
                fill: p.contextFill,
            })
        }
        DoggoNogoStimuli.drawBall(ctx, {
            centerX: cx,
            centerY: cy,
            diameter: canvas.height * item.diameterFrac,
            fill: p.ballFill,
        })
    },

    /** Hook (see illusion.js): raw on-screen geometry for the data log. */
    getStimulusLogFields: function (stim) {
        return {
            DiameterLeft: stim ? round4(stim.items[0].diameterFrac) : "NA",
            DiameterRight: stim ? round4(stim.items[1].diameterFrac) : "NA",
            ContextDiameterLeft: stim ? round4(stim.items[0].contextDiameterFrac) : "NA",
            ContextDiameterRight: stim ? round4(stim.items[1].contextDiameterFrac) : "NA",
            ContextCountLeft: stim ? stim.items[0].contextCount : "NA",
            ContextCountRight: stim ? stim.items[1].contextCount : "NA",
        }
    },
}

// Inherit the shared illusion-task logic (which itself inherits the base gameplay mechanics).
Object.setPrototypeOf(level5, DoggoNogoIllusionLevel)
level5.state = level5.getInitialState()
