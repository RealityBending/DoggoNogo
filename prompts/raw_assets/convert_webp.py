"""Step 1 of the asset pipeline: re-encode every raw image in this folder as WebP.

The prompts in `prompts/make_prompts.py` ask an image model for artwork. What
comes back is PNG or JPEG - several megabytes apiece for painterly art that
carries no fine detail. This script re-encodes each one as WebP beside itself and
deletes the original, so the folder converges on one format and never carries two
copies of the same picture. Step 2, `cut_sprites.py`, then reads the WebP sheets.

Usage:
    python prompts/raw_assets/convert_webp.py                     # this folder
    python prompts/raw_assets/convert_webp.py --dry-run           # list, change nothing
    python prompts/raw_assets/convert_webp.py level1_player_v4.png some/folder
    python prompts/raw_assets/convert_webp.py --lossless --quality 95

Running the file in a Jupyter / VS Code interactive window converts this folder,
the same as running it with no flags. Or call the function yourself:

    convert_to_webp()                              # this folder
    convert_to_webp("game/assets", dry_run=True)   # look before you leap

WHAT IS KEPT
------------
Transparency. `Image.open` keeps the alpha channel and WebP stores it, and the
alpha plane is encoded losslessly (`alpha_quality=100`) even when the colour is
lossy, so a keyed sheet's matte survives the trip bit for bit. Palette (`P`) and
greyscale images are promoted to RGBA first, because WebP has no palette mode and
Pillow would otherwise drop their transparency.

WHAT IS SKIPPED
---------------
Anything that is not an image (this .py, notes). Subfolders are not entered: pass
them explicitly.

`game/assets/` is deliberately NOT a default target. Converting it renames files
the game loads by name, so `game/assets.js` and every level's `load()` would have
to change in the same commit or the game 404s. Pointing this at it is allowed, but
warns.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image


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
    """Nearest ancestor that holds `game/assets`, so the warning below can spot it."""
    for folder in (start, *start.parents):
        if (folder / "game" / "assets").is_dir():
            return folder
    return start


HERE = _script_folder()
GAME_ASSETS = _repo_root(HERE) / "game" / "assets"

# What gets re-encoded. Deliberately a whitelist: the folder also holds .py files
# and stray notes, and a blacklist would eventually eat something it should not.
CONVERT_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff")

# One default for the command line and the notebook path, so they cannot drift.
QUALITY = 92


def to_webp(path: Path, quality: int = QUALITY, lossless: bool = False) -> tuple:
    """Re-encode one image as WebP beside itself and delete the original.

    Returns (bytes_before, bytes_after), or None if there was nothing to do.

    The original is removed rather than left beside the new file: two copies of
    one picture in an asset folder is how a project ends up loading the wrong one.
    It is only unlinked once the replacement is on disk, so a failed encode loses
    nothing.
    """
    path = Path(path)
    if path.suffix.lower() == ".webp":
        return None
    target = path.with_suffix(".webp")
    before = path.stat().st_size
    with Image.open(path) as image:
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA")
        if lossless:
            image.save(target, "WEBP", lossless=True, method=6)
        else:
            image.save(target, "WEBP", quality=quality, alpha_quality=100, method=6)
    if target.resolve() != path.resolve():
        path.unlink()
    return before, target.stat().st_size


def find_convertible(target: Path = None) -> list:
    """Images the step would touch: a single file, or one folder's worth (not recursive)."""
    target = HERE if target is None else Path(target)
    if target.is_file():
        return [target] if target.suffix.lower() in CONVERT_EXTS else []
    return sorted(f for f in target.iterdir() if f.is_file() and f.suffix.lower() in CONVERT_EXTS)


def convert_to_webp(target: Path = None, quality: int = QUALITY, lossless: bool = False,
                    dry_run: bool = False) -> list:
    """Convert every non-WebP image in `target` (file or folder), in place.

    `dry_run` lists what would be converted and touches nothing, which is the sane
    first move when pointing this at a folder the game actually loads.
    """
    target = HERE if target is None else Path(target)
    files = find_convertible(target)
    if not files:
        print(f"webp: nothing to convert in {target}")
        return []

    if dry_run:
        total = sum(f.stat().st_size for f in files)
        print(f"webp: would convert {len(files)} file(s) in {target} ({total / 1e6:.1f} MB)")
        for f in files:
            print(f"    {f.name}")
        return files

    done, before_total, after_total = [], 0, 0
    for f in files:
        result = to_webp(f, quality, lossless)
        if not result:
            continue
        before, after = result
        before_total += before
        after_total += after
        done.append(f.with_suffix(".webp"))
        # Signed, because a small already-lossy JPEG can come out marginally bigger
        # as WebP. That is a fine trade for one format in the folder, but it should
        # not be reported as a saving.
        change = 100 * (after / before - 1)
        print(f"    {f.name} -> {f.stem}.webp  {before / 1024:.0f}KB -> {after / 1024:.0f}KB "
              f"({change:+.0f}%)")
    if done:
        saved = (before_total - after_total) / 1e6
        print(f"webp: converted {len(done)} file(s), {before_total / 1e6:.1f} MB -> "
              f"{after_total / 1e6:.1f} MB (saved {saved:.1f} MB)")
    return done


def _default_argv() -> list:
    """The command-line arguments, or none when there is no command line.

    Under an interactive kernel (Jupyter, VS Code interactive window) sys.argv
    belongs to ipykernel_launcher and carries flags like `--f=...kernel.json`,
    which argparse would reject. There are no user arguments in that case.
    """
    if "ipykernel" in sys.modules:
        return []
    return sys.argv[1:]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="*", type=Path,
                        help="Files or folders to convert. Default: this folder.")
    parser.add_argument("--quality", type=int, default=QUALITY, help=f"WebP quality. Default: {QUALITY}.")
    parser.add_argument("--lossless", action="store_true",
                        help="Encode losslessly (bigger; for anything you will re-edit pixel by pixel).")
    parser.add_argument("--dry-run", action="store_true",
                        help="List what would be converted and change nothing.")
    args = parser.parse_args(_default_argv() if argv is None else argv)

    targets = args.paths or [HERE]
    for target in targets:
        if not target.exists():
            raise SystemExit(f"no such path: {target}")
        resolved = target.resolve()
        if (GAME_ASSETS in resolved.parents or resolved == GAME_ASSETS) and not args.dry_run:
            print(f"  WARNING: {target} is loaded by the game. Converting it renames files, so "
                  f"every .png in game/assets.js and the levels' load() calls has to change to "
                  f".webp in the same commit, or the game will 404.")
        convert_to_webp(target, args.quality, args.lossless, args.dry_run)


if __name__ == "__main__":
    main()
