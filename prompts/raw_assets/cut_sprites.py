"""Step 2 of the asset pipeline: cut an evolution sheet into three sprite files.

A character arrives from the image model as ONE sheet with its three phases side
by side (see `prompts/make_prompts.py`). Run `convert_webp.py` first so the sheet
is WebP, then this script: it removes the background if the model left one, finds
the three figures, cuts them into identically framed squares, optionally mirrors
them, and saves them as WebP beside the sheet.

Usage:
    python prompts/raw_assets/cut_sprites.py                         # every sheet in SHEETS below
    python prompts/raw_assets/cut_sprites.py --install               # ...and copy each into its level
    python prompts/raw_assets/cut_sprites.py level1_player_v1        # one sheet, extension optional
    python prompts/raw_assets/cut_sprites.py level2_player_v1 --mirror --install level2
    python prompts/raw_assets/cut_sprites.py level1_player_v1 --format png --size 682

Running the file in a Jupyter / VS Code interactive window cuts the SHEETS table
at the bottom of this file - edit it there, or call `process` yourself:

    process("level1_player_v1")
    process("level2_player_v1", mirror=True, quality=80)

Cuts land beside their sheet, named after it: `level1_player_v1.webp` gives
`level1_player_v1_cut1.webp`, `_cut2`, `_cut3`. Nothing touches `game/assets/`
until you ask - `--install` copies the three cuts over that level's `player_1..3`
files, renaming them to what the engine loads and deleting any old-format copies.

`_cut<n>` is a reserved suffix: files carrying it are this script's own output,
and `process` refuses to treat one as a sheet. Older runs also wrote `_check`
contact strips; any still lying around are deleted on the next run.

BACKGROUND REMOVAL, ONLY IF NEEDED
----------------------------------
A sheet with a real alpha channel (the model returned a cutout, as the current
generation does) is taken as-is; re-keying it would only risk eating the
character. Its matte is still tidied: the model's mattes top out at alpha ~253
rather than 255, so the whole body would let 1% of the background through, and
`harden_alpha` snaps that to fully opaque without touching the fur fringe.

An opaque sheet on flat paper is keyed by colour instead - `key_background`. That
only works for a FLAT background; a gradient or vignette behind the figures needs
a proper matting tool before this script.

MIRRORING
---------
The engine draws a sprite as-is when `state.playerFacing === "left"` and flips it
with `ctx.scale(-1, 1)` for "right" (game/core.js `drawPlayer`), so a sprite file
has to face LEFT. Doggo faces the camera, so it does not matter; Nogo is drawn in
profile and the model tends to face him right, so his sheet is cut with
`mirror=True`. Each cut is mirrored on its own after cropping, so the left-to-right
phase order of the sheet is preserved.

WHY THE THREE CROPS SHARE ONE FRAME
-----------------------------------
The engine reads the sprite aspect ratio from player_1 ALONE and then draws all
three phases into that one box (game/core.js `initializeDimensions` / `drawPlayer`):

    playerAspect = imgPlayer1.naturalWidth / imgPlayer1.naturalHeight
    player.height = canvas.height * params.playerHeight

So the on-screen box is a fixed size no matter which phase is showing. Two
consequences drive the cropping below:

1. All three files must have the SAME pixel dimensions. If player_2 were cropped
   tighter than player_1 it would be stretched to player_1's aspect on screen.
2. A phase looks bigger in game only because it fills more of its own canvas.
   Cropping each figure to its own tight bounding box would erase the size
   difference entirely - the puppy would render exactly as large as the adult.

So the three figures are measured together: one square side for all three, one
shared baseline, each figure centred horizontally on itself. The puppy keeps its
empty headroom, which is precisely what makes it render small.
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage


def _script_folder() -> Path:
    """This file's folder, or a sensible guess when there is no `__file__`.

    Pasting the script into a notebook cell rather than importing it leaves
    `__file__` undefined, so fall back to the working directory - preferring a
    `prompts/raw_assets` under it, since the interactive cwd is usually the repo
    root.
    """
    try:
        return Path(__file__).resolve().parent
    except NameError:
        cwd = Path.cwd()
        for candidate in (cwd / "prompts" / "raw_assets", cwd / "raw_assets"):
            if candidate.is_dir():
                return candidate
        return cwd


def _repo_root(start: Path) -> Path:
    """Nearest ancestor that holds `game/assets`, so `--install` finds the levels."""
    for folder in (start, *start.parents):
        if (folder / "game" / "assets").is_dir():
            return folder
    return start


HERE = _script_folder()
GAME_ASSETS = _repo_root(HERE) / "game" / "assets"

# ---------------------------------------------------------------------------
# The sheets this script cuts when run with no arguments. One entry per current
# character sheet - `v<N>` files are the kept versions, `x<N>` the discarded
# ones, and only the current `v` is listed. `mirror` is per sheet because only
# Nogo needs it - see MIRRORING above.
# ---------------------------------------------------------------------------
SHEETS = [
    {"sheet": "level1_player_v1", "level": "level1"},
    {"sheet": "level2_player_v1", "level": "level2", "mirror": True},
]

# Extensions a sheet may arrive in, in the order they are tried when the name is
# given without one. WebP first: step 1 has usually run by now.
SHEET_EXTS = (".webp", ".png", ".jpg", ".jpeg")

# Cuts are written next to the sheets they came from, so a sheet name has to be
# checked against this script's own output before it is cut up.
OUTPUT_SUFFIX = re.compile(r"_(cut\d+|check)$")

# A sheet is keyed only if it arrives opaque. Anything with a real alpha channel
# (the model already returned a cutout) is taken as-is.
ALREADY_KEYED_FRACTION = 0.01

# A model cutout's matte reaches ~253 on the body, never 255. Alpha at or above
# this is treated as fully opaque; everything below is scaled up proportionally,
# which leaves the antialiased fur fringe alone.
OPAQUE_AT = 245

# Colour distance, 0-255, from the sampled background colour, for opaque sheets.
# Below TOL_SOLID a pixel is background; above TOL_EDGE it is the character;
# between the two it is an antialiased edge pixel and gets partial alpha. JPEG
# ringing around a white background runs to ~10, so TOL_SOLID has to clear it.
TOL_SOLID = 32
TOL_EDGE = 64

# Fraction of the output square the tallest figure fills. The rest is the even
# margin that keeps the sprite off the canvas edge.
FILL = 0.95

# Defaults for both entry points - the SHEETS table and the command line.
SIZE = 682
FORMAT = "webp"
QUALITY = 92
FIGURES = 3


def resolve_sheet(name) -> Path:
    """Find a sheet by path, or by bare name in this folder, trying SHEET_EXTS."""
    path = Path(name)
    candidates = [path] if path.suffix else [path.with_suffix(ext) for ext in SHEET_EXTS]
    for candidate in candidates:
        for folder in (Path.cwd(), HERE):
            found = candidate if candidate.is_absolute() else folder / candidate
            if found.is_file():
                if OUTPUT_SUFFIX.search(found.stem):
                    raise SystemExit(f"{found.name} is this script's output, not a sheet")
                return found
    tried = ", ".join(c.name for c in candidates)
    raise SystemExit(f"no sheet found for {name!r} (tried {tried} in {HERE}) - has convert_webp.py run?")


def load_rgba(path: Path) -> np.ndarray:
    """Read any format the sheet might arrive in as an HxWx4 uint8 array."""
    return np.array(Image.open(path).convert("RGBA"))


def key_background(rgba: np.ndarray) -> np.ndarray:
    """Return `rgba` with a flat, border-connected background made transparent.

    Two rules keep this from biting into the artwork:

    CONNECTIVITY. Only background-coloured regions that touch the image border
    are removed. Nogo's cream fishbone necklace and Doggo's pale chest ruff are
    the same near-white as the paper behind them, but they are enclosed by the
    character, so they survive. A plain "make every white pixel transparent" pass
    punches holes straight through both.

    A SOFT EDGE. The model draws an antialiased outline, so the pixels along it
    are part background and part ink. Keying them fully in or fully out leaves a
    stair-stepped silhouette or a pale fringe. They get fractional alpha instead,
    ramped across TOL_SOLID..TOL_EDGE.
    """
    rgb = rgba[..., :3].astype(np.int16)

    # The background colour is whatever dominates a 2px frame around the sheet.
    frame = np.concatenate([rgb[:2].reshape(-1, 3), rgb[-2:].reshape(-1, 3),
                            rgb[:, :2].reshape(-1, 3), rgb[:, -2:].reshape(-1, 3)])
    background = np.median(frame, axis=0)

    distance = np.abs(rgb - background).max(axis=2)

    # Keep only the background-coloured regions that reach the border.
    solid = distance <= TOL_SOLID
    labels, count = ndimage.label(solid)
    if count:
        edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
        outside = np.isin(labels, np.setdiff1d(np.unique(edge), [0]))
    else:
        outside = np.zeros(solid.shape, bool)

    ramp = np.clip((distance - TOL_SOLID) / (TOL_EDGE - TOL_SOLID), 0, 1)
    near = ndimage.binary_dilation(outside, iterations=2)

    alpha = np.where(outside, 0.0, np.where(near, ramp, 1.0))
    out = rgba.copy()
    out[..., 3] = np.rint(alpha * 255).astype(np.uint8)
    return out


def harden_alpha(rgba: np.ndarray, opaque_at: int = OPAQUE_AT) -> np.ndarray:
    """Scale alpha so that `opaque_at` and above become 255. See the module docstring."""
    alpha = rgba[..., 3].astype(np.float32) * (255 / opaque_at)
    out = rgba.copy()
    out[..., 3] = np.clip(np.rint(alpha), 0, 255).astype(np.uint8)
    return out


def bleed_edges(rgba: np.ndarray) -> np.ndarray:
    """Flood each transparent pixel with its nearest opaque colour.

    Resampling ignores alpha when it mixes colour channels, so a sprite cut out
    of a white sheet carries white in the RGB of its transparent pixels and pulls
    a pale halo inwards the moment it is scaled down. Painting the discarded
    region with the colours next to it makes that mixing a no-op.
    """
    opaque = rgba[..., 3] > 0
    if opaque.all() or not opaque.any():
        return rgba
    _, (rows, cols) = ndimage.distance_transform_edt(~opaque, return_indices=True)
    out = rgba.copy()
    out[..., :3] = rgba[rows, cols, :3]
    return out


def find_figures(alpha: np.ndarray, expected: int) -> list:
    """Split the sheet into `expected` figure masks, ordered left to right.

    Connected components rather than the vertical gaps the prompt asks for,
    because the sheets do not actually have those gaps: a tail routinely sweeps
    across into the next figure's column range, so a column-occupancy split
    merges two figures into one sprite. The figures never touch, though - each is
    its own blob - so component labelling separates them where a projection
    cannot.

    Returning a mask per figure rather than a bounding box matters for the same
    reason. Since the boxes overlap, cutting a square out of the sheet would drag
    a slice of the neighbour in with it; each figure is cut from a sheet with the
    other two erased.
    """
    labels, count = ndimage.label(alpha > 8, structure=np.ones((3, 3)))
    if count < expected:
        raise SystemExit(
            f"found {count} shape(s), expected {expected} figures - if the figures "
            "touch anywhere they label as one blob and cannot be separated"
        )

    mass = ndimage.sum(alpha > 8, labels, range(1, count + 1))
    spans = ndimage.find_objects(labels)
    centre = {label: (spans[label - 1][1].start + spans[label - 1][1].stop) / 2
              for label in range(1, count + 1)}

    ranked = (np.argsort(mass)[::-1] + 1).tolist()
    figures, leftovers = ranked[:expected], ranked[expected:]

    # The three phases differ in size, but not by two orders of magnitude. A
    # scrap picked as a figure means either a wrong --figures or a key that left
    # a chunk of background behind - and that scrap has displaced a real figure.
    largest = max(mass[label - 1] for label in figures)
    runts = [label for label in figures if mass[label - 1] < largest * 0.02]
    if runts:
        print(f"  WARNING: {len(runts)} of the {expected} shapes chosen are specks "
              f"(<2% of the largest). Check --figures and the keyed edges.")

    # Detached pieces that belong to a figure - a whisker tip, Nogo's floating
    # fish-skeleton crown - join the nearest one. Single-pixel keying specks fall
    # below the floor and are dropped, so they cannot show up in a sprite.
    groups = {label: [label] for label in figures}
    floor = min(mass[label - 1] for label in figures) * 0.0005
    for label in leftovers:
        if mass[label - 1] >= floor:
            nearest = min(figures, key=lambda f: abs(centre[f] - centre[label]))
            groups[nearest].append(label)

    masks = [np.isin(labels, members) for members in groups.values()]
    return sorted(masks, key=lambda m: np.flatnonzero(m.any(axis=0)).mean())


def bounds(mask: np.ndarray) -> tuple:
    """Tight (x0, y0, x1, y1) box around a figure mask."""
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def crop_boxes(masks: list) -> list:
    """One common square per figure: same size, same baseline, centred on itself.

    See the module docstring - this is where the relative size of the three
    phases is preserved.
    """
    boxes = [bounds(m) for m in masks]

    baseline = max(b[3] for b in boxes)
    tallest = baseline - min(b[1] for b in boxes)
    widest = max(b[2] - b[0] for b in boxes)
    side = int(round(max(tallest, widest) / FILL))
    margin = int(round(side * (1 - FILL) / 2))

    squares = []
    for x0, _, x1, _ in boxes:
        centre = (x0 + x1) // 2
        left = centre - side // 2
        bottom = baseline + margin
        squares.append((left, bottom - side, left + side, bottom))
    return squares


def cut(rgba: np.ndarray, mask: np.ndarray, box: tuple, size: int, mirror: bool = False) -> Image.Image:
    """Erase the other figures, crop the square, then bleed, resize and mirror.

    Cropping before the bleed keeps the nearest-opaque-colour search inside this
    figure's own square, which is both cheaper and the only correct scope - a
    bleed run over the whole sheet would hand a figure its neighbour's colours.
    """
    figure = rgba.copy()
    figure[..., 3] = np.where(mask, rgba[..., 3], 0)
    # Crop past the sheet edge pads with transparent pixels, which is what a
    # figure standing near the margin needs.
    square = np.array(Image.fromarray(figure).crop(box))
    image = Image.fromarray(bleed_edges(square)).resize((size, size), Image.LANCZOS)
    return ImageOps.mirror(image) if mirror else image


def process(sheet, out_dir: Path = None, size: int = SIZE, fmt: str = FORMAT,
            figures: int = FIGURES, quality: int = QUALITY, mirror: bool = False) -> list:
    """Cut one sheet into `figures` sprites named `<sheet>_cut<n>.<fmt>`.

    Every argument but the sheet has a default, so `process(sheet)` is a whole
    call - that is what makes the SHEETS table at the top of this file readable.
    """
    path = resolve_sheet(sheet)
    out_dir = path.parent if out_dir is None else Path(out_dir)

    rgba = load_rgba(path)
    transparent = (rgba[..., 3] < 250).mean()
    if transparent >= ALREADY_KEYED_FRACTION:
        rgba = harden_alpha(rgba)
        note = f"already keyed ({(rgba[..., 3] == 0).mean():.0%} transparent, matte hardened)"
    else:
        rgba = key_background(rgba)
        note = f"keyed background ({(rgba[..., 3] < 250).mean():.0%} transparent)"

    masks = find_figures(rgba[..., 3], figures)
    boxes = crop_boxes(masks)

    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for i, (mask, box) in enumerate(zip(masks, boxes), start=1):
        target = out_dir / f"{path.stem}_cut{i}.{fmt}"
        image = cut(rgba, mask, box, size, mirror)
        if fmt == "webp":
            image.save(target, "WEBP", quality=quality, alpha_quality=100, method=6)
        else:
            image.save(target, optimize=True)
        written.append(target)

    kb = sum(f.stat().st_size for f in written) / 1024
    names = f"{path.stem}_cut1..{len(written)}.{fmt}"
    flipped = ", mirrored" if mirror else ""
    print(f"{path.name}: {note}, {len(boxes)} figures{flipped}, {size}x{size} -> {names} ({kb:.0f}KB total)")
    return written


def install(written: list, level: str) -> None:
    """Copy the cuts over `game/assets/<level>/player_1..N` and drop old-format copies.

    The cuts are named after their sheet so several variants can sit side by side;
    the engine wants player_1..3, so they are renamed on the way in. A `player_N`
    in another format is deleted rather than left beside the new one - two copies
    of one sprite is how a project ends up loading the wrong one. The engine loads
    these by name, so if the extension changed, game/assets.js and the levels'
    load() calls have to follow.
    """
    destination = GAME_ASSETS / level
    if not destination.is_dir():
        raise SystemExit(f"no such level folder: {destination}")
    suffix = written[0].suffix
    removed = []
    for i, source in enumerate(written, start=1):
        for stale in destination.glob(f"player_{i}.*"):
            if stale.suffix != suffix:
                stale.unlink()
                removed.append(stale.name)
        shutil.copy2(source, destination / f"player_{i}{suffix}")
    print(f"  installed {len(written)} sprites into {destination} as player_1..{len(written)}{suffix}")
    if removed:
        print(f"  removed {', '.join(removed)} - point game/assets.js and game/levels/{level}.js "
              f"at {suffix} if they do not already")


def remove_checks(folder: Path = None) -> None:
    """Delete `_check` contact strips left by earlier versions of this script."""
    folder = HERE if folder is None else Path(folder)
    for stale in sorted(folder.glob("*_check.*")):
        stale.unlink()
        print(f"removed stale {stale.name}")


def _default_argv() -> list:
    """The command-line arguments, or none when there is no command line.

    Under an interactive kernel (Jupyter, VS Code interactive window) sys.argv
    belongs to ipykernel_launcher and carries flags like `--f=...kernel.json`,
    which argparse would reject. There are no user arguments in that case, so
    fall back to an empty list and cut the SHEETS table.
    """
    if "ipykernel" in sys.modules:
        return []
    return sys.argv[1:]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sheets", nargs="*",
                        help="Sheets to cut, by path or bare name. Default: the SHEETS table in this file.")
    parser.add_argument("--out", type=Path, default=None, help="Where the cuts go. Default: beside the sheet.")
    parser.add_argument("--mirror", action="store_true",
                        help="Flip each cut horizontally (sprites must face left; see the docstring).")
    parser.add_argument("--install", nargs="?", const=True, metavar="LEVEL",
                        help="Also copy over game/assets/<LEVEL>/player_N.*. With no sheets named, "
                             "a bare --install sends each SHEETS entry to its own level.")
    parser.add_argument("--size", type=int, default=SIZE, help=f"Output square, px. Default: {SIZE}.")
    parser.add_argument("--format", choices=("webp", "png"), default=FORMAT, help=f"Default: {FORMAT}.")
    parser.add_argument("--quality", type=int, default=QUALITY, help=f"WebP quality. Default: {QUALITY}.")
    parser.add_argument("--figures", type=int, default=FIGURES, help=f"Figures per sheet. Default: {FIGURES}.")
    args = parser.parse_args(_default_argv() if argv is None else argv)

    if args.sheets:
        if args.install is True:
            raise SystemExit("--install needs the level name when sheets are named explicitly")
        if args.install and len(args.sheets) > 1:
            raise SystemExit("--install takes one sheet at a time, so the right variant lands in the game")
        jobs = [{"sheet": s, "level": args.install, "mirror": args.mirror} for s in args.sheets]
    else:
        # The table knows each sheet's level and facing, so a bare --install can
        # fan out to the right level per entry; a named level or --mirror would
        # apply to every entry alike, which is never what is meant.
        if isinstance(args.install, str) or args.mirror:
            raise SystemExit("name the sheet when passing --install LEVEL or --mirror")
        jobs = [{**job, "level": job["level"] if args.install else None} for job in SHEETS]

    remove_checks(args.out)
    for job in jobs:
        written = process(job["sheet"], args.out, args.size, args.format, args.figures,
                          args.quality, job.get("mirror", False))
        if job.get("level"):
            install(written, job["level"])


if __name__ == "__main__":
    main()
