"""Generates copy-paste-ready AI image prompts for DoggoNogo's assets.

The output markdown is a GENERATION PIPELINE: paste the prompts into an image
model top to bottom, in order. One section per level, in play order - the
character sheet first, then that level's backgrounds, then its cutscene panels -
and the shared assets last, because they need the level art to exist: the title
screen stars both characters, and the feedback bubbles pop over every level.

There are no stimulus prompts. Every task stimulus is traced in code at run time
(game/stimuli.js) rather than generated, because the properties that decide a
reaction time - extent, contrast, orientation, and which cues are redundant with
the response - have to be parameters rather than whatever the artwork happened to
contain. Backgrounds are still generated, and still have to stay quiet, since the
stimulus is drawn over them. Cutscene panels that *picture* a stimulus (a
ribboned bone, a bone thrown from a car) are fine - they are story art shown between
narration lines, not the measured object.

Two rules keep the set coherent:

1. A character's three evolution phases are generated inside ONE evolution-sheet
   image and cropped into the three sprite files afterwards. Three phases drawn
   in one picture look like one individual; three separate generations never do.
   The two characters still get a sheet each, though - see the comment above SPECS
   for why one six-figure sheet is a bad trade.
2. A prompt that must match art made earlier in the pipeline (Levels 3-5's
   sheets, the title screen, the cutscene panels, every bubble after the first) is
   pasted into the chat together with those images. Its brief says so in plain
   words ("Attached are references for the hero dog, the villain cat, and the
   setting"), and the asset's `references` list names the files to attach,
   printed above the prompt for the human. Everything else is text-only.

Anything the *human* does to a generated image afterwards - cutting an evolution
sheet into its three sprites, keying out a flat white background - stays out of
the prompt, and out of this file: `prompts/raw_assets/convert_webp.py` and
`cut_sprites.py` do that work.

Each prompt has three short parts: the brief (which mentions any attached
references), one shared style paragraph, and its output specification. The style is deliberately
constant across every asset so the set feels hand-painted by one studio. Above
each prompt, an "In the game" line (DESCRIPTIONS) tells the human where the asset
appears and what the code draws over it; it is not part of the prompt.

Usage:
    python prompts/make_prompts.py                 # write prompts.md
    python prompts/make_prompts.py --only level1   # one pipeline step (repeatable)
    python prompts/make_prompts.py -o some/where.md
    python prompts/make_prompts.py --print         # stdout instead of a file

Running the file in a Jupyter / VS Code interactive window works too: the
kernel's own argv is ignored, so it just writes the default file. To narrow it
down there, call the functions directly instead of passing flags:

    main(["--only", "level1"])
    print(render_markdown(["level1"]))
"""

import argparse
import sys
from pathlib import Path

# Asset paths below are relative to this folder in the repo.
ASSET_ROOT = "game/assets/"


def prose(text: str) -> str:
    """Normalise a triple-quoted block into prompt prose.

    Blank lines stay as paragraph breaks; every other line break is a soft wrap
    introduced for the sake of the source file, so it collapses to one space.
    Prompt text is written as triple-quoted blocks rather than as concatenated
    "..." fragments precisely so that rewording a sentence cannot silently lose
    the space at a line join.
    """
    paragraphs = (
        " ".join(line.strip() for line in paragraph.strip().splitlines())
        for paragraph in text.strip().split("\n\n")
    )
    return "\n\n".join(p for p in paragraphs if p)


# ---------------------------------------------------------------------------
# Assets use a role only to select an output specification. Briefs stay short;
# attached references carry character continuity when needed.
# ---------------------------------------------------------------------------

