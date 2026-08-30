"""Generates copy-paste-ready AI image prompts for DoggoNogo's assets.

These are *regeneration* prompts: every asset listed here already exists in
`game/assets/`, and each prompt is written to reproduce the look of the file
that is there today. So the workflow is image-conditioned, not text-only -
feed the current PNG in as a reference and the prompt as the instruction.

Why a script instead of a static prompts.md: the same asset can be described
in more than one art direction, and each direction is shared by a handful of
assets. Keeping the subject ("what is in the picture"), the render ("how it is
drawn") and the output spec ("canvas, framing, alpha") in three separate
layers means a style tweak regenerates every affected prompt at once, and a
whole new look is seven paragraphs rather than N hand-edited near-duplicates.

Art directions live in STYLES (see below) and are selected with `--style` or by
editing ART_DIRECTION. Each writes its own `prompts/prompts_<direction>.md`,
with one section per level and, inside each level, one subsection per kind of
asset (backgrounds, sprites, stimuli, feedback bubbles).

Usage:
    python prompts/make_prompts.py                 # (re)write the default direction
    python prompts/make_prompts.py --style retrogaming
    python prompts/make_prompts.py --only 1        # one group only (repeatable)
    python prompts/make_prompts.py -o some/where.md
    python prompts/make_prompts.py --print         # stdout instead of a file

Running the file in a Jupyter / VS Code interactive window works too: the
kernel's own argv is ignored, so it just writes the default file. To narrow it
down there, call the functions directly instead of passing flags:

    main(["--only", "1"])
    print(render_markdown(["1"]))
"""

import argparse
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# The prompt for one asset is built from three parts:
#
#   subject  (per asset, in ASSETS below)  what is in the picture
#   render   (per art direction, STYLES)   how it is drawn
#   output   (per role, SPECS)             canvas, framing, alpha
#
# The split matters because the middle layer is the only one that changes when
# the game's look changes. SPECS holds facts the engine imposes - a sprite is
# 682x682 with the paws on the bottom edge whatever medium it is drawn in - so
# a new art direction never has to restate them, and cannot quietly contradict
# them. Adding a direction means writing seven "render" paragraphs and nothing
# else.
#
# Roles are named for what the asset *is* (scene, prop, icon, burst), never for
# how it happens to be drawn, so the same key stays honest across directions.
# ---------------------------------------------------------------------------

SPECS = {
    "scene": (
        "Output: full-bleed 1792x1024 (7:4 aspect). Deliver exactly 7:4 - "
        "the engine stretches the image to the canvas, so a 16:9 render "
        "arrives ~2% squashed and a 3:2 one ~17%. Eye-level camera. This "
        "is the backdrop for a reaction-time task and the stimulus can "
        "appear anywhere on the canvas, so the entire frame must read as a "
        "quiet, low-contrast field: hold it in a narrow, slightly darkened "
        "value range, and avoid small high-contrast speckle or busy "
        "clutter anywhere - it competes with a ~100px stimulus and adds "
        "noise to the measurement. Keep the centre especially broad and "
        "uncluttered, where the character, the score bar and the feedback "
        "bursts are composited. In-world signage is fine where the subject "
        "calls for it; no captions, no UI, no watermark, no foreground "
        "character."
    ),
    "doggo": (
        "Output: 682x682 square, transparent background (generate on plain "
        "flat white, then key it out with rembg / Photoshop). Character "
        "centred, body turned slightly towards screen-left with the face "
        "towards the viewer. The engine mirrors this sprite horizontally "
        "when the dog faces right, so bake in nothing asymmetric or "
        "text-like. FRAMING IS CRITICAL: the engine scales the whole PNG "
        "box to a fixed on-screen height, so padding shrinks and floats "
        "the character - crop so the paws touch the bottom edge and the "
        "silhouette fills ~95% of the frame height, and use identical "
        "framing for all three phases. No ground line, no cast shadow, no "
        "props or scenery."
    ),
    "nogo": (
        "Output: 682x682 square, transparent background (generate on plain "
        "flat white, then key it out). Character front-facing and centred; "
        "the engine mirrors the sprite when Nogo faces right, so nothing "
        "asymmetric or text-like. FRAMING IS CRITICAL: the engine scales "
        "the whole PNG box to a fixed on-screen height, so crop the paws to "
        "the bottom edge and fill ~95% of the frame height, identically "
        "across all three phases. (The phase-1 file in the repo breaks "
        "this - it sits small and low in its box and renders undersized - "
        "so fix the crop when regenerating.) No ground line, no cast "
        "shadow."
    ),
    "prop": (
        "Output: square-ish canvas, transparent background (generate on "
        "plain flat white, then key it out). One inanimate object only: no "
        "eyes, no face, no character. Angled corner-to-corner so it fills "
        "the frame, with a silhouette that stays legible at roughly 100px "
        "tall in game. No shadow, no scenery, no text."
    ),
    "icon": (
        "Output: 400x286 landscape, transparent background. Single icon, "
        "horizontal, filling the frame. It must stay unmistakable at "
        "~100px tall and read equally well mirrored, because the engine "
        "flips it for the right-hand side of the screen. No shadow, no text."
    ),
    "burst": (
        "Output: 709x710 square, transparent background (generate on plain "
        "flat white, then key it out). Burst fills ~90% of the frame; the "
        "lettering fills the burst, broken across two lines when the "
        "phrase is long. Spell the text EXACTLY as given, all caps, "
        "including any deliberate misspelling. Nothing else in the frame."
    ),
    "eyes": (
        "Output: ultra-wide banner, roughly 5:1, transparent background "
        "(it is composited over pure black in the cutscene). The two eyes "
        "sit far apart in the left and right thirds with empty "
        "transparency between them. The cutscene draws this at only ~10% "
        "of canvas height, so the shapes must still read at about "
        "525x100px - keep them bold and simple."
    ),
}

