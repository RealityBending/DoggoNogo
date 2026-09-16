"""Generates copy-paste-ready AI image prompts for DoggoNogo's assets.

The output markdown is a GENERATION PIPELINE: paste the prompts into an image
model top to bottom, in order. Characters first, then the world they live in,
then the title screen that stars both, then the feedback bubbles.

There are no stimulus prompts. Every task stimulus is traced in code at run time
(game/stimuli.js) rather than generated, because the properties that decide a
reaction time - extent, contrast, orientation, and which cues are redundant with
the response - have to be parameters rather than whatever the artwork happened to
contain. Backgrounds are still generated, and still have to stay quiet, since the
stimulus is drawn over them. Cutscene panels that *picture* a stimulus (a
ribboned bone, bones on the lawn) are fine - they are story art shown between
narration lines, not the measured object.

Two rules keep the set coherent:

1. A character's three evolution phases are generated inside ONE evolution-sheet
   image and cropped into the three sprite files afterwards. Three phases drawn
   in one picture look like one individual; three separate generations never do.
   The two characters still get a sheet each, though - see the comment above SPECS
   for why one six-figure sheet is a bad trade.
2. A prompt that must match art made earlier in the pipeline (Nogo's sheet, the
   title screen, Nogo's cutscene eyes, every feedback bubble after the first)
   names the files to ATTACH as references and says what to take from each.
   Everything else is text-only.

Anything the *human* does to a generated image - cropping or removing a flat
white background - is printed under the prompt, never inside it.

Each prompt has four short parts: subject, any attached-reference match, one
shared style paragraph, and its output specification. The style is deliberately
constant across every asset so the set feels hand-painted by one studio.

Usage:
    python prompts/make_prompts.py                 # write prompts.md
    python prompts/make_prompts.py --only doggo    # one pipeline step (repeatable)
    python prompts/make_prompts.py -o some/where.md
    python prompts/make_prompts.py --print         # stdout instead of a file

Running the file in a Jupyter / VS Code interactive window works too: the
kernel's own argv is ignored, so it just writes the default file. To narrow it
down there, call the functions directly instead of passing flags:

    main(["--only", "doggo"])
    print(render_markdown(["doggo"]))
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


def _sheet_postprocess(level: str) -> str:
    """The by-hand steps that turn one evolution sheet into three sprite files."""
    return f"""
    Save the sheet as `prompts/raw_assets/{level}_player_v<N>`, run
    `convert_webp.py` there, add it to the SHEETS table in `cut_sprites.py` and run
    that with `--install`. It keys the background if the model left one and cuts
    each figure to its own 682x682 square - `{level}/player_1.webp`, `player_2.webp`,
    `player_3.webp`, left to right - paws on the bottom edge, silhouette filling
    ~95%, all three framed identically: the engine scales every sprite to the same
    on-screen height, so a padded figure would render smaller and appear to float.
    """


# The "player" sheet spec below is one row of three, not a six-figure grid with a
# row per character. The final crop is a 682x682 square with the paws on the bottom
# edge, so what the sheet has to maximise is the HEIGHT of each figure - and every
# model tops out around 1536x1024 landscape whatever ratio is asked for. Three
# across that frame gives each figure the full 1024px of height; stacking Doggo over
# Nogo would halve it. The coherence a shared sheet would buy is bought instead by
# attaching Doggo's finished sprite to Nogo's prompt, which costs no pixels and
# leaves either character re-rollable on its own. 3:2 rather than the 3:1 the crop
# suggests, for the same reason: a model asked for 3:1 delivers ~1024x341, and three
# 341px figures upscaled to 682 square is a mush.
#
# Facing direction belongs in the asset brief, since it varies by level.
SPECS = {
    "scene": """
        Output: 1792x1024, 7:4, eye-level scene. Broad, calm open middle.
        """,
    "player": """
        Output: 1536x1024 landscape, three character stages side by side on white background.
        Shared baseline, even gaps, matching headroom and margins.
        """,
    "cover": """
        Output: 1792x1024, 7:4 key art. Clear centre for the title, open lower edge.
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
#   step        optional: which pipeline step it belongs to, when its role is
#               shared by assets generated at different steps. Defaults to `style`
#   also        optional: a second path the same file is copied to
#   references  optional: [(file, what to take from it)] - already-generated
#               assets to ATTACH to the prompt
#   postprocess optional: what the human does to the image afterwards. Rendered
#               OUTSIDE the prompt block; see the module docstring.
# ---------------------------------------------------------------------------