# The "player" sheet spec below is one row of three, not a six-figure grid with a
# row per character. The final crop is a 682x682 square with the paws on the bottom
# edge, so what the sheet has to maximise is the HEIGHT of each figure - and every
# model tops out around 1536x1024 landscape whatever ratio is asked for. Three
# across that frame gives each figure the full 1024px of height; stacking Doggo over
# Nogo would halve it. A sheet each also leaves either character re-rollable on its
# own, and the shared style paragraph is what holds the two together. 3:2 rather
# than the 3:1 the crop
# suggests, for the same reason: a model asked for 3:1 delivers ~1024x341, and three
# 341px figures upscaled to 682 square is a mush.
#
# Facing direction belongs in the asset brief, since it varies by level.
#
# Scenes, cutscene panels and the cover are 16:9 because the game's stage is (1920x1080 design canvas, the
# aspect of nearly every screen it runs on; see game/index.html). The image model may only
# offer 7:4 (1792x1024) or 3:2 landscape - generate the widest it has and crop to 16:9 by
# hand; the code draws backgrounds with cover-scaling anyway, so an uncropped 7:4 file also
# works and simply loses 1.6% at the top and bottom. Either way: nothing essential within the
# top and bottom 6% of the frame.
SPECS = {
    "scene": """
        Output: 16:9 landscape, eye-level scene. Broad, calm open middle.
        """,
    "player": """
        Output: 1536x1024 landscape, three character stages side by side on white background.
        Shared baseline, even gaps, matching headroom and margins.
        """,
    "cover": """
        Output: 16:9 landscape. Keep the upper middle of the frame open and uncluttered
        for the title, and keep the lower edge open for the start prompt.
        """,
    # Story panels, NOT gameplay backgrounds: nothing is drawn over a panel but the
    # narration, so it can be as close and as busy as the shot wants - the "calm open
    # middle" the `scene` role asks for exists only because a stimulus lands there.
    # `CutsceneRunner` draws any image within 0.2 of the stage aspect edge to edge
    # (game/cutscene.js `drawBackground`), under letterbox bars covering the top and
    # bottom 8.5%.
    "panel": """
        Output: 16:9 landscape, cinematic story panel, shown full-bleed. Compose it like a
        film still: close in on the action, with shallow depth of field and motion blur
        where they serve the shot. Nothing essential in the top 8% or the bottom quarter -
        the panel is letterboxed and the narration is drawn over its lower quarter.
        """,
    "burst": """
        Output: 709x710 transparent square. Large starburst and large lettering.
        Use the exact uppercase text and line breaks given. Shared burst shape and lettering.
        """,
    "vignette": """
        Output: 1536x1024 landscape story panel. Centred subject, deep indigo backdrop,
        generous dark margins.
        """,
}

STYLE = """
    Classic 2D hand-drawn animation style, vintage 1950s-60s Disney storybook illustration in the style of Eyvind Earle and Mary Blair - Sleeping Beauty, Cinderella, Sword in the Stone. Flat gouache painting, No outlines, no black line art, no ink. Simple yet expressive shapes, chunky stylized geometry. Broad, visible, soft brushstrokes. Limited muted color palette. Flat colors, matte paper texture, obviously hand-painted. Soft diffused lighting, clean aesthetic, wholesome and nostalgic mood. No photorealism, no 3D, no anime. Whimsical, hand-painted, with character. When applicable, characters and animals feature large emotive eyes, and detailed fur and fluffiness. No text (unless specifically mentioned).
    """
# STYLE = """
#     Vintage arcade game artwork, crisp pixel art, chunky readable shapes, limited palette, deep navy shadows, golden-amber highlights, saturated color accents. Expressive mascot characters, bold silhouettes, playful energy, clean tile-like detail, hand-crafted 16-bit console feel, charming and full of personality. No text (unless specifically mentioned).
#     """
# ---------------------------------------------------------------------------
# ASSETS - file paths, output roles, generation order, and optional references.
# BRIEFS below contains the concise model-facing description for every asset.
#
# Fields:
#   file        where the result is saved, relative to ASSET_ROOT
#   name        human label for the markdown heading
#   style       which output role it plays (a key in SPECS)
#   also        optional: a second path the same file is copied to
#   references  optional: [file, ...] - already-generated assets to paste into the
#               chat with the prompt. The brief itself says what they are.
# ---------------------------------------------------------------------------

DOGGO_ADULT = "level1/player_3.webp"
NOGO_BOSS = "level2/player_3.webp"
BACKYARD = "level1/background.webp"
FIRST_BUBBLE = "level1/feedback_fast1.png"

LEVEL1_ASSETS = [
    {
        "file": "level1/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - evolution sheet (all three phases in one image)",
        "style": "player",
    },
    {
        "file": "level1/background.webp",
        "name": "Gameplay background - the new home's backyard",
        "style": "scene",
    },
    {
        "file": "level1/intro_background.webp",
        "name": "Intro cutscene - shelter corridor",
        "style": "scene",
    },
]