# ---------------------------------------------------------------------------
# STYLES - one entry per art direction, each a full set of "render" paragraphs.
# Switch the whole game's look with ART_DIRECTION below (or `--style NAME`).
#
# All three backgrounds share the "scene" role. The art in the repo today is
# three different media (photoreal corridor, painted backyard, inked alley) -
# those were placeholders. Whichever direction is active, the three are meant
# to be one medium, with per-scene mood carried by each asset's palette line
# rather than by a change of medium.
#
# "graphicnovel" is the direction the current assets were written for.
#
# "retrogaming" is the vintage-arcade alternative. It deliberately is NOT
# literal pixel art: the retro read comes from the restricted palette, the
# chunky silhouettes and the hard-edged shading, while the edges stay clean.
# Two reasons. Level 3 rotates its stimuli freely, and a pixel grid quantises
# the very dimension that level measures; and image models do not produce
# consistent pixel grids, so a literal-pixel direction would mean hand-drawing
# every asset instead of prompting for it.
# ---------------------------------------------------------------------------

STYLES = {
    "graphicnovel": {
        "scene": (
            "Style: inked graphic-novel illustration. Confident dark linework "
            "over flat colour blocks, with coloured light (sunlight, neon, "
            "overhead strip lights) doing the modelling instead of painted "
            "rendering - minimal texture, no visible brushwork, no "
            "photographic detail. Build the whole scene from a small palette: "
            "one dominant hue for the field, one accent hue for the light "
            "source, and value shifts of those two for everything else. "
            "Concentrate detail at the frame edges and in the far distance; "
            "keep the middle of the frame broad and simple."
        ),
        "doggo": (
            "Style: cel-shaded cartoon character illustration. Thick even "
            "dark-navy contour line (not pure black), flat colour blocks with "
            "soft two-tone shading and a warm rim light, big glossy dark eyes "
            "with two white catchlights and expressive brow markings, chibi "
            "proportions with an oversized head. Friendly mobile-game mascot "
            "look, warm tan/cream palette."
        ),
        "nogo": (
            "Style: pixel-art character sprite. Visible square pixel grid "
            "(roughly 150px native, scaled up with hard nearest-neighbour "
            "edges), limited palette, thin dark outline, clustered/dithered "
            "shading, chunky readable shapes. Deliberately a different medium "
            "from the smooth cel-shaded Doggo sprites - Nogo is the retro "
            "villain. Cool slate blue-grey palette with warm amber eyes. "
            "Upscale with nearest-neighbour only: never anti-alias the pixel "
            "edges."
        ),
        "prop": (
            "Style: softly-rendered painted object. Smooth airbrushed volume, "
            "warm ivory palette with subtle surface grain and a couple of "
            "hairline cracks, gentle specular sheen. No contour outline at "
            "all - this prop matches the painterly background, not the "
            "cel-shaded dog."
        ),
        "icon": (
            "Style: pure flat vector icon. One single solid fill colour, no "
            "outline, no shading, no gradient, no highlight - every internal "
            "detail is negative space cut out of the silhouette itself. Bold, "
            "simple, chunky geometry."
        ),
        "burst": (
            "Style: comic-book pop-art speech burst. Jagged starburst outline "
            "with deep spikes and rounded lobes, very thick even black "
            "outline, flat fill carrying a subtle darker halftone dot pattern, "
            "and a scatter of small black impact ticks radiating outside the "
            "burst. Lettering: chunky condensed all-caps display sans, tilted "
            "a few degrees, each word outlined in black with a hard offset "
            "black drop shadow - flat colour, no bevel, no gradient, no 3D."
        ),
        "eyes": (
            "Style: glossy vector clip-art. Smooth bezier shapes, radial "
            "gradient fills, sharp white specular highlights, solid black "
            "graphic shapes for lids and brows. No texture, no painterly "
            "detail, no background scenery."
        ),
    },
    "retrogaming": {
        "scene": (
            "Style: chunky limited-palette arcade illustration. Flat colour "
            "blocks only - no gradients, no brushwork, no photographic "
            "detail; the whole frame is built from at most eight flat tones. "
            "Depth comes from stacking simple shapes and hard-edged shadow "
            "blocks, never from soft shading. Heavy dark outlines on "
            "foreground shapes and none on distant ones, so the frame reads "
            "front-to-back by line weight alone. Where a large area needs a "
            "transition, use a coarse deliberate checker dither rather than a "
            "smooth blend, and keep even that out of the middle of the frame. "
            "The vintage read comes from the restricted palette and the "
            "chunky shapes, NOT from a pixel grid: render at full resolution "
            "with clean, unpixelated edges."
        ),
        "doggo": (
            "Style: chunky arcade mascot. Flat colour blocks from a "
            "six-to-eight tone palette, one heavy dark outline around the whole "
            "silhouette and a lighter interior line around each major shape. "
            "Shading is one or two hard-edged darker blocks plus a single "
            "hard highlight block - no gradients and no soft edges anywhere. "
            "Big simple eyes with one square catchlight, oversized head, and "
            "an exaggerated silhouette that still reads at thumbnail size. "
            "Warm tan and cream palette. Clean unpixelated edges."
        ),
        "nogo": (
            "Style: chunky arcade villain, drawn in the same medium as Doggo "
            "so the two share a world - flat colour blocks, heavy dark "
            "outline, hard-edged shading, no gradients. The contrast with "
            "Doggo is carried entirely by palette and silhouette rather than "
            "by a change of medium: cold slate blue-greys against Doggo's "
            "warm tan, angular spiky shapes against Doggo's round ones, and "
            "warm amber eyes as the single hot accent. A coarse checker "
            "dither may break up the largest flat areas of fur. Clean "
            "unpixelated edges."
        ),
        "prop": (
            "Style: chunky arcade prop. One flat base colour, a single "
            "hard-edged darker block for the shaded side, one hard highlight "
            "block, and the same heavy dark outline the characters carry. No "
            "gradient, no surface texture, no fine detail that would turn to "
            "noise at ~100px."
        ),
        "icon": (
            "Style: flat arcade icon. One solid fill, no shading and no "
            "gradient, every internal detail cut out of the silhouette as "
            "negative space, wrapped in the same heavy dark outline as the "
            "rest of the set. Bold chunky geometry that survives being "
            "reduced to a plain silhouette."
        ),
        "burst": (
            "Style: arcade attract-screen burst. The same jagged starburst "
            "with a very thick black outline, but flat single-tone fills with "
            "no halftone dots, and lettering in a chunky rectangular display "
            "face with a hard offset shadow block behind it - a coin-op title "
            "card rather than a printed comic. No bevel, no gradient, no 3D."
        ),
        "eyes": (
            "Style: flat two-tone eyes. Hard-edged shapes with no gradient "
            "and no glow: a solid iris block, a solid pupil, one square white "
            "catchlight, and heavy black lids and brows. Reads as an arcade "
            "cutscene sting."
        ),
    },
}

