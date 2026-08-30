/**
 * @file Procedurally drawn stimuli.
 *
 * Level 3 asks which of two bones is longer, so the stimulus has to be resizable along one axis
 * only. A sprite cannot do that: scaling the PNG deforms the end lobes (their aspect ratio then
 * *is* the length), and stretching a middle slice smears whatever lengthwise texture the artwork
 * carries. Drawing the shape in code removes the problem instead of working around it — thickness
 * and end caps are constants of the drawing, and length is a free parameter.
 *
 * Three properties matter for the measurement, and all three are true by construction here:
 *
 *  - `length` is the exact tip-to-tip extent. The end lobes sit at +-(length/2 - r) with radius r,
 *    so the extremes land on +-length/2 and the number logged in the data is the geometric quantity
 *    that was on screen — not an approximation of a bitmap's bounding box.
 *  - Thickness, lobe radius and outline weight never vary with length, so no cue except extent
 *    distinguishes a long bone from a short one.
 *  - The shaft is a flat fill with no lengthwise detail, so there is nothing to stretch, tile or
 *    count. Rotation is applied to the geometry rather than to a finished bitmap, which keeps edges
 *    clean at every angle instead of resampling a grid.
 */

export const DoggoNogoStimuli = {
    /**
     * Traces a cartoon bone into the current path, centred on the origin and lying along +x.
     *
     * One compound path (shaft rectangle plus four lobe circles), all wound the same way, so a
     * nonzero fill renders their union with no internal seams. `thickness` is the shaft's width;
     * the lobes make the ends about twice that tall.
     */
    bonePath: function (ctx, length, thickness) {
        const lobeRadius = thickness * 0.58
        const lobeOffsetY = thickness * 0.42
        const lobeCenterX = length / 2 - lobeRadius
        ctx.beginPath()
        ctx.rect(-lobeCenterX, -thickness / 2, 2 * lobeCenterX, thickness)
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                // moveTo before each arc, or the path connects lobes with a stray chord.
                ctx.moveTo(sx * lobeCenterX + lobeRadius, sy * lobeOffsetY)
                ctx.arc(sx * lobeCenterX, sy * lobeOffsetY, lobeRadius, 0, Math.PI * 2)
            }
        }
    },

    /**
     * Draws one bone.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX      centre of the bone, in canvas px
     * @param {number} opts.centerY
     * @param {number} opts.length       tip-to-tip extent, in canvas px
     * @param {number} opts.thickness    shaft width, in canvas px
     * @param {number} opts.angle        rotation in radians (0 = lying along +x)
     * @param {string} opts.fill
     * @param {string} [opts.outline]    omit for no outline
     * @param {number} [opts.outlineWidth]
     */
    drawBone: function (ctx, opts) {
        const thickness = opts.thickness
        // Below two lobe radii there is no shaft left and the shape stops being a bone.
        const length = Math.max(opts.length, thickness * 2.4)
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        if (opts.outline && opts.outlineWidth > 0) {
            // Stroke the whole compound path first and fill over it: the fill hides the strokes
            // that fall on interior edges, leaving a clean outline around the union only.
            ctx.strokeStyle = opts.outline
            ctx.lineWidth = opts.outlineWidth * 2
            this.bonePath(ctx, length, thickness)
            ctx.stroke()
        }
        this.bonePath(ctx, length, thickness)
        ctx.fillStyle = opts.fill
        ctx.fill()
        ctx.restore()
    },
}