LEVEL2_ASSETS = [
    # Nogo's screen-left facing in BRIEFS is a hard
    # requirement, not a preference. Level 2 is a directional task: it sets
    # `state.playerFacing` from the side the stimulus appeared on
    # (game/levels/level2.js) and `drawPlayer` (game/core.js) mirrors the sprite when
    # that is "right", leaving "left" as the unmirrored default. Drawn square-on, the
    # mirroring would have nothing to flip and the cat would never read as turning
    # towards the fishbone. Doggo has no such constraint - level 1 never flips him.
    {
        "file": "level2/player_1.webp + player_2.webp + player_3.webp",
        "name": "Nogo - evolution sheet (all three phases in one image)",
        "style": "player",
    },
    {
        "file": "level2/background.webp",
        "name": "Gameplay background - sushi restaurant back alley",
        "style": "scene",
    },
]

# ---------------------------------------------------------------------------
# Illusion arc (game levels 3-5): "Bone fever". Doggo's three evolution sheets
# form ONE continuous story - each level's stage 1 is (or extends) a stage of
# the sheet before it - so every sheet after the first attaches the sprite it
# continues from.
#
# Level 3 is a descent into madness. A car speeds past the garden, someone throws
# a bone out of the window, and Doggo bolts after it into the city, then after the
# next bone, then the next. Phase 1: happy, on a restaurant's pavement terrace,
# picking up bones left on the tables. Phase 2: eyes going loony, he cannot stop
# and wants MORE - he has sniffed his way to the kitchen's back door. Phase 3:
# berserk, IN the kitchen, the terrified Chef throwing bones at him just to keep
# him back. Level 3 therefore has one BACKGROUND PER PHASE (the engine swaps
# `assets.imgBackground{1,2,3}` at each break, like the sprites); they are three
# views of the same restaurant and attach each other for continuity. The thrown
# bones are also what justifies the stimulus: a bone that lands on its end IS the
# vertical-horizontal illusion, no villain needed.
#
# Level 4: Nogo intervenes. A berserk dog next to HIS alley is bad for business,
# so he distracts the Chef and lays a trail of ribboned bones (which look longer
# than they are - the Muller-Lyer illusion) all the way back to Doggo's home.
# Doggo's sheet runs from berserk to calmed-down to home. The ribbon in level 4's
# art is the SAME bright vermilion red as the in-game procedural ribbon stimulus
# (game/levels/level4.js `finFill`, #e0392a), so the cutscene, the sprites and
# the task all read as one object.
#
# Level 5 is being re-planned (Doggo scolded, then trained to follow commands);
# its assets below are the previous "yarn" idea and will be replaced. Parked
# story ideas (the kennel people's return as a finale, a fairground with Nogo as
# carnival cat) are in README.md under "Future Levels".
# ---------------------------------------------------------------------------

DOGGO_BERSERK = "level3/player_3.webp"
DOGGO_BANDANA = "level4/player_2.webp"
TERRACE = "level3/background_1.webp"

LEVEL3_ASSETS = [
    {
        "file": "level3/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - bone-fever evolution sheet (all three phases in one image)",
        "style": "player",
        "references": [DOGGO_ADULT],
    },
    {
        "file": "level3/background_1.webp",
        "name": "Gameplay background, phase 1 - the restaurant's pavement terrace",
        "style": "scene",
    },
    {
        "file": "level3/background_2.webp",
        "name": "Gameplay background, phase 2 - the kitchen's back door",
        "style": "scene",
    },
    {
        "file": "level3/background_3.webp",
        "name": "Gameplay background, phase 3 - inside the kitchen",
        "style": "scene",
    },
    {
        "file": "level3/cutscene_car.png",
        "name": "Cutscene - the car speeding past the garden gate",
        "style": "panel",
        "references": [BACKYARD],
    },
    {
        "file": "level3/cutscene_gate.png",
        "name": "Cutscene - Doggo bolting through the streets",
        "style": "panel",
        "references": [DOGGO_ADULT],
    },
]

LEVEL4_ASSETS = [
    {
        "file": "level4/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - coming-home evolution sheet (all three phases in one image)",
        "style": "player",
        "references": [DOGGO_BERSERK],
    },
    {
        "file": "level4/cutscene_ribbon.png",
        "name": "Cutscene - Nogo with the ribbon spool",
        "style": "vignette",
        "references": [NOGO_BOSS],
    },
    {
        "file": "level4/cutscene_bone_ribboned.png",
        "name": "Cutscene - a bone tied with ribbons",
        "style": "vignette",
    },
]

LEVEL5_ASSETS = [
    {
        "file": "level5/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - yarn-sweater evolution sheet (all three phases in one image)",
        "style": "player",
        "references": [DOGGO_BANDANA],
    },
    {
        "file": "level5/cutscene_yarn.png",
        "name": "Cutscene - Nogo in the yarn mess",
        "style": "vignette",
        "references": [NOGO_BOSS],
    },
]