# The direction used when nothing is passed on the command line. Change this
# line to re-render every prompt in another style (handy from a notebook,
# where `--style` is not available).
ART_DIRECTION = "graphicnovel"

NOTES = """\
## How to use these prompts

**These are regeneration prompts.** Every asset below already exists. Each
entry names the current file as a reference image - feed it to the model
alongside the prompt (Gemini 2.5 Flash Image / "nano banana" multi-image
input, or ChatGPT's edit-with-reference) rather than generating from text
alone. Text-only generation will not land the same character twice.

**Backgrounds are the exception - regenerate them from scratch.** The three
background files in the repo are placeholders in three unrelated media. They
now share one `scene` style (inked graphic-novel: dark linework, flat colour,
coloured light doing the modelling), so ignore the current files as visual
references and generate fresh. Mood is carried by each scene's palette line,
not by a change of medium.

**A quiet background is a measurement requirement, not just taste.** Level 1
drops the bone at a completely random position on the canvas, and Level 2
spawns the fishbone at four fixed quadrant points. So no part of the frame is
safe to fill with busy, high-contrast detail: anything small and bright in
the backdrop is a potential false stimulus and adds noise to the reaction
times. Hold the whole scene in a narrow, slightly darkened value range.

**Transparency.** Sprites, props, icons, bursts and the intro eyes are all
RGBA in the repo. Models rarely emit true alpha, so generate on plain flat
white as prompted and key it out afterwards (`rembg`, Photoshop, remove.bg).
Backgrounds are opaque RGB - no keying needed.

**Framing beats prompting for the character sprites.** The engine scales the
entire PNG box to a fixed on-screen height and centres it, so any transparent
padding makes the character render smaller and float. Whatever the model
returns, crop and pad the three phase sprites to an identical bounding box
with the feet on the bottom edge before dropping them into `game/assets/`.

**The two Level 2 stimuli differ by COLOUR, not orientation.** `stimulus_1`
is cyan and `stimulus_2` is magenta; the silhouettes are identical, and the
engine mirrors whichever one lands on the right-hand side. Regenerating them
as a left-facing/right-facing pair would break the task.

**Copy voice.** The feedback bubbles are where the game's personality lives -
"GOOD BOI!", "PURRRRFECTT!", "ON A ROLL!". Keep new copy in that register:
short, shouted, dog- or cat-flavoured. Bland copy ("GREAT!", "CORRECT") is
the fastest way to make the game feel generic.

**Level 3 needs no stimulus art.** It is a length-discrimination task, so the
bones are drawn procedurally in `game/stimuli.js`: length is the manipulated
variable, and a scaled or middle-stretched sprite would leak cues that are not
length. Level 3 borrows Level 1's sprites and sounds and has no
`assets/level3/` folder, so it has no prompts here yet.

**Art directions.** Every prompt below is written in one direction (named at
the top of the file). `graphicnovel` is what the current assets were made for;
`retrogaming` is the vintage-arcade alternative. Do not mix output from the two
in one build of the game - the whole point of a direction is that all the
assets share it.
"""

