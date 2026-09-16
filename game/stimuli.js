/**
 * @file Procedurally drawn stimuli.
 *
 * Every task stimulus in the game is traced in code rather than blitted from a PNG. The reason is
 * measurement control, not file size: a sprite ties the stimulus to whatever the artwork happens to
 * be, and the properties that matter for a reaction-time task are then only approximately known.
 * Drawing in code makes each of them an explicit parameter.
 *
 * What the sprites cost us, concretely, and what these functions fix:
 *
 *  - **Extent.** A sprite's nominal size is its bounding box, most of which is usually transparent
 *    (Level 1's old bone filled 20% of its box; Level 2's fishbone filled 62% of its box height, so
 *    the same `stimulusHeight` meant different physical sizes in the two levels). Two helpers replace
 *    that guesswork, depending on whether the stimulus turns. `fishboneBox` makes the drawn shape
 *    fill its box exactly, so the logged rectangle and the visible stimulus are one rectangle.
 *    `boneEnvelope` instead gives the square that holds the bone at *any* rotation, for a level that
 *    varies orientation — there the box is a placement envelope and the geometry is logged directly.
 *  - **Contrast.** A cream bone dropped at a random position over painted artwork met local
 *    background luminance anywhere from 0.01 to 0.79, i.e. Michelson contrast from 0.95 down to
 *    0.22, with the polarity reversing on bright patches. Detection latency follows contrast
 *    (Piéron), so that variation lands directly in the RT. Layered outlines (see `outlines` below)
 *    put a fixed luminance and hue immediately around the shape, so the edge the visual system
 *    actually detects is the same on every trial regardless of what is behind it.
 *  - **Redundant cues.** Level 2's two fishbone PNGs differed only in hue, and hue was pinned to
 *    the required response for a whole session — so "cyan means LEFT" was learnable without ever
 *    reading which way the fish pointed. Colour is a parameter here, which lets the level either
 *    drop it or vary it orthogonally to the response.
 *  - **Free parameters.** Level 3 manipulates length, which no sprite can do: scaling deforms the
 *    end lobes (their aspect ratio then *is* the length) and stretching a middle slice smears any
 *    lengthwise texture.
 *
 * Cost of drawing rather than blitting, measured (median of 7x20k reps, 1280x720 canvas): a sprite
 * `drawImage` is ~2.3us, a layered procedural bone ~20-50us. A 60Hz frame is 16667us, so the
 * expensive case is ~0.3% of one frame for one stimulus. If a future stimulus ever needs something
 * genuinely costly (`shadowBlur`, many gradient stops), render it once into an offscreen canvas and
 * blit that — the pattern `DoggoNogoUI`'s text-sprite cache already uses — which measures ~1.4us.
 */

/**
 * Applies a stack of outlines and then a fill to a compound shape.
 *
 * `traces` is a list of functions that each trace one subpath into the context. They are re-run for
 * every pass, because a stroke and a fill cannot share a path object here.
 *
 * Outlines are drawn outermost first. Each pass strokes at `width * 2` centred on the path, so it
 * extends `width` beyond the shape; a later, narrower pass paints over the inner part of the
 * previous one, leaving a ring of the difference. The fill then covers everything inside the shape,
 * hiding the strokes that fell on interior edges. So `outlines: [{red, 3}, {black, 1}]` reads
 * outward from the shape as: fill, 1px black, 2px red.
 */
function paintShape(ctx, traces, opts) {
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    for (const layer of opts.outlines || []) {
        if (!layer || !layer.color || !(layer.width > 0)) continue
        ctx.strokeStyle = layer.color
        ctx.lineWidth = layer.width * 2
        for (const trace of traces) {
            trace(ctx)
            ctx.stroke()
        }
    }
    if (!opts.fill) return
    ctx.fillStyle = opts.fill
    for (const trace of traces) {
        trace(ctx)
        ctx.fill()
    }
}

/** Widest outline in a stack, i.e. how far the painted shape spills past its geometry. */
function outlineSpill(outlines) {
    return (outlines || []).reduce((m, l) => (l && l.width > m ? l.width : m), 0)
}