# Shared assets, generated last because they need the level art: the title screen
# stars both characters in front of Doggo's backyard, and the bubbles pop over
# every level's player sprite.
TITLE_ASSETS = [
    {
        "file": "cover.webp",
        "name": "Title screen - cover art (landing page)",
        "style": "cover",
        "references": [
            DOGGO_ADULT,
            NOGO_BOSS,
            BACKYARD,
        ],
    },
]

FEEDBACK_ASSETS = [
    {
        "file": "level1/feedback_fast1.png",
        "also": "level2/feedback_fast1.png",
        "name": "Fast response, tier 1",
        "style": "burst",
    },
    {
        "file": "level1/feedback_fast2.png",
        "name": "Fast response, tier 2 (Doggo flavour)",
        "style": "burst",
    },
    {
        "file": "level1/feedback_fast3.png",
        "also": "level2/feedback_fast3.png",
        "name": "Fast response, tier 3 (best)",
        "style": "burst",
    },
    {
        "file": "level1/feedback_slow1.png",
        "also": "level2/feedback_slow1.png",
        "name": "Slow response (answered, but past the threshold)",
        "style": "burst",
    },
    {
        "file": "level1/feedback_late1.png",
        "also": "level2/feedback_late1.png",
        "name": "Timeout (no response at all)",
        "style": "burst",
    },
    {
        "file": "level1/feedback_early1.png",
        "also": "level2/feedback_early1.png",
        "name": "Early press (before the stimulus appeared)",
        "style": "burst",
    },
    {
        "file": "level2/feedback_fast2.png",
        "name": "Fast response, tier 2 (Nogo flavour)",
        "style": "burst",
    },
    {
        "file": "level2/feedback_error1.png",
        "name": "Wrong-key error (choice-task specific)",
        "style": "burst",
    },
]

ALL_ASSETS = (
    LEVEL1_ASSETS
    + LEVEL2_ASSETS
    + LEVEL3_ASSETS
    + LEVEL4_ASSETS
    + LEVEL5_ASSETS
    + TITLE_ASSETS
    + FEEDBACK_ASSETS
)