# ---------------------------------------------------------------------------
# ASSETS - per-asset subject text, transcribed from the current files. This is
# what you edit for a different pose, mood or colourway; the style and output
# paragraphs are appended automatically from STYLE[asset["style"]].
#
# Fields: file, name, style, subject, [continuity], [also], [refs]
# ---------------------------------------------------------------------------

SHARED_FEEDBACK = [
    {
        "file": "level1/feedback_fast1.png",
        "also": "level2/feedback_fast1.png",
        "name": "Fast response, tier 1",
        "style": "burst",
        "subject": (
            'Text reads "NICE!" on a single line. Golden-yellow burst fill, '
            "bright orange lettering."
        ),
    },
    {
        "file": "level1/feedback_fast3.png",
        "also": "level2/feedback_fast3.png",
        "name": "Fast response, tier 3 (best)",
        "style": "burst",
        "subject": (
            'Text reads "ON A ROLL!" across two lines ("ON A" / "ROLL!"). '
            "Golden-yellow burst fill, bright azure-blue lettering - the blue "
            "on yellow makes this the loudest, most rewarding bubble of the "
            "set."
        ),
    },
    {
        "file": "level1/feedback_slow1.png",
        "also": "level2/feedback_slow1.png",
        "name": "Slow response (answered, but past the threshold)",
        "style": "burst",
        "subject": (
            'Text reads "TRY FASTER" across two lines ("TRY" / "FASTER"). '
            "Grass-green burst fill with a visible lighter-green halftone dot "
            "pattern, cream/off-white lettering. An encouraging nudge, not a "
            "telling-off."
        ),
    },
    {
        "file": "level1/feedback_late1.png",
        "also": "level2/feedback_late1.png",
        "name": "Timeout (no response at all)",
        "style": "burst",
        "subject": (
            'Text reads "TOO SLOW!" across two lines ("TOO" / "SLOW!"). '
            "Mid-blue burst fill with a darker blue halftone dot pattern, pale "
            "sky-blue lettering, and one small solid black five-pointed star "
            "tucked into the lower-left spike."
        ),
    },
    {
        "file": "level1/feedback_early1.png",
        "also": "level2/feedback_early1.png",
        "name": "Early press (before the stimulus appeared)",
        "style": "burst",
        "subject": (
            'Text reads "TOO EARLY" across two lines ("TOO" / "EARLY"). '
            "Vermilion red-orange burst fill with a subtle darker halftone "
            "speckle, golden-yellow lettering. The most alarming bubble of the "
            "set."
        ),
    },
]

