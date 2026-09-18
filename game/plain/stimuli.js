/**
 * @file Plain (non-gamified) stimuli, for the `?gamified=0` comparison condition.
 *
 * REMOVABLE: this whole folder exists for one study (gamified vs. barebones). Deleting
 * `game/plain/` and the seams listed in AGENTS.md removes the feature entirely.
 *
 * Each shape here is the abstract counterpart of one game stimulus, and takes the *same geometry
 * the game computes* — the level's `composeStimulusItems` / `placeStimulus` are untouched, so
 * lengths, angles, jitter and positions are drawn from identical distributions in both conditions.
 * Only the ink changes.
 *
 * No outline stacks and no fills beyond one flat colour: the game layers outlines to hold a
 * constant edge over painted artwork (see the Contrast note in ../stimuli.js), which a flat
 * mid-grey backdrop makes unnecessary. A single fill also means the drawn extent *is* the geometry,
 * with no outline spill past it.
 *
 * Level 5 needs nothing here: its Ebbinghaus figures are already plain discs drawn with
 * `DoggoNogoStimuli.drawBall`, so the plain variant only restyles their fills.
 */

export const DoggoNogoPlainStimuli = {
    /**
     * A straight segment — the plain counterpart of the bone (Levels 1 and 3).
     *
     * `length` is the tip-to-tip extent including the round caps, matching `drawBone`'s convention,
     * so a plain segment and a bone built from the same `length` cover the same span.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX
     * @param {number} opts.centerY
     * @param {number} opts.length     tip-to-tip extent, in canvas px
     * @param {number} opts.thickness  stroke width, in canvas px
     * @param {number} [opts.angle]    rotation in radians (0 = lying along +x)
     * @param {string} opts.fill
     */
    drawSegment: function (ctx, opts) {
        const thickness = Math.max(1, opts.thickness)
        // Round caps extend half a thickness past each endpoint, so the drawn tips land on
        // +-length/2 only if the line itself stops short of them by that much.
        const half = Math.max(0.5, (opts.length - thickness) / 2)
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)
        ctx.lineCap = "round"
        ctx.lineWidth = thickness
        ctx.strokeStyle = opts.fill
        ctx.beginPath()
        ctx.moveTo(-half, 0)
        ctx.lineTo(half, 0)
        ctx.stroke()
        ctx.restore()
    },

    /**
     * An arrow — the plain counterpart of the fishbone (Level 2).
     *
     * Direction is the only thing that carries the response, exactly as the fishbone's nose does:
     * `+1` points right, `-1` points left, mirrored about the shape's own centre so the two
     * directions are exact reflections (the reason level2.js mirrors its geometry rather than its
     * bounding box). The shape occupies exactly `length` x `height` centred on the origin.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX
     * @param {number} opts.centerY
     * @param {number} opts.length      nose-to-tail extent, in canvas px
     * @param {number} opts.height      full vertical extent (set by the head), in canvas px
     * @param {number} [opts.direction] +1 points right, -1 points left
     * @param {string} opts.fill
     */
    drawArrow: function (ctx, opts) {
        const length = Math.max(2, opts.length)
        const height = Math.max(2, opts.height)
        const halfL = length / 2
        const halfH = height / 2
        const headLength = length * 0.38
        const shaftHalf = height * 0.16 // shaft is ~32% of the full height, so the head reads as the head
        const headBase = halfL - headLength

        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        if (opts.direction === -1) ctx.scale(-1, 1)
        ctx.fillStyle = opts.fill
        ctx.beginPath()
        ctx.moveTo(-halfL, -shaftHalf)
        ctx.lineTo(headBase, -shaftHalf)
        ctx.lineTo(headBase, -halfH)
        ctx.lineTo(halfL, 0)
        ctx.lineTo(headBase, halfH)
        ctx.lineTo(headBase, shaftHalf)
        ctx.lineTo(-halfL, shaftHalf)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
    },

    /**
     * A canonical Müller-Lyer figure — the plain counterpart of the tied sausage (Level 4).
     *
     * `finAngleDeg` keeps level4.js's convention exactly: the angle of each fin away from the
     * shaft's own axis, 90 deg being perpendicular (illusion-neutral). Below 90 the fins splay
     * forward past the endpoint and the shaft looks longer; above 90 they fold back over it and it
     * looks shorter. The fin direction at end `sx` and side `sy` is therefore
     * `(sx*cos(theta), sy*sin(theta))`, which is what `drawSausage` computes the long way round
     * (`atan2(sin(sy*theta), sx*cos(sy*theta))`) when it roots the strings at the knots.
     *
     * The one geometric departure from the game: the fins are rooted at the shaft's endpoints
     * rather than at the sausage's knots, which sit a little inside the tips. The compared
     * dimension — `length`, tip to tip — is identical either way.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX
     * @param {number} opts.centerY
     * @param {number} opts.length       shaft extent, tip to tip, in canvas px
     * @param {number} opts.thickness    stroke width, in canvas px
     * @param {number} opts.finAngleDeg  fin angle away from the shaft axis; 90 = neutral
     * @param {number} opts.finLength    fin length from the endpoint, in canvas px
     * @param {string} opts.fill
     */
    drawMullerLyer: function (ctx, opts) {
        const thickness = Math.max(1, opts.thickness)
        const half = Math.max(0.5, opts.length / 2)
        const theta = ((opts.finAngleDeg ?? 90) * Math.PI) / 180
        const fx = Math.cos(theta) * opts.finLength
        const fy = Math.sin(theta) * opts.finLength

        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        // Butt caps on the shaft so its painted extent is exactly `length`; the fins are joined at
        // the same point, so nothing spills past the tips except the fins themselves.
        ctx.lineCap = "butt"
        ctx.lineJoin = "round"
        ctx.lineWidth = thickness
        ctx.strokeStyle = opts.fill
        ctx.beginPath()
        ctx.moveTo(-half, 0)
        ctx.lineTo(half, 0)
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                ctx.moveTo(sx * half, 0)
                ctx.lineTo(sx * half + sx * fx, sy * fy)
            }
        }
        ctx.stroke()
        ctx.restore()
    },
}