# Keep the actual image request to a few concrete keywords. Detailed historical
# notes remain above as project documentation; they are not sent to the model.
BRIEFS = {
    # LEVEL 1
    "level1/player_1.webp + player_2.webp + player_3.webp": """
        Generate sprites for the main character: an overly cute Black Tri Australian Shepherd dog with one floppy ear, blue eyes. Front-facing. Three versions of the same character, side by side.
        - LEFT: small rescued puppy, scruffy coat, worried eyes.
        - MIDDLE: happy young dog, fluffy, wide grin.
        - RIGHT: proud adult dog, extra fluffy, chest out, tail high. 
        Same dog with same characteristics across all three phases. No shadows under the dog or environmental elements.
    """,
    "level1/background.webp": "Background for game. Sunny cottage backyard: red-roof doghouse, open green lawn, fence, flower beds, soft blue sky. In the background, the urban buildings of a downtown area are visible.",
    "level1/intro_background.webp": "Background for game cutscene. Empty evil kennel corridor, rows of stacked open metal cages on each side of the corridor, open and empty. It's dirty, grimy, gloomy and cold blue-grey light from overhead lamps, but warm daylight from the half-open door in the distance.",
    # LEVEL 2
    "level2/player_1.webp + player_2.webp + player_3.webp": """
    Generate sprites for the main character: one mischievous Persian alley cat with a visibly kinked tail. Orange eyes. From a three-quarter profile, looking to the side. Three versions of the same character, side by side. 
    
    - LEFT: scruffy stalker, crouched, ragged fur. Hungry.
    - MIDDLE: fluffy cat, upright, fishbone necklace, smug smile. 
    - RIGHT: Fat boss hat has eaten too much. Extra-fluffy. Even more fishbones on the necklace, and large fish skullhead on the head looking like a pope hat. Pleased smirk.
    
    Same cat with same characteristics across all three phases. No shadows under the cat or environmental elements.
    """,
    "level2/background.webp": "Background for game. Back alley of an urban city. Back door of a sushi-restaurant at night: asian lantern, navy sky, neon lights, overflowing bins and rubbish at the edges.",
    # LEVEL 3 - bone fever
    "level3/player_1.webp + player_2.webp + player_3.webp": """
        Generate sprites for the main character: an extra-fluffy adult Black Tri Australian Shepherd dog with one floppy ear, blue eyes. Front-facing. Three versions of the same character, side by side, going progressively crazy and obsessed.
        - LEFT: happy and greedy, tongue out, wide smile, tail up.
        - MIDDLE: manic wide grin, tongue on the side, big loony eyes with spiral pupils, fur starting to puff up and bristle.
        - RIGHT: full berserk - fur bristling wildly, big loony eyes with bloodshot spiral pupils, drooling.
        Same dog with same characteristics across all three phases. No shadows under the dog or environmental elements. Attached is a reference for Doggo.
    """,
    "level3/background_1.webp": "Background for game. Sunny pavement terrace of a small city restaurant: a few tables with checked tablecloths and empty chairs pushed back, plates with leftover bones, a striped awning, a chalkboard menu by the door, city buildings behind. Wide calm empty pavement in the middle.",
    "level3/background_2.webp": "Background for game. Back alley of a restaurant at golden hour: the kitchen's back door propped open with warm light and steam spilling out, a steamy kitchen window, stacked crates, a dustbin with a bin bag of bones spilling over. Wide calm empty middle.",
    "level3/background_3.webp": "Background for game. Inside the same restaurant's kitchen: steel counters along the walls, hanging pots and pans, a big stove with flames, bones scattered on the counters. At the far back a terrified Chef in a tall white hat is pressed against the wall, holding up a pot lid like a shield. Wide calm empty tiled floor in the middle.",
    "level3/cutscene_car.png": "Cutscene panel. Seen from the pavement: the garden fence and gate of a sunny cottage, a car speeding past in a blur, and a white dog bone flying out of its window in an arc. Attached is a reference for the garden.",
    "level3/cutscene_gate.png": "Cutscene panel. Close, low, cinematic shot: Doggo, an extra-fluffy australian shepherd dog with one floppy ear, seen from behind, filling the near frame at full sprint down the middle of a suburban road, ears flying, eyes locked on the car speeding away ahead of him; the city skyline on the horizon. Shallow depth of field and motion blur - Doggo sharp, the car, road and houses streaked with speed. Attached is a reference for Doggo.",
    # LEVEL 4 - Nogo intervenes
    "level4/player_1.webp + player_2.webp + player_3.webp": """
        Generate sprites for the main character: an extra-fluffy adult Black Tri Australian Shepherd dog with one floppy ear, blue eyes. Front-facing. Three versions of the same character, side by side, calming down from a bone frenzy.
        - LEFT: bristling berserk fur, bulging eyes, a bright red ribbon caught on one ear.
        - MIDDLE: fur settling, eyes half-back to normal, panting, a red ribbon tied loosely around the neck like a bandana.
        - RIGHT: exhausted and sheepish, sitting, fur smooth again, red ribbon bandana neatly tied, one bone at the paws.
        Same dog with same characteristics across all three phases. No shadows under the dog or environmental elements. Attached is a reference for Doggo, in his berserk state, to continue from.
    """,
    "level4/cutscene_ribbon.png": "Smug Nogo holding a wooden spool of bright red ribbon, loose ribbon on the floor, a pile of white dog bones beside him. Attached is a reference for Nogo.",
    "level4/cutscene_bone_ribboned.png": "Large white dog bone wrapped in bright red ribbon, two sweeping ribbon blades at each end.",
    # LEVEL 5 - yarn (being re-planned)
    "level5/player_1.webp + player_2.webp + player_3.webp": "Extra-fluffy Doggo with one floppy ear and red bandana, front-facing. LEFT: plain. MIDDLE: half-knitted top, loose yarn. RIGHT: finished colourful knitted jumper, proud stance. Attached is a reference for Doggo.",
    "level5/cutscene_yarn.png": "Delighted Nogo in a tangled colourful yarn workshop, winding a fresh ball of yarn. Attached is a reference for Nogo.",
    # TITLE SCREEN
    "cover.webp": """
        Cover art for a cute and funny video game. Dusk backyard standoff featuring the two main characters of the game: Doggo, the proud dog hero by his doghouse on the left, and Nogo, the villainous cat, smug attitude, on the fence on the right.
        Attached are references for the hero dog, the villain cat, and the setting.

        Make the expressions emotional: Doggo is pround and determined, while Nogo is grinning and mischievous.
        The sky and lightening should reflect the dramatic tension of the standoff, with warm sunset hues on the Doggo's side and menacing darker tones on Nogo's side.
        No text or lettering anywhere: the title is drawn over this in code, so leave the sky between the two characters open.
    """,
    # FEEDBACK BUBBLES (shared)
    "level1/feedback_fast1.png": 'Text: "NICE!" Golden burst, orange letters.',
    "level1/feedback_fast2.png": 'Text: "GOOD BOI!" on two lines. Golden burst, scarlet letters. Match the shape, spikes and lettering of the attached burst.',
    "level1/feedback_fast3.png": 'Text: "ON A ROLL!" on two lines. Golden burst, azure letters. Match the shape, spikes and lettering of the attached burst.',
    "level1/feedback_slow1.png": 'Text: "TRY FASTER" on two lines. Green burst, cream letters. Match the shape, spikes and lettering of the attached burst.',
    "level1/feedback_late1.png": 'Text: "TOO SLOW!" on two lines. Blue burst, pale-blue letters. Match the shape, spikes and lettering of the attached burst.',
    "level1/feedback_early1.png": 'Text: "TOO EARLY" on two lines. Vermilion burst, gold letters. Match the shape, spikes and lettering of the attached burst.',
    "level2/feedback_fast2.png": 'Text: "PURRRRFECTT!" on two lines. Golden burst, vermilion letters. Match the shape, spikes and lettering of the attached burst.',
    "level2/feedback_error1.png": 'Text: "WRONG KEY!" on two lines. Pink burst, vermilion letters. Match the shape, spikes and lettering of the attached burst.',
}