LEVEL1_ASSETS = [
    {
        "file": "level1/intro_background.png",
        "name": "Intro cutscene - shelter corridor",
        "style": "scene",
        "subject": (
            "A long, empty animal-shelter kennel corridor seen straight down "
            "its centre line in strict one-point perspective, vanishing point "
            "dead centre, left and right walls mirroring each other: tall "
            "wire-mesh kennel fronts receding down both sides, cinder-block "
            "half-walls beneath them, a bare tiled floor, feeding troughs "
            "beside each gate, ducting running along the ceiling, and a row of "
            "fluorescent ceiling panels leading to a barred gate at the far "
            "end. A few thin, quiet dogs sit behind the mesh, watching. "
            "Institutional, cold and sad - bleak but entirely non-graphic "
            "(all-ages rescue-story opening). "
            "Palette: a cold desaturated blue-grey field, with the pale "
            "fluorescent panels overhead as the single light accent and weak "
            "pools of that light on the floor. Draw the mesh as an even, "
            "low-contrast screen tone, never as sharp high-contrast wire - it "
            "must not fizz."
        ),
    },
    {
        "file": "level1/background.png",
        "name": "Gameplay background - the new home's backyard",
        "style": "scene",
        "subject": (
            "A sunny back garden: a small wooden doghouse with a red pitched "
            "roof and an arched entrance sitting left of centre, a pale "
            "stepping-stone path curving up from the bottom-right across a "
            "broad green lawn, flower beds massed in the two lower corners, a "
            "low picket fence running across the middle distance, tree "
            "canopies framing the top corners, and a clear sky with a few "
            "simple clouds. Warm, safe and welcoming - this is Doggo's happy "
            "new home. The lawn across the middle of the frame stays wide open "
            "and unbroken. "
            "Palette: a warm mid-green field under a soft blue sky, with "
            "afternoon sunlight from the upper left as the single warm accent. "
            "Render the flower beds as a few broad blocks of colour, NOT as "
            "dense speckled blossoms - scattered small bright dots anywhere in "
            "this frame read as false stimuli."
        ),
    },
    {
        "file": "level1/player_1.png",
        "name": "Doggo - phase 1 (just rescued, malnourished)",
        "style": "doggo",
        "subject": (
            "A small puppy sitting upright and facing the viewer: tan and "
            "cream fur, long floppy ears, a cream blaze up the muzzle, cream "
            "brow patches over big round dark eyes, black button nose, and a "
            "downturned worried mouth. It is badly underfed, shown as a "
            "stylised pale skeleton read-through over the chest, shoulders and "
            "front legs - visible ribs, sternum and leg bones drawn as clean "
            "cartoon shapes. Pitiable and a bit heartbreaking, but still cute "
            "and entirely non-gory."
        ),
        "continuity": (
            "This sprite defines the character. Its exact fur colours, cream "
            "blaze and brow patches, ear shape and eye colour must be reused "
            "unchanged in phases 2 and 3."
        ),
    },
    {
        "file": "level1/player_2.png",
        "name": "Doggo - phase 2 (recovering)",
        "style": "doggo",
        "subject": (
            "The same puppy, now healthy: a filled-out body with no bones "
            "showing, a fluffy cream chest ruff, sitting upright with front "
            "paws planted, mouth open in a wide happy grin with a pink tongue "
            "lolling out, eyes bright and round. Same tan-and-cream coat, same "
            "cream blaze and brow patches, same floppy ears as phase 1 - just "
            "plumper and delighted."
        ),
        "continuity": (
            "Must read as the same individual dog as player_1.png: identical "
            "markings and ear shape, identical framing and scale in the "
            "square, only health and mood have changed."
        ),
        "refs": ["game/assets/level1/player_1.png", "game/assets/level1/player_2.png"],
    },
    {
        "file": "level1/player_3.png",
        "name": "Doggo - phase 3 (fully grown, evolved)",
        "style": "doggo",
        "subject": (
            "The same dog grown into a large, majestic, long-haired "
            "shepherd-type: a thick slate blue-grey overcoat with tan and "
            "cream underparts, a big shaggy cream chest ruff, pointed upright "
            "ears with tan inner fur, a plumed curled tail, standing "
            "four-square in profile facing screen-left with the head turned to "
            "the viewer, mouth open in a happy grin with the tongue out. "
            "Proud, fluffy and heroic - the payoff form."
        ),
        "continuity": (
            "The evolved adult of the same character: keep the cream muzzle "
            "blaze, cream brow patches and warm brown eyes from phases 1-2 "
            "even though the coat is now long and blue-grey and the body much "
            "bigger. Same square framing and scale as the earlier phases."
        ),
        "refs": ["game/assets/level1/player_2.png", "game/assets/level1/player_3.png"],
    },
    {
        "file": "level1/stimulus.png",
        "name": "Bone (reaction-time stimulus)",
        "style": "prop",
        "subject": (
            "A single classic cartoon dog bone - a smooth shaft with two "
            "rounded knobs at each end - in warm ivory and pale beige, lit "
            "from the upper left, angled diagonally from the upper-left knob "
            "down to the lower-right knob."
        ),
    },
    {
        "file": "level1/feedback_fast2.png",
        "name": "Fast response, tier 2 (Doggo flavour)",
        "style": "burst",
        "subject": (
            'Text reads "GOOD BOI!" across two lines ("GOOD" / "BOI!"). '
            "Golden-yellow burst fill with a subtle darker speckled halftone, "
            "bright scarlet-red lettering."
        ),
    },
]

