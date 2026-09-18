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
     */
    drawBone: function (ctx, opts) {
        const thickness = opts.thickness
        // Below two lobe radii there is no shaft left and the shape stops being a bone.
        const length = Math.max(opts.length, thickness * 2.4)
        const outlines = opts.outlines || (opts.outline && opts.outlineWidth > 0 ? [{ color: opts.outline, width: opts.outlineWidth }] : [])
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)
        paintShape(ctx, [(c) => this.bonePath(c, length, thickness)], { outlines, fill: opts.fill })
        ctx.restore()
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
    // Sausage (Level 4, Müller-Lyer)
    // -----------------------------------------------------------------------

    /**
     * Landmarks of a tied sausage along its long axis, centred on the origin, in the units given.
     *
     * Both ends are built the same way, from the body outward: the body pinches into a narrow
     * casing neck, a string is knotted around that neck, and the twisted casing stub shows beyond
     * the knot. `length` is the full tip-to-tip extent (stub end to stub end), so the number a
     * level logs is the extent on screen, as for `drawBone`. The body is therefore
     * `length - 2 * 0.64 * thickness`, and the knot centre — where the string's loose ends leave,
     * i.e. the Müller-Lyer vertex — sits `0.46 * thickness` inside each tip. Neck, knot and stub
     * are fixed multiples of the thickness, so two sausages of different length differ in body
     * only, and the stubs add the same extent to each.
     */
    sausageGeometry: function (length, thickness) {
        const t = thickness
        // Below ~1.2 thicknesses of body the shape stops being a sausage; clamp there.
        const halfBody = Math.max(0.6 * t, length / 2 - 0.64 * t)
        return {
            halfBody,
            neckStart: halfBody,
            neckEnd: halfBody + 0.36 * t,
            knotX: halfBody + 0.18 * t,
            stubStart: halfBody + 0.36 * t,
            stubEnd: Math.max(halfBody + 0.36 * t, length / 2),
        }
    },

    /**
     * Traces the sausage body and its two casing necks into the current path: a capsule plus one
     * rectangle per neck, all wound the same way so a fill renders their union without seams.
     */
    sausagePath: function (ctx, length, thickness) {
        const t = thickness
        const g = this.sausageGeometry(length, t)
        ctx.beginPath()
        ctx.roundRect(-g.halfBody, -t / 2, 2 * g.halfBody, t, t / 2)
        for (const sx of [-1, 1]) {
            // The neck overlaps the body cap and the stub by a hair, so no gap opens at either join.
            const x0 = sx > 0 ? g.neckStart - 0.02 * t : -(g.neckEnd + 0.02 * t)
            ctx.rect(x0, -0.14 * t, g.neckEnd - g.neckStart + 0.04 * t, 0.28 * t)
        }
    },

    /**
     * Traces one twisted casing stub in a local frame whose origin is the stub's root and whose +x
     * points outward: a tapering tail with a slight waist, ending in a small lump.
     */
    sausageStubPath: function (ctx, stubLength, thickness) {
        const t = thickness
        const l = stubLength
        ctx.beginPath()
        ctx.moveTo(0, -0.13 * t)
        ctx.lineTo(l * 0.55, -0.09 * t)
        ctx.lineTo(l * 0.75, -0.13 * t)
        ctx.lineTo(l, -0.06 * t)
        ctx.lineTo(l, 0.06 * t)
        ctx.lineTo(l * 0.75, 0.13 * t)
        ctx.lineTo(l * 0.55, 0.09 * t)
        ctx.lineTo(0, 0.13 * t)
        ctx.closePath()
    },

    /**
     * Draws one tied sausage: the Müller-Lyer stimulus.
     *
     * The string knotted around each neck has two loose ends, and those ends are the illusion's
     * fins. `string.angle` is the angle between each loose end and the *outward* direction of the
     * long axis, so it reads directly as the illusion parameter:
     *  - angle < 90° splays the ends out past the tip (the "tail" figure — the sausage is
     *    perceived as longer);
     *  - angle = 90° leaves them perpendicular (no length distortion);
     *  - angle > 90° folds them back over the body (the "arrowhead" figure — perceived shorter).
     * The ends are drawn dead straight on purpose: a curve gives the eye several angles at once.
     *
     * Layering, back to front: string ends (behind everything, so the body's silhouette — the
     * extent being judged — stays intact), casing stubs, body with its outline, then the shading
     * clipped to the body, then the knots over the necks. The shade band, bloom veil and highlight
     * all end a fixed distance inside the body's caps, so none of them offers a second endpoint to
     * compare; there is no speckle or other lengthwise texture for the same reason (see the file
     * header).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} opts
     * @param {number} opts.centerX      centre of the sausage, in canvas px
     * @param {number} opts.centerY
     * @param {number} opts.length       tip-to-tip extent (stub end to stub end), in canvas px
     * @param {number} opts.thickness    body height, in canvas px
     * @param {number} [opts.angle]      rotation in radians (0 = lying along +x)
     * @param {string} opts.fill         body colour
     * @param {string} [opts.shade]      darker band along the lower half of the body
     * @param {string} [opts.highlight]  lighter stripe along the upper body
     * @param {string} [opts.bloom]      translucent veil over the upper body (a cured sausage's flour)
     * @param {string} [opts.casingFill] colour of the twisted casing stubs
     * @param {Array<{color: string, width: number}>} [opts.outlines]  outermost first; see `paintShape`
     * @param {object} opts.string       { angle (radians from the outward long axis), length (px),
     *                                     fill, dark (thread shadow / knot crease colour) }
     */
    drawSausage: function (ctx, opts) {
        const t = opts.thickness
        const length = Math.max(opts.length, 2.48 * t)
        const g = this.sausageGeometry(length, t)
        const outlines = opts.outlines || []
        const str = opts.string
        ctx.save()
        ctx.translate(opts.centerX, opts.centerY)
        ctx.rotate(opts.angle || 0)

        // 1. Loose string ends, rooted at each knot centre, behind everything.
        if (str && str.length > 0) {
            for (const sx of [-1, 1]) {
                for (const sy of [-1, 1]) {
                    const a = sy * str.angle
                    ctx.save()
                    ctx.translate(sx * g.knotX, 0)
                    ctx.rotate(Math.atan2(Math.sin(a), sx * Math.cos(a)))
                    if (sx * sy < 0) ctx.scale(1, -1)
                    this.drawStringEnd(ctx, str.length, t, str, outlines)
                    ctx.restore()
                }
            }
        }

        // 2. Casing stubs beyond the knots.
        const stubLength = g.stubEnd - g.stubStart
        if (stubLength > 0) {
            for (const sx of [-1, 1]) {
                ctx.save()
                ctx.translate(sx * g.stubStart, 0)
                if (sx < 0) ctx.scale(-1, 1)
                paintShape(ctx, [(c) => this.sausageStubPath(c, stubLength, t)], { outlines, fill: opts.casingFill || "#f0d7c3" })
                // two creases where the casing is twisted
                ctx.strokeStyle = "rgba(120,70,50,0.45)"
                ctx.lineWidth = 0.025 * t
                ctx.beginPath()
                for (const u of [0.25, 0.45]) {
                    ctx.moveTo(stubLength * u, -0.08 * t)
                    ctx.lineTo(stubLength * (u + 0.1), 0.08 * t)
                }
                ctx.stroke()
                ctx.restore()
            }
        }

        // 3. Body (+ necks) with its outline, then shading clipped to it.
        paintShape(ctx, [(c) => this.sausagePath(c, length, t)], { outlines, fill: opts.fill })
        ctx.save()
        this.sausagePath(ctx, length, t)
        ctx.clip()
        const hb = g.halfBody
        if (opts.shade) {
            ctx.fillStyle = opts.shade
            ctx.beginPath()
            ctx.roundRect(-hb, 0.18 * t, 2 * hb, t, t / 2)
            ctx.fill()
        }
        if (opts.bloom) {
            ctx.fillStyle = opts.bloom
            ctx.beginPath()
            ctx.roundRect(-hb, -t / 2, 2 * hb, 0.78 * t, t / 2)
            ctx.fill()
        }
        if (opts.highlight) {
            ctx.fillStyle = opts.highlight
            ctx.beginPath()
            ctx.roundRect(-hb + 0.3 * t, -0.36 * t, 2 * hb - 0.6 * t, 0.16 * t, 0.08 * t)
            ctx.fill()
        }
        ctx.restore()

        // 4. Knots over the necks: two wraps of string plus the lump where the ends leave.
        if (str) {
            const ink = outlines.length ? outlines[outlines.length - 1] : null
            const knotOutlines = ink ? [{ color: ink.color, width: ink.width * 0.5 }] : []
            for (const sx of [-1, 1]) {
                const kx = sx * g.knotX
                paintShape(
                    ctx,
                    [
                        (c) => {
                            c.beginPath()
                            c.roundRect(kx - 0.15 * t, -0.28 * t, 0.3 * t, 0.56 * t, 0.07 * t)
                        },
                    ],
                    { outlines: knotOutlines, fill: str.fill },
                )
                ctx.strokeStyle = str.dark || str.fill
                ctx.lineWidth = 0.035 * t
                ctx.beginPath()
                ctx.moveTo(kx, -0.26 * t)
                ctx.lineTo(kx, 0.26 * t)
                ctx.stroke()
                paintShape(
                    ctx,
                    [
                        (c) => {
                            c.beginPath()
                            c.arc(kx, 0, 0.15 * t, 0, Math.PI * 2)
                        },
                    ],
                    { outlines: knotOutlines, fill: str.fill },
                )
                ctx.fillStyle = str.dark || str.fill
                ctx.beginPath()
                ctx.arc(kx - 0.03 * t, -0.03 * t, 0.05 * t, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        ctx.restore()
    },

    /**
     * One loose end of string in a local frame: origin at the knot, +x along the string. A
     * straight, slightly tapered strand with a thread texture and a three-strand frayed tip.
     * The tip's little fan is far from the vertex and identical on every end.
     */
    drawStringEnd: function (ctx, stringLength, thickness, string, outlines) {
        const t = thickness
        const l = stringLength
        const body = l * 0.9
        const ink = outlines.length ? outlines[outlines.length - 1] : null
        const strandOutlines = ink ? [{ color: ink.color, width: ink.width * 0.65 }] : []
        paintShape(
            ctx,
            [
                (c) => {
                    c.beginPath()
                    c.moveTo(0, -0.09 * t)
                    c.lineTo(body, -0.07 * t)
                    c.lineTo(body, 0.07 * t)
                    c.lineTo(0, 0.09 * t)
                    c.closePath()
                },
            ],
            { outlines: strandOutlines, fill: string.fill },
        )
        // thread texture: short diagonal ticks along the strand
        ctx.strokeStyle = string.dark || string.fill
        ctx.lineWidth = 0.025 * t
        ctx.lineCap = "round"
        ctx.beginPath()
        for (let i = 1; i < 9; i++) {
            const x = (body * i) / 9
            ctx.moveTo(x - 0.05 * t, -0.06 * t)
            ctx.lineTo(x + 0.05 * t, 0.06 * t)
        }
        ctx.stroke()
        // frayed tip: three short strands fanning from the end
        const fan = (c) => {
            c.beginPath()
            for (const a of [-0.4, 0, 0.4]) {
                c.moveTo(l * 0.88, 0)
                c.lineTo(l * 0.88 + Math.cos(a) * 0.12 * l, Math.sin(a) * 0.12 * l)
            }
        }
        if (ink) {
            ctx.strokeStyle = ink.color
            ctx.lineWidth = 0.11 * t
            fan(ctx)
            ctx.stroke()
        }
        ctx.strokeStyle = string.fill
        ctx.lineWidth = 0.05 * t
        fan(ctx)
        ctx.stroke()
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