assert {asset["file"] for asset in ALL_ASSETS} == set(
    BRIEFS
), "every asset needs one brief"

# What each asset IS in the game - where it appears, what is drawn over it, what it has to
# leave room for. Printed under the heading in the markdown, for the human generating the
# image; never sent to the model (the brief above is the model-facing text).
DESCRIPTIONS = {
    # LEVEL 1
    "level1/player_1.webp + player_2.webp + player_3.webp": "Doggo's three Level 1 phases; the sprite swaps at each phase break with a sparkle burst. Phase 1 is also the puppy revealed in the Level 1 cutscene.",
    "level1/background.webp": "Level 1 gameplay (simple reaction time): Doggo sits centre-low on the lawn, the bone stimulus drops anywhere in the frame, the life bar sits top-centre. Also the instruction-screen backdrop under a dark scrim.",
    "level1/intro_background.webp": "Level 1 cutscene: the corridor of the kennel Doggo is rescued from, revealed after a metal-door sound, then Doggo's sprite on top of it.",
    # LEVEL 2
    "level2/player_1.webp + player_2.webp + player_3.webp": "Nogo's three Level 2 phases (mirrored in code to face the fishbone). Phase 1 is also the cat emerging from the dark in the Level 2 cutscene, eyes first.",
    "level2/background.webp": "Level 2 gameplay (Simon task): Nogo sits centre-low in the alley, the fishbone stimulus appears left/right (and top/bottom in phase 2). Also the instruction-screen backdrop.",
    # LEVEL 3 - bone fever
    "level3/player_1.webp + player_2.webp + player_3.webp": "Doggo's three Level 3 phases - the descent into bone fever - swapped at each phase break. Levels 3-5 currently borrow Level 1's sprites until this exists.",
    "level3/background_1.webp": "Level 3 gameplay, phase 1: the pair of bones (one horizontal, one tilted) is drawn either side of Doggo at mid-height, so the middle band must stay quiet.",
    "level3/background_2.webp": "Level 3 gameplay, phase 2 (swapped in at the first phase break). Same layout constraints as phase 1.",
    "level3/background_3.webp": "Level 3 gameplay, phase 3 (swapped in at the second phase break). The Chef belongs at the back edge, out of the stimulus band.",
    "level3/cutscene_car.png": "Level 3 cutscene panel: the bone thrown from the passing car. Narration lines are drawn over its lower quarter.",
    "level3/cutscene_gate.png": "Level 3 cutscene panel: Doggo bolting through the streets. Narration lines over the lower quarter.",
    # LEVEL 4 - Nogo intervenes
    "level4/player_1.webp + player_2.webp + player_3.webp": "Doggo's three Level 4 phases - calming down on the ribbon trail home - swapped at each phase break.",
    "level4/cutscene_ribbon.png": "Level 4 cutscene panel (sprite-style, centred on a dark stage): Nogo with the ribbon spool. Narration over the lower quarter.",
    "level4/cutscene_bone_ribboned.png": "Level 4 cutscene panel showing the ribboned bone the task then draws procedurally (same red as `finFill`).",
    # LEVEL 5 - yarn (being re-planned)
    "level5/player_1.webp + player_2.webp + player_3.webp": "Doggo's three Level 5 phases (previous yarn idea; Level 5 is being re-planned).",
    "level5/cutscene_yarn.png": "Level 5 cutscene panel (previous yarn idea; Level 5 is being re-planned).",
    # TITLE SCREEN
    "cover.webp": "Title screen, full-frame under the DOGGO/NOGO wordmark, which the engine draws in code (`showCoverScreen`) over the open sky between the two characters, with a slow zoom, a subtitle and a SPACE prompt at the bottom. Also the ambient surround behind the stage on non-16:9 screens.",
    # FEEDBACK BUBBLES (shared)
    "level1/feedback_fast1.png": "Speech-bubble sticker popped above the player after a fast response (first fast trial of a streak). Levels 1 and 2.",
    "level1/feedback_fast2.png": "Second consecutive fast response, Level 1 flavour (Level 2 has its own).",
    "level1/feedback_fast3.png": "Third consecutive fast response and the streak's peak, then the counter wraps. Levels 1 and 2.",
    "level1/feedback_slow1.png": "Response after the fast/slow threshold but before the window closed. Levels 1 and 2.",
    "level1/feedback_late1.png": "No response before the window closed (timeout). Levels 1 and 2.",
    "level1/feedback_early1.png": "Key pressed before the stimulus appeared (penalised). Levels 1 and 2; also stands in for Levels 3-5's wrong-side error until they get their own.",
    "level2/feedback_fast2.png": "Second consecutive fast response, Level 2 flavour.",
    "level2/feedback_error1.png": "Wrong arrow key in Level 2 (direction error).",
}