LEVEL2_ASSETS = [
    {
        "file": "level2/intro_eyes.png",
        "name": "Intro cutscene - Nogo's eyes in the dark",
        "style": "eyes",
        "subject": (
            "A pair of predatory cat eyes, glowing amber-orange with a "
            "radiating fibre texture in the iris, a tall black slit pupil with "
            "two white highlight dots, and a heavy solid-black upper lid "
            "sweeping out into a long tapered point at the outer corner of "
            "each eye. Narrowed and menacing. The eyes are widely separated - "
            "one in the left third and one in the right third of the banner - "
            "with nothing between them."
        ),
    },
    {
        "file": "level2/background.png",
        "name": "Gameplay background - sushi restaurant back alley",
        "style": "scene",
        "subject": (
            "A night-time back alley behind a sushi restaurant, viewed "
            "head-on: a pair of wooden double doors in the centre with warm "
            "light glowing through their windows, red noren curtains with "
            "kanji hanging above them, a neon 'SUSHI' sign over the doorway, a "
            "smaller vertical neon sign with kanji to its left, and a big red "
            "paper lantern glowing to its right. Wall-mounted air-conditioner "
            "units and pipework tracing across the plank wall. Along the "
            "ground: wheelie bins, tied rubbish bags and a couple of cardboard "
            "boxes, massed at the left and right edges. The centre of the "
            "alley floor stays clear and unbroken. "
            "Palette: a deep indigo field, with the neon and the doorway spill "
            "as the single hot red-orange accent and one small cool accent on "
            "the vertical sign. Keep the litter and clutter as simple grouped "
            "silhouettes, not scattered small high-contrast pieces."
        ),
    },
    {
        "file": "level2/player_1.png",
        "name": "Nogo - phase 1 (lean and stalking)",
        "style": "nogo",
        "subject": (
            "A slate blue-grey cat crouched low in a stalking pre-pounce "
            "stance, front legs stretched forward and belly near the ground, "
            "head low and facing the viewer, tail curled up behind. Angry "
            "narrowed amber-yellow eyes under a heavy scowling brow, dusty "
            "pink inner ears, small pink nose, pale muzzle, white whiskers. "
            "Menacing but still readable as a chunky cartoon cat. No collar, "
            "no necklace, no props - this is the un-upgraded form."
        ),
        "continuity": (
            "This sprite defines the villain: slate blue-grey coat, amber "
            "eyes, pink inner ears and scowling brow carry through phases 2 "
            "and 3 unchanged."
        ),
    },
    {
        "file": "level2/player_2.png",
        "name": "Nogo - phase 2 (upgraded, seated)",
        "style": "nogo",
        "subject": (
            "The same slate blue-grey cat, now sitting upright and square to "
            "the viewer with front paws together and tail tucked round, "
            "fluffier and a little heavier. Same scowling amber eyes and pink "
            "inner ears. It has gained a necklace of small pale bone fragments "
            "strung across its chest - the phase-2 upgrade."
        ),
        "continuity": (
            "Same cat as player_1.png: identical coat colour, eyes, brow and "
            "ear markings. The bone necklace appears here for the first time "
            "and is kept in phase 3."
        ),
        "refs": ["game/assets/level2/player_1.png", "game/assets/level2/player_2.png"],
    },
    {
        "file": "level2/player_3.png",
        "name": "Nogo - phase 3 (boss form)",
        "style": "nogo",
        "subject": (
            "The same cat, now conspicuously fat and imposing, sitting "
            "squarely with a smug half-lidded amber glare and a small "
            "self-satisfied smirk. It wears an upgraded bone necklace with a "
            "larger bone pendant hanging at the centre, and a pale bone-white "
            "fish skeleton - skull with hollow eye sockets, spine and ribs - "
            "rises vertically from behind its head like a trophy crown."
        ),
        "continuity": (
            "Same coat colour, amber eyes, pink inner ears and brow as phases "
            "1-2, just far bulkier. Keep the same square framing and scale."
        ),
        "refs": ["game/assets/level2/player_2.png", "game/assets/level2/player_3.png"],
    },
    {
        "file": "level2/stimulus_1.png",
        "name": "Fishbone stimulus - variant A (cyan)",
        "style": "icon",
        "subject": (
            "A flat fish-skeleton icon in solid bright cyan: a pointed head at "
            "the left with an open jaw and a round cut-out eye, a spine "
            "running right with five curved rib pairs branching off it, and a "
            "wide forked tail fin at the right. Every gap is transparent - no "
            "outline, no shading, one colour only."
        ),
    },
    {
        "file": "level2/stimulus_2.png",
        "name": "Fishbone stimulus - variant B (magenta)",
        "style": "icon",
        "subject": (
            "The identical fish-skeleton icon, recoloured to solid bright "
            "magenta. Same head, eye cut-out, spine, five rib pairs and forked "
            "tail, same orientation - only the fill colour differs."
        ),
        "continuity": (
            "This must be a pure recolour of stimulus_1.png - pixel-identical "
            "geometry, size and orientation. The two variants are the choice "
            "task's response cue and colour is the ONLY feature that "
            "distinguishes them; do not mirror or redraw it."
        ),
        "refs": ["game/assets/level2/stimulus_1.png"],
    },
    {
        "file": "level2/feedback_fast2.png",
        "name": "Fast response, tier 2 (Nogo flavour)",
        "style": "burst",
        "subject": (
            'Text reads "PURRRRFECTT!" across two lines ("PURRRR" / '
            '"FECTT!") - the misspelling is deliberate, spell it exactly. '
            "Golden-yellow burst fill with a darker speckled halftone, "
            "vermilion red-orange italic lettering. The cat-flavoured "
            "counterpart to Level 1's GOOD BOI!"
        ),
    },
    {
        "file": "level2/feedback_error1.png",
        "name": "Wrong-key error (choice-task specific)",
        "style": "burst",
        "subject": (
            'Text reads "WRONG KEY!" across two lines ("WRONG" / "KEY!"). '
            "Hot magenta-pink burst fill with a darker pink halftone dot "
            "pattern, vermilion red-orange lettering. Deliberately the only "
            "pink bubble in the set, so a directional error is instantly "
            "distinguishable from a slow or early response."
        ),
    },
]