export const DoggoNogoStimuli = {
    // -----------------------------------------------------------------------
    // Bone (Levels 1 and 3)
    // -----------------------------------------------------------------------

    /**
     * Traces a cartoon bone into the current path, centred on the origin and lying along +x.
     *
     * One compound path (shaft rectangle plus four lobe circles), all wound the same way, so a
     * nonzero fill renders their union with no internal seams. `thickness` is the shaft's width;
     * the lobes put the full height at exactly `2 * thickness` (lobe offset 0.42 + radius 0.58 = 1),
     * which is what lets `boneEnvelope` below be solved in closed form.
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
     * Geometry is given tip-to-tip, so the number a level logs is the quantity that was on screen.
     * Thickness, lobe radius and outline weights are independent of `length`, so nothing except
     * extent distinguishes a long bone from a short one, and the shaft is a flat fill with no
     * lengthwise detail to stretch, tile or count. Rotation is applied to the geometry rather than
     * to a finished bitmap, so edges stay clean at every angle.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX      centre of the bone, in canvas px
     * @param {number} opts.centerY
     * @param {number} opts.length       tip-to-tip extent, in canvas px
     * @param {number} opts.thickness    shaft width, in canvas px (full height is 2x this)
     * @param {number} [opts.angle]      rotation in radians (0 = lying along +x)
     * @param {string} opts.fill
     * @param {Array<{color: string, width: number}>} [opts.outlines]  outermost first; see `paintShape`
     * @param {string} [opts.outline]        single-outline shorthand
     * @param {number} [opts.outlineWidth]
     * @param {object} [opts.fins]       Müller-Lyer ribbon (see `finsPath`/`finBandsPath`), all px:
     *                                   { angle (radians from the outward long axis), length,
     *                                     thickness, inset (band centre's distance in from each
     *                                     tip), bandWidth, bandHeight, fill }
     */
    drawBone: function (ctx, opts) {
        const thickness = opts.thickness
        // Below two lobe radii there is no shaft left and the shape stops being a bone.
        const length = Math.max(opts.length, thickness * 2.4)
        const outlines = opts.outlines || (opts.outline && opts.outlineWidth > 0 ? [{ color: opts.outline, width: opts.outlineWidth }] : [])
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)
        // Ribbon sandwich: blades BEHIND the bone (its silhouette — the extent being judged —
        // stays intact), then the bone, then the bands OVER it, so band + blades read as one
        // ribbon tied around the bone. Everything shares the bone's rotated frame, so the fin
        // angle is always relative to the bone's own long axis.
        const fins = opts.fins
        if (fins && fins.length > 0) {
            paintShape(ctx, [(c) => this.finsPath(c, length, fins)], { fill: fins.fill })
        }
        paintShape(ctx, [(c) => this.bonePath(c, length, thickness)], { outlines, fill: opts.fill })
        if (fins && fins.length > 0) {
            paintShape(ctx, [(c) => this.finBandsPath(c, length, fins)], { fill: fins.fill })
        }
        ctx.restore()
    },

    /**
     * X-coordinates of the two ribbon-band centres of a ribboned bone (see `drawBone`'s `fins`).
     * The bands sit `inset` inside each tip, on the shaft, and are the blades' origin, so band
     * and blades read as one ribbon tied around the bone.
     */
    finRootXs: function (boneLength, inset) {
        return [-1, 1].map((sx) => sx * (boneLength / 2 - inset))
    },

    /**
     * Traces the four Müller-Lyer blades of a ribboned bone into one compound path.
     *
     * Two blades per side, symmetric about the long axis, each rooted at its ribbon band (NOT at
     * the bone tip — blades floating off the tips read as detached). `fins.angle` is the angle
     * between each blade and the *outward* direction of the long axis, so it reads directly as
     * the illusion parameter:
     *  - angle < 90° sweeps the blades out past the tip (the classic "tail" figure — the bone
     *    is perceived as longer);
     *  - angle = 90° leaves them perpendicular (a ribbon with no length distortion);
     *  - angle > 90° folds them back over the shaft (the "arrowhead" figure — perceived shorter).
     *
     * Each blade is a plain rectangle; rounded lineJoin in `paintShape` softens the corners.
     */
    finsPath: function (ctx, boneLength, fins) {
        const hw = fins.thickness / 2
        ctx.beginPath()
        for (const rootX of this.finRootXs(boneLength, fins.inset)) {
            const sx = Math.sign(rootX) || 1
            for (const sy of [-1, 1]) {
                const a = sy * fins.angle
                // Outward along the long axis for this side, rotated by the fin angle.
                const dirX = sx * Math.cos(a)
                const dirY = Math.sin(a)
                const nx = -dirY
                const ny = dirX
                ctx.moveTo(rootX + nx * hw, ny * hw)
                ctx.lineTo(rootX + dirX * fins.length + nx * hw, dirY * fins.length + ny * hw)
                ctx.lineTo(rootX + dirX * fins.length - nx * hw, dirY * fins.length - ny * hw)
                ctx.lineTo(rootX - nx * hw, -ny * hw)
                ctx.closePath()
            }
        }
    },

    /** Traces the two ribbon bands (upright rectangles wrapped around the shaft) into one path. */
    finBandsPath: function (ctx, boneLength, fins) {
        ctx.beginPath()
        for (const rootX of this.finRootXs(boneLength, fins.inset)) {
            ctx.rect(rootX - fins.bandWidth / 2, -fins.bandHeight / 2, fins.bandWidth, fins.bandHeight)
        }
    },

    /**
     * Side of the smallest square that contains the bone at *any* rotation, outlines included.
     *
     * Not simply `length + 2 * spill`: the end lobes sit off the long axis, so as the bone turns the
     * point that reaches furthest is a lobe rim at `hypot(lobeCenterX, lobeOffsetY) + lobeRadius`,
     * which peaks a few degrees off the axis rather than on it. A level that rotates its bone and
     * sizes the placement box by length alone will clip it against the canvas edge.
     *
     * Units are whatever `length`/`thickness`/`outlines` are given in, so canvas-height fractions in
     * and a canvas-height fraction out.
     */
    boneEnvelope: function (length, thickness, outlines) {
        const lobeRadius = thickness * 0.58
        const lobeOffsetY = thickness * 0.42
        const lobeCenterX = Math.max(0, length / 2 - lobeRadius)
        return 2 * (Math.hypot(lobeCenterX, lobeOffsetY) + lobeRadius + outlineSpill(outlines))
    },

    // -----------------------------------------------------------------------
    // Ball (Level 3, Ebbinghaus placeholder)
    // -----------------------------------------------------------------------

    /**
     * Draws one plain disc ("ball"). Geometry is given as tip-to-tip diameter so the logged number
     * is the on-screen extent, mirroring `drawBone`'s length convention. Placeholder target for the
     * Ebbinghaus phase — the surrounding context discs that create the illusion come later, drawn
     * as more calls to this same function.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX
     * @param {number} opts.centerY
     * @param {number} opts.diameter     full extent, in canvas px
     * @param {string} opts.fill
     * @param {Array<{color: string, width: number}>} [opts.outlines]  outermost first
     * @param {string} [opts.outline]        single-outline shorthand
     * @param {number} [opts.outlineWidth]
     */
    drawBall: function (ctx, opts) {
        const r = Math.max(0.5, opts.diameter / 2)
        const outlines = opts.outlines || (opts.outline && opts.outlineWidth > 0 ? [{ color: opts.outline, width: opts.outlineWidth }] : [])
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        paintShape(
            ctx,
            [
                (c) => {
                    c.beginPath()
                    c.arc(0, 0, r, 0, Math.PI * 2)
                },
            ],
            { outlines, fill: opts.fill },
        )
        ctx.restore()
    },

    // -----------------------------------------------------------------------
    // Fishbone (Level 2)
    // -----------------------------------------------------------------------

    /**
     * Traces a fishbone as a list of subpaths: head, forked tail, spine, and swept ribs.
     *
     * Returned as separate traces rather than one compound path because the ribs must not be joined
     * to each other by the fill, and because `paintShape` needs to stroke each piece to get the
     * halo to run around every rib individually — which is what makes the shape legible at the ~70px
     * on-screen size the game actually uses.
     *
     * The shape occupies exactly `length` x `height` centred on the origin, and points along +x:
     * the nose is at +length/2 and the tail tips at -length/2. Getting that sense right matters,
     * because Level 2 scores the response against which way the fish points -- an inverted base
     * orientation would mark every correct answer wrong.
     *
     * The tail lobes are the tallest part, so they set the vertical extent; head and ribs are
     * deliberately shorter.
     */
    fishbonePath: function (length, height) {
        const L = length
        const halfH = height / 2
        const noseX = L * 0.5
        const headBackX = L * 0.10
        const tailRootX = -L * 0.28
        const tailTipX = -L * 0.5
        const traces = []

        // Head: a rounded leaf. A soft point at the nose, swelling to its widest a little
        // behind that, then easing back to a straight edge where the ribs start. Rounder than
        // the arrowhead it replaced, but the bulk still sits forward of the spine, which is
        // what makes the direction read - the silhouette is front-heavy either way.
        traces.push((c) => {
            c.beginPath()
            c.moveTo(noseX, 0)
            c.bezierCurveTo(noseX - L * 0.09, -halfH * 0.24, noseX - L * 0.18, -halfH * 0.96, headBackX, -halfH * 0.82)
            c.lineTo(headBackX, halfH * 0.82)
            c.bezierCurveTo(noseX - L * 0.18, halfH * 0.96, noseX - L * 0.09, halfH * 0.24, noseX, 0)
            c.closePath()
        })

        // Tail: a caudal fin - one solid fan flaring from the spine, with a shallow notch in
        // the trailing edge. The previous version forked almost to the spine, which left two
        // thin lobes that closed up into a smudge at the ~70px the game draws this at; keeping
        // the notch shallow and the fin solid is what survives that size.
        traces.push((c) => {
            c.beginPath()
            c.moveTo(tailRootX, 0)
            c.quadraticCurveTo(tailRootX - L * 0.09, -halfH * 0.40, tailTipX, -halfH)
            c.quadraticCurveTo(tailTipX + L * 0.045, -halfH * 0.45, tailTipX + L * 0.085, 0)
            c.quadraticCurveTo(tailTipX + L * 0.045, halfH * 0.45, tailTipX, halfH)
            c.quadraticCurveTo(tailRootX - L * 0.09, halfH * 0.40, tailRootX, 0)
            c.closePath()
        })

        // Spine.
        traces.push((c) => {
            c.beginPath()
            c.rect(tailRootX - L * 0.02, -halfH * 0.09, headBackX - tailRootX + L * 0.03, halfH * 0.18)
        })

        // Ribs: symmetric pairs, marching from the head back toward the tail and shortening.
        //
        // Three ribs on a four-slot grid, with the front slot left empty. Dropping the front rib
        // rather than respacing three ribs across the whole span keeps the spacing that reads at
        // the on-screen size, and opens a gap immediately behind the head so the head reads as a
        // head instead of running straight into the ribcage.
        const ribSlots = 4
        for (let i = 1; i < ribSlots; i++) {
            const t = i / (ribSlots - 1)
            const x = headBackX - L * 0.035 - t * (headBackX - tailRootX - L * 0.07)
            const ribH = halfH * (0.80 - 0.18 * t)
            const w = L * 0.022
            for (const sy of [-1, 1]) {
                traces.push((c) => {
                    c.beginPath()
                    c.moveTo(x + w, sy * halfH * 0.06)
                    c.quadraticCurveTo(x + L * 0.05, sy * ribH, x - L * 0.008, sy * ribH)
                    c.quadraticCurveTo(x + L * 0.014, sy * ribH * 0.5, x - w, sy * halfH * 0.06)
                    c.closePath()
                })
            }
        }
        return traces
    },

    /**
     * Draws one fishbone.
     *
     * `direction` is +1 for nose-to-the-right and -1 for nose-to-the-left. It mirrors the geometry
     * about the shape's own centre, so the two directions are exact reflections of each other — the
     * old sprites were mirrored about their bounding box instead, and their ink was offset by a
     * pixel inside it, which made the two directions land in slightly different places.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX
     * @param {number} opts.centerY
     * @param {number} opts.length       nose-to-tail extent, in canvas px
     * @param {number} opts.height       full vertical extent (set by the tail lobes), in canvas px
     * @param {number} [opts.direction]  +1 points right, -1 points left
     * @param {number} [opts.angle]      rotation in radians
     * @param {string} opts.fill
     * @param {Array<{color: string, width: number}>} [opts.outlines]  outermost first
     * @param {string} [opts.eyeColor]   omit to leave the eye out; sits in the wide part of the head
     */
    drawFishbone: function (ctx, opts) {
        const length = Math.max(opts.length, 1)
        const height = Math.max(opts.height, 1)
        const traces = this.fishbonePath(length, height)
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)
        if (opts.direction === -1) ctx.scale(-1, 1)
        paintShape(ctx, traces, { outlines: opts.outlines, fill: opts.fill })
        if (opts.eyeColor) {
            ctx.beginPath()
            ctx.arc(length * 0.30, -height * 0.14, Math.max(1, length * 0.021), 0, Math.PI * 2)
            ctx.fillStyle = opts.eyeColor
            ctx.fill()
        }
        ctx.restore()
    },

    /** Makes the drawn fishbone fill its logged box exactly; see the Extent note in the header. */
    fishboneBox: function (boxHeight, aspect, outlines) {
        const spill = outlineSpill(outlines)
        return {
            aspect,
            width: boxHeight * aspect,
            height: boxHeight,
            length: Math.max(1, boxHeight * aspect - 2 * spill),
            innerHeight: Math.max(1, boxHeight - 2 * spill),
        }
    },
}