assert {asset["file"] for asset in ALL_ASSETS} == set(
    DESCRIPTIONS
), "every asset needs one in-game description"

# The feedback bubbles are the one set where every member must match every other
# one, so each is anchored to the first rather than to a description in words.
for _bubble in FEEDBACK_ASSETS[1:]:
    _bubble["references"] = [FIRST_BUBBLE]

# Every asset role must have an output specification.
_ROLES = {asset["style"] for asset in ALL_ASSETS}

_no_spec = _ROLES - set(SPECS)
assert not _no_spec, f"assets use roles with no SPECS entry: {sorted(_no_spec)}"

_unused_spec = set(SPECS) - _ROLES
assert not _unused_spec, f"SPECS defines roles no asset uses: {sorted(_unused_spec)}"

# ---------------------------------------------------------------------------
# GROUPS - the generation pipeline. One group per level, in play order, then the
# shared assets, which come last because they need the level art to exist: the
# title screen stars both characters in the backyard, and the feedback bubbles
# are one matched set every level pops over its own player sprite. Stimuli are
# absent on purpose - see the module docstring.
#
# Each entry is (cli key, heading, note, assets). This order is the order the
# markdown comes out in, which is the order the images have to be generated in:
# the assert below refuses a group that attaches art from a later one.
# ---------------------------------------------------------------------------

GROUPS = [
    (
        "level1",
        "Level 1 - Doggo, the hero",
        (
            "Doggo first: Levels 3-5 continue his sheet, and the title screen "
            "and Level 3's cutscene both attach art from this step."
        ),
        LEVEL1_ASSETS,
    ),
    (
        "level2",
        "Level 2 - Nogo, the villain",
        (
            "Nogo's sheet must be drawn facing screen-left: the level mirrors "
            "the sprite to face the stimulus, and a square-on cat has nothing "
            "to flip."
        ),
        LEVEL2_ASSETS,
    ),
    (
        "level3",
        "Level 3 - Bone fever",
        (
            "Doggo's descent, and three views of one restaurant: the sheet "
            "continues his Level 1 adult, and the phase-2 and phase-3 "
            "backgrounds attach the phase-1 terrace."
        ),
        LEVEL3_ASSETS,
    ),
    (
        "level4",
        "Level 4 - The way home",
        (
            "Nogo's ribbon trail. The sheet continues Level 3's berserk phase, "
            "so cut that one into its sprites before starting here."
        ),
        LEVEL4_ASSETS,
    ),
    (
        "level5",
        "Level 5 - Yarn (being re-planned)",
        (
            "The previous yarn idea, kept so the level has art at all; the "
            "story is being reworked (see README.md)."
        ),
        LEVEL5_ASSETS,
    ),
    (
        "title",
        "Shared - Title screen",
        "Needs both characters and the backyard to exist already.",
        TITLE_ASSETS,
    ),
    (
        "feedback",
        "Shared - Feedback bubbles",
        (
            "Generate these in the order listed. Every one after the first "
            "attaches the first as its anchor, so the set looks like one sheet "
            "of stickers rather than eight separate drawings."
        ),
        FEEDBACK_ASSETS,
    ),
]