GROUPS = [
    (
        "shared",
        "Shared feedback bubbles",
        SHARED_FEEDBACK,
        "These files are byte-identical in `assets/level1/` and "
        "`assets/level2/`. Generate each once and save the same PNG to both "
        "folders.",
    ),
    ("1", 'Level 1 - Simple Reaction Time ("Doggo")', LEVEL1_ASSETS, ""),
    ("2", 'Level 2 - Simon Task ("Nogo")', LEVEL2_ASSETS, ""),
]

# ---------------------------------------------------------------------------
# SECTIONS - how the assets of one level are split up in the output. A
# background and a sprite are made in completely different ways (an opaque
# full-bleed frame vs. a keyed-out 682px box with a critical crop), so each
# kind gets its own subsection with its own reminder instead of the two being
# interleaved under one heading.
#
# An asset's section is derived from its style; add "section" to an asset dict
# to override that for a one-off.
# ---------------------------------------------------------------------------

SECTIONS = [
    (
        "scene",
        "Backgrounds & cutscene art",
        "Full-bleed 1792x1024 scene art, plus the graphics composited over it "
        "in the cutscenes. The backgrounds are opaque RGB and are the one "
        "group to generate *from scratch* - the files in the repo are "
        "placeholders in three unrelated media. Keep the whole frame quiet: "
        "the stimulus can land anywhere on it.",
    ),
    (
        "sprite",
        "Character sprites",
        "682x682 RGBA, three evolution phases each. Crop all three to an "
        "identical bounding box with the paws on the bottom edge - the engine "
        "scales the PNG box rather than the character, so mismatched padding "
        "makes a phase render smaller and float.",
    ),
    (
        "stimulus",
        "Stimuli",
        "RGBA. This is the thing the player actually reacts to, drawn at "
        "roughly 100px in game - the silhouette has to be unmistakable at "
        "that size, and to read just as well mirrored.",
    ),
    (
        "feedback",
        "Feedback bubbles",
        "709x710 RGBA comic bursts. Spell the copy EXACTLY as written, "
        "including any deliberate misspelling.",
    ),
]

STYLE_SECTION = {
    "scene": "scene",
    "eyes": "scene",
    "doggo": "sprite",
    "nogo": "sprite",
    "prop": "stimulus",
    "icon": "stimulus",
    "burst": "feedback",
}


def build_prompt(asset: dict, direction: str = None) -> str:
    """Merge one asset's subject with the active direction's render and its output spec."""
    role = asset["style"]
    parts = [asset["subject"]]
    if asset.get("continuity"):
        parts.append(f"Consistency: {asset['continuity']}")
    parts.append(STYLES[direction or ART_DIRECTION][role])
    parts.append(SPECS[role])
    return "\n\n".join(parts)


def section_of(asset: dict) -> str:
    """The section key an asset belongs to."""
    return asset.get("section") or STYLE_SECTION[asset["style"]]


def outline(keys):
    """The selected groups, as [(title, blurb, [(title, blurb, assets)])].

    Sections keep SECTIONS order, and empty ones are dropped so a group only
    advertises the kinds of asset it actually has.
    """
    groups = []
    for key, title, assets, blurb in GROUPS:
        if key not in keys:
            continue
        sections = []
        for section_key, section_title, section_blurb in SECTIONS:
            members = [a for a in assets if section_of(a) == section_key]
            if members:
                sections.append((section_title, section_blurb, members))
        groups.append((title, blurb, sections))
    return groups


def _anchor(heading: str, seen: dict) -> str:
    """A GitHub-style #anchor for a heading, de-duplicated the way GitHub does."""
    slug = re.sub(r"[^a-z0-9 -]", "", heading.lower()).replace(" ", "-")
    count = seen.get(slug, 0)
    seen[slug] = count + 1
    return slug if count == 0 else f"{slug}-{count}"