DOGGO_ADULT = "level1/player_3.webp"
NOGO_BOSS = "level2/player_3.webp"
BACKYARD = "level1/background.webp"
FIRST_BUBBLE = "level1/feedback_fast1.png"

SHARED_ASSETS = [
    {
        "file": "cover1_noText.png",
        "name": "Title screen - main game background (landing page)",
        "style": "cover",
        "references": [
            (DOGGO_ADULT, "Doggo's floppy ear, markings, proportions and palette"),
            (NOGO_BOSS, "Nogo's kinked tail, markings, proportions and palette"),
            (BACKYARD, "the garden's layout, architecture and colour world"),
        ],
    },
    {
        "file": "level1/feedback_fast1.png",
        "also": "level2/feedback_fast1.png",
        "name": "Fast response, tier 1",
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
]

LEVEL1_ASSETS = [
    {
        "file": "level1/intro_background.webp",
        "name": "Intro cutscene - shelter corridor",
        "style": "scene",
    },
    {
        "file": "level1/background.webp",
        "name": "Gameplay background - the new home's backyard",
        "style": "scene",
    },
    {
        "file": "level1/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - evolution sheet (all three phases in one image)",
        "style": "player",
        "step": "doggo",
        "postprocess": _sheet_postprocess("level1"),
    },
    {
        "file": "level1/feedback_fast2.png",
        "name": "Fast response, tier 2 (Doggo flavour)",
        "style": "burst",
    },
]

LEVEL2_ASSETS = [
    {
        "file": "level2/background.webp",
        "name": "Gameplay background - sushi restaurant back alley",
        "style": "scene",
    },
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
        "step": "nogo",
        "postprocess": _sheet_postprocess("level2"),
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

# ---------------------------------------------------------------------------
# Illusion arc (game levels 3-5). Doggo's three evolution sheets form ONE
# continuous story - each level's stage 1 is (or extends) a stage of the sheet
# before it - so every sheet after the first attaches the sprite it continues
# from. The evolutions are about perception, not growth: Doggo sharpens up,
# then turns each of Nogo's defeated tricks (ribbons, yarn) into his own gear.
# An alternative display idea (Nogo's face in a HUD corner getting comically
# more beaten each phase) is parked in README.md under "Future Levels".
#
# The ribbon in level 4's art is the SAME bright vermilion red as the in-game
# procedural ribbon stimulus (game/levels/level4.js `finFill`, #e0392a), so the
# cutscene, the sprite trophies and the task all read as one object.
# ---------------------------------------------------------------------------

DOGGO_SHARP = "level3/player_3.webp"
DOGGO_BANDANA = "level4/player_2.webp"

LEVEL3_ASSETS = [
    {
        "file": "level3/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - insight evolution sheet (all three phases in one image)",
        "style": "player",
        "step": "doggo3",
        "references": [
            (DOGGO_ADULT, "Doggo's floppy ear, markings, proportions and palette")
        ],
        "postprocess": _sheet_postprocess("level3"),
    },
    {
        "file": "level3/cutscene_bones.png",
        "name": "Level 3 cutscene - the lawn at dusk, bones at odd angles",
        "style": "scene",
        "step": "cutscene",
        "references": [
            (BACKYARD, "the garden's layout, architecture and colour world")
        ],
    },
]

LEVEL4_ASSETS = [
    {
        "file": "level4/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - ribbon-trophy evolution sheet (all three phases in one image)",
        "style": "player",
        "step": "doggo4",
        "references": [
            (
                DOGGO_SHARP,
                "Doggo's floppy ear, markings, proportions, palette and sharp stance",
            )
        ],
        "postprocess": _sheet_postprocess("level4"),
    },
    {
        "file": "level4/cutscene_ribbon.png",
        "name": "Level 4 cutscene - Nogo with the ribbon spool",
        "style": "vignette",
        "step": "cutscene",
        "references": [
            (NOGO_BOSS, "Nogo's kinked tail, markings, proportions and palette")
        ],
    },
    {
        "file": "level4/cutscene_bone_ribboned.png",
        "name": "Level 4 cutscene - a bone tied with ribbons",
        "style": "vignette",
        "step": "cutscene",
    },
]

LEVEL5_ASSETS = [
    {
        "file": "level5/player_1.webp + player_2.webp + player_3.webp",
        "name": "Doggo - yarn-sweater evolution sheet (all three phases in one image)",
        "style": "player",
        "step": "doggo5",
        "references": [
            (
                DOGGO_BANDANA,
                "Doggo's floppy ear, markings, proportions, palette and red neck bandana",
            )
        ],
        "postprocess": _sheet_postprocess("level5"),
    },
    {
        "file": "level5/cutscene_yarn.png",
        "name": "Level 5 cutscene - Nogo in the yarn mess",
        "style": "vignette",
        "step": "cutscene",
        "references": [
            (NOGO_BOSS, "Nogo's kinked tail, markings, proportions and palette")
        ],
    },
]

ALL_ASSETS = (
    SHARED_ASSETS
    + LEVEL1_ASSETS
    + LEVEL2_ASSETS
    + LEVEL3_ASSETS
    + LEVEL4_ASSETS
    + LEVEL5_ASSETS
)

# Keep the actual image request to a few concrete keywords. Detailed historical
# notes remain above as project documentation; they are not sent to the model.
BRIEFS = {
    "cover1_noText.png": """
        Cover art for a cute and funny video game. Dusk backyard standoff featuring the two main characters of the game: Doggo, the proud dog hero by his doghouse, and Nogo, the villainous cat, smug attitude, on the fence.
    """,
    "level1/feedback_fast1.png": 'Text: "NICE!" Golden burst, orange letters.',
    "level1/feedback_fast2.png": 'Text: "GOOD BOI!" on two lines. Golden burst, scarlet letters.',
    "level1/feedback_fast3.png": 'Text: "ON A ROLL!" on two lines. Golden burst, azure letters.',
    "level1/feedback_slow1.png": 'Text: "TRY FASTER" on two lines. Green burst, cream letters.',
    "level1/feedback_late1.png": 'Text: "TOO SLOW!" on two lines. Blue burst, pale-blue letters.',
    "level1/feedback_early1.png": 'Text: "TOO EARLY" on two lines. Vermilion burst, gold letters.',
    # LEVEL 1
    "level1/intro_background.webp": "Background for game cutscene. Empty evil kennel corridor, rows of stacked open metal cages on each side of the corridor, open and empty. It's dirty, grimy, gloomy and cold blue-grey light from overhead lamps, but warm daylight from the half-open door in the distance.",
    "level1/background.webp": "Background for game. Sunny cottage backyard: red-roof doghouse, open green lawn, fence, flower beds, soft blue sky. In the background, the urban buildings of a downtown area are visible.",
    "level1/player_1.webp + player_2.webp + player_3.webp": """
        Generate sprites for the main character: an overly cute Black Tri Australian Shepherd dog with one floppy ear, blue eyes. Front-facing. Three versions of the same character, side by side.
        - LEFT: small rescued puppy, scruffy coat, worried eyes.
        - MIDDLE: happy young dog, fluffy, wide grin.
        - RIGHT: proud adult dog, extra fluffy, chest out, tail high. 
        Same dog with same characteristics across all three phases. No shadows under the dog or environmental elements.
    """,
    # LEVEL 2
    "level2/background.webp": "Background for game. Back alley of an urban city. Back door of a sushi-restaurant at night: asian lantern, navy sky, neon lights, overflowing bins and rubbish at the edges.",
    "level2/player_1.webp + player_2.webp + player_3.webp": """
    Generate sprites for the main character: one mischievous Persian alley cat with a visibly kinked tail. Orange eyes. From a three-quarter profile, looking to the side. Three versions of the same character, side by side. 
    
    - LEFT: scruffy stalker, crouched, ragged fur. Hungry.
    - MIDDLE: fluffy cat, upright, fishbone necklace, smug smile. 
    - RIGHT: Fat boss hat has eaten too much. Extra-fluffy. Even more fishbones on the necklace, and large fish skullhead on the head looking like a pope hat. Pleased smirk.
    
    Same cat with same characteristics across all three phases. No shadows under the cat or environmental elements.
    """,
    "level2/feedback_fast2.png": 'Text: "PURRRRFECTT!" on two lines. Golden burst, vermilion letters.',
    "level2/feedback_error1.png": 'Text: "WRONG KEY!" on two lines. Pink burst, vermilion letters.',
    "level3/player_1.webp + player_2.webp + player_3.webp": "Doggo with one floppy ear, front-facing. LEFT: goofy seated dog, tilted head. MIDDLE: extra-fluffy curious dog, raised paw. RIGHT: extra-fluffy alert scent-hound, proud stance.",
    "level3/cutscene_bones.png": "Dusk backyard, white dog bones at odd angles, indigo grass, warm cottage windows.",
    "level4/player_1.webp + player_2.webp + player_3.webp": "Extra-fluffy Doggo with one floppy ear, front-facing. LEFT: sharp stance. MIDDLE: sharp stance, red ribbon neck bandana. RIGHT: proud stance, red neck bandana and red ribbon headband.",
    "level4/cutscene_ribbon.png": "Smug Nogo holding a wooden spool of bright red ribbon, loose ribbon on the floor.",
    "level4/cutscene_bone_ribboned.png": "Large white dog bone wrapped in bright red ribbon, two sweeping ribbon blades at each end.",
    "level5/player_1.webp + player_2.webp + player_3.webp": "Extra-fluffy Doggo with one floppy ear and red bandana, front-facing. LEFT: plain. MIDDLE: half-knitted top, loose yarn. RIGHT: finished colourful knitted jumper, proud stance.",
    "level5/cutscene_yarn.png": "Delighted Nogo in a tangled colourful yarn workshop, winding a fresh ball of yarn.",
}

assert {asset["file"] for asset in ALL_ASSETS} == set(
    BRIEFS
), "every asset needs one brief"

# The feedback bubbles are the one set where every member must match every other
# one, so each is anchored to the first rather than to a description in words.
_BUBBLES = [a for a in ALL_ASSETS if a["style"] == "burst"]
for _bubble in _BUBBLES[1:]:
    _bubble["references"] = [
        (FIRST_BUBBLE, "the burst shape, the spike pattern and the letterforms")
    ]

# Every asset role must have an output specification.
_ROLES = {asset["style"] for asset in ALL_ASSETS}

_no_spec = _ROLES - set(SPECS)
assert not _no_spec, f"assets use roles with no SPECS entry: {sorted(_no_spec)}"

_unused_spec = set(SPECS) - _ROLES
assert not _unused_spec, f"SPECS defines roles no asset uses: {sorted(_unused_spec)}"

# ---------------------------------------------------------------------------
# GROUPS - the generation pipeline, ordered by dependency: the characters are
# established first, then the places they live in, then the title screen (which
# needs both characters and the backyard), then the feedback bubbles. Stimuli are
# absent on purpose - see the module docstring.
#
# Each entry is (cli key, heading, note, keys); a group collects every asset whose
# step key matches, in ALL_ASSETS definition order. An asset's step key is its
# `step` field if it has one, else its role - because role and pipeline position
# are not the same thing. Both level players share the "player" role (they are the
# same kind of asset, drawn the same way), but they are two generations with a
# dependency between them, so each declares its own `step`.
# ---------------------------------------------------------------------------

GROUPS = [
    (
        "doggo",
        "Step 1 - Doggo, the hero",
        "One evolution sheet, cropped by hand into the three sprite files.",
        ("doggo",),
    ),
    (
        "nogo",
        "Step 2 - Nogo, the villain",
        (
            "Same again, but anchored to Doggo's finished sprite so both "
            "characters read as one illustrator's work."
        ),
        ("nogo",),
    ),
    (
        "scenes",
        "Step 3 - Backgrounds",
        (
            "The stimulus is drawn over these in code, at a random position, so "
            "they have to stay quiet across the whole frame."
        ),
        ("scene",),
    ),
    (
        "cover",
        "Step 4 - Title screen",
        "Needs both characters and the backyard to exist already.",
        ("cover",),
    ),
    (
        "feedback",
        "Step 5 - Feedback bubbles",
        (
            "Generate these in the order listed. Every one after the first "
            "attaches the first as its anchor, so the set looks like one sheet "
            "of stickers rather than eight separate drawings."
        ),
        ("burst",),
    ),
    (
        "illusion-doggo",
        "Step 6 - Illusion arc (levels 3-5): Doggo's evolutions",
        (
            "Three sheets forming one continuous story, generated IN ORDER: each "
            "sheet after the first attaches a sprite cropped from the previous "
            "one, so crop before moving on."
        ),
        ("doggo3", "doggo4", "doggo5"),
    ),
    (
        "illusion-cutscenes",
        "Step 7 - Illusion arc: cutscene panels",
        (
            "These replace the `[ ART: ... ]` placeholder text steps in "
            "game/levels/cutscenes.js - swap each placeholder for an `image` "
            "step once its panel exists."
        ),
        ("cutscene",),
    ),
]

# Every asset must be reachable by some pipeline step, or it silently disappears from
# the output: a mistyped `step`, or a role no group lists, produces no error and no
# prompt. This is the one failure mode the `step` indirection above introduces, so it
# is checked here rather than left to be noticed by counting headings in the markdown.
_STEP_KEYS = {key for group in GROUPS for key in group[3]}
_unreachable = [
    asset["file"]
    for asset in ALL_ASSETS
    if asset.get("step", asset["style"]) not in _STEP_KEYS
]
assert not _unreachable, f"assets no pipeline step collects: {_unreachable}"


def _references_block(references) -> str:
    """The 'attach these images' paragraph, for prompts anchored to earlier art."""
    items = "; ".join(
        f"`{ASSET_ROOT}{path}` for {prose(take)}" for path, take in references
    )
    lead = "Attached reference" if len(references) == 1 else "Attached references"
    return prose(f"{lead}: {items}. Match the named qualities.")


def build_prompt(asset: dict) -> str:
    """Assemble a short, consistent prompt for one asset."""
    parts = [BRIEFS[asset["file"]]]
    if asset.get("references"):
        parts.append(_references_block(asset["references"]))
    parts += [STYLE, SPECS[asset["style"]]]
    return "\n\n".join(prose(part) for part in parts if part and part.strip())


def outline(keys):
    """The selected pipeline steps, as [(title, note, assets)], in GROUPS order."""
    groups = []
    for key, title, note, step_keys in GROUPS:
        if key not in keys:
            continue
        members = [a for a in ALL_ASSETS if a.get("step", a["style"]) in step_keys]
        if members:
            groups.append((title, note, members))
    return groups


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
            f"`{ASSET_ROOT}`). Anything the *human* does to a generated image - "
            "cropping, keying the white out to transparency, recolouring - is "
            "printed under the prompt, never inside it."
        ),
        "",
    ]
    for group_title, note, members in outline(keys):
        out += ["---", "", f"## {group_title}", ""]
        if note:
            out += [f"_{note}_", ""]
        for asset in members:
            out += [f"### `{asset['file']}` - {asset['name']}", ""]
            if asset.get("also"):
                out += [f"Also saved as `{asset['also']}`.", ""]
            if asset.get("references"):
                attach = ", ".join(f"`{ASSET_ROOT}{p}`" for p, _ in asset["references"])
                out += [f"**Attach as reference:** {attach}", ""]
            out += ["```", build_prompt(asset), "```", ""]
            if asset.get("postprocess"):
                out += [f"**Then, by hand:** {prose(asset['postprocess'])}", ""]
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