# Every asset must sit in exactly one group. ALL_ASSETS and GROUPS are built from the
# same lists, so this only fires when one of them is forgotten - which is precisely the
# mistake that produces no error and no prompt, just a missing heading.
_GROUPED = [asset["file"] for _, _, _, members in GROUPS for asset in members]
assert sorted(_GROUPED) == sorted(
    asset["file"] for asset in ALL_ASSETS
), "every asset must appear in exactly one pipeline step"


def _produces(asset: dict) -> list:
    """Every file an asset yields - an evolution sheet names its three crops in one
    `file` string, and only the first of them carries the folder."""
    head, *rest = asset["file"].split(" + ")
    folder = head.rsplit("/", 1)[0] + "/" if "/" in head else ""
    return (
        [head]
        + [folder + name for name in rest]
        + ([asset["also"]] if asset.get("also") else [])
    )


# A prompt can only attach art that has already been generated, so every `references`
# entry must be produced EARLIER in the pipeline. Reordering the steps is exactly what
# breaks this, and the markdown gives no sign of it: the "Attach as reference" line
# simply names a file the human does not have yet.
_generated = set()
for _key, _title, _note, _members in GROUPS:
    for _asset in _members:
        _early = [r for r in _asset.get("references", []) if r not in _generated]
        assert not _early, f"{_asset['file']} attaches art generated later: {_early}"
        _generated.update(_produces(_asset))


def build_prompt(asset: dict) -> str:
    """Assemble a short, consistent prompt for one asset."""
    parts = [BRIEFS[asset["file"]], STYLE, SPECS[asset["style"]]]
    return "\n\n".join(prose(part) for part in parts if part and part.strip())


def outline(keys):
    """The selected pipeline steps, as [(title, note, assets)], in GROUPS order."""
    return [
        (title, note, members)
        for key, title, note, members in GROUPS
        if key in keys and members
    ]


def render_markdown(keys) -> str:
    """One prompt per asset, in generation order, with nothing else in the way."""
    out = [
        "# DoggoNogo asset prompts",
        "",
        (
            "Generated by `prompts/make_prompts.py`. Edit the asset briefs or "
            "shared style paragraph there, then re-run."
        ),
        "",
        (
            "Work top to bottom: this is a pipeline, and later steps reuse what "
            "earlier ones produced. Prompts are text-only unless an **Attach as "
            "reference** line names files to attach first (paths are relative to "
            f"`{ASSET_ROOT}`)."
        ),
        "",
    ]
    for group_title, note, members in outline(keys):
        out += ["---", "", f"## {group_title}", ""]
        if note:
            out += [f"_{note}_", ""]
        for asset in members:
            out += [f"### `{asset['file']}` - {asset['name']}", ""]
            out += [f"**In the game:** {prose(DESCRIPTIONS[asset['file']])}", ""]
            if asset.get("also"):
                out += [f"Also saved as `{asset['also']}`.", ""]
            if asset.get("references"):
                attach = ", ".join(f"`{ASSET_ROOT}{p}`" for p in asset["references"])
                out += [f"**Attach as reference:** {attach}", ""]
            out += ["```", build_prompt(asset), "```", ""]
    return "\n".join(out)


def _default_output() -> Path:
    """Where the generated markdown goes, next to this script.

    __file__ is missing when the code is pasted straight into a notebook cell,
    so fall back to the working directory - preferring a `prompts/` folder under
    it, since the interactive cwd is usually the repo root.
    """
    name = "prompts.md"
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
        help="Restrict output to one pipeline step (repeatable). Default: all steps.",
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
    markdown = render_markdown(keys)

    if args.to_stdout:
        print(markdown)
        return None

    path = args.output or _default_output()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(markdown)

    steps = outline(keys)
    total = sum(len(members) for _, _, members in steps)
    print(f"Wrote {path} - {total} prompts across {len(steps)} pipeline steps.")
    return path


if __name__ == "__main__":
    main()