def render_markdown(keys, direction: str = None) -> str:
    direction = direction or ART_DIRECTION
    groups = outline(keys)

    # Anchors have to be handed out in heading order, because GitHub numbers
    # repeated slugs ("feedback-bubbles" appears in all three groups) by where
    # the headings fall in the document. So walk the whole document once up
    # front, then build the contents list from what that walk recorded.
    seen = {}
    _anchor("DoggoNogo asset prompts", seen)
    _anchor("How to use these prompts", seen)
    _anchor("Contents", seen)
    anchors = []
    for group_title, _, sections in groups:
        anchors.append(
            (
                _anchor(group_title, seen),
                [_anchor(section_title, seen) for section_title, _, _ in sections],
            )
        )
        for _, _, members in sections:
            for asset in members:
                _anchor(f"`{asset['file']}` - {asset['name']}", seen)

    out = [
        "# DoggoNogo asset prompts",
        "",
        (
            f"Art direction: **{direction}**. Generated by "
            "`prompts/make_prompts.py` - edit the STYLES / SPECS / ASSETS dicts "
            "there and re-run rather than hand-editing this file."
        ),
        "",
        NOTES,
        "## Contents",
        "",
    ]

    for (group_title, _, sections), (group_anchor, section_anchors) in zip(
        groups, anchors
    ):
        out.append(f"- [{group_title}](#{group_anchor})")
        for (section_title, _, members), section_anchor in zip(
            sections, section_anchors
        ):
            plural = "s" if len(members) != 1 else ""
            out.append(
                f"  - [{section_title}](#{section_anchor}) "
                f"({len(members)} asset{plural})"
            )
    out.append("")

    for group_title, group_blurb, sections in groups:
        out += ["---", "", f"## {group_title}", ""]
        if group_blurb:
            out += [group_blurb, ""]
        for section_title, section_blurb, members in sections:
            out += [f"### {section_title}", "", section_blurb, ""]
            for asset in members:
                out += [f"#### `{asset['file']}` - {asset['name']}", ""]
                if asset.get("also"):
                    out += [f"Also saved as `{asset['also']}`.", ""]
                refs = asset.get("refs", [f"game/assets/{asset['file']}"])
                out += [
                    "Reference image(s): " + ", ".join(f"`{r}`" for r in refs),
                    "",
                ]
                out += ["```", build_prompt(asset, direction), "```", ""]

    return "\n".join(out)


def _default_output(direction: str) -> Path:
    """Where the markdown goes: `prompts_<direction>.md`, next to this script.

    Naming the file after the direction means rendering another one adds a file
    instead of overwriting the first, so two directions can be compared.

    __file__ is missing when the code is pasted straight into a notebook cell,
    so fall back to the working directory - preferring a `prompts/` folder
    under it, since the interactive cwd is usually the repo root.
    """
    name = f"prompts_{direction}.md"
    try:
        return Path(__file__).resolve().parent / name
    except NameError:
        cwd = Path.cwd()
        folder = cwd / "prompts"
        return (folder if folder.is_dir() else cwd) / name


def _default_argv() -> list:
    """The command-line arguments, or none when there is no command line.

    Under an interactive kernel (Jupyter, VS Code interactive window) sys.argv
    belongs to ipykernel_launcher and carries flags like `--f=...kernel.json`,
    which argparse would reject. There are no user arguments in that case, so
    fall back to an empty list and just write the default file.
    """
    if "ipykernel" in sys.modules:
        return []
    return sys.argv[1:]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate DoggoNogo image prompts.")
    parser.add_argument(
        "--only",
        choices=[g[0] for g in GROUPS],
        action="append",
        help="Restrict output to one group (repeatable). Default: all groups.",
    )
    parser.add_argument(
        "--style",
        choices=sorted(STYLES),
        default=ART_DIRECTION,
        help=f"Art direction to render the prompts in. Default: {ART_DIRECTION}.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Where to write the markdown. Default: prompts.md next to this script.",
    )
    parser.add_argument(
        "--print",
        dest="to_stdout",
        action="store_true",
        help="Print to stdout instead of writing a file.",
    )
    args = parser.parse_args(_default_argv() if argv is None else argv)

    keys = args.only or [g[0] for g in GROUPS]
    markdown = render_markdown(keys, args.style)

    if args.to_stdout:
        print(markdown)
        return None

    path = args.output or _default_output(args.style)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(markdown)

    # Tally by kind of asset rather than by group, so the line stays short:
    # every group has its own feedback bubbles and would repeat the label.
    per_section = {title: 0 for _, title, _ in SECTIONS}
    for _, _, sections in outline(keys):
        for title, _, members in sections:
            per_section[title] += len(members)
    tally = ", ".join(
        f"{n} {title.lower()}" for title, n in per_section.items() if n
    )
    print(f"Wrote {path} - {sum(per_section.values())} {args.style} prompts ({tally}).")
    return path


if __name__ == "__main__":
    main()
