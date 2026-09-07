"""frames-to-gif.py — assemble the PNG frames captured by tools/record-demo.mjs into the README GIF.

Reads a manifest written by the recorder:

    {"out": "...gif", "width": 1000, "frames": [{"file": "...png", "ms": 110}, ...]}

Each frame is downscaled to `width` with Lanczos (captured at 2x, so the SQL text stays crisp), then
every frame is quantised against ONE shared palette. A shared palette matters twice over: it stops
colours shimmering between frames, and it lets GIF's inter-frame compression do its job, which is
what keeps the file small enough for a README.

Consecutive identical frames are merged into a single frame with a longer duration, so the long
"hold" beats cost one frame each rather than thirty.

    python tools/frames-to-gif.py <manifest.json>

Requires Pillow. ffmpeg is deliberately not used.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def main() -> int:
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(manifest["out"])
    width = int(manifest.get("width", 1000))
    entries = manifest["frames"]
    if not entries:
        print("no frames in manifest", file=sys.stderr)
        return 1

    # Load and downscale.
    images: list[Image.Image] = []
    durations: list[int] = []
    for entry in entries:
        im = Image.open(entry["file"]).convert("RGB")
        if im.width != width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        images.append(im)
        durations.append(int(entry["ms"]))

    # Merge runs of identical frames into one long-duration frame.
    merged: list[Image.Image] = []
    merged_ms: list[int] = []
    for im, ms in zip(images, durations):
        if merged and ImageChops.difference(merged[-1], im).getbbox() is None:
            merged_ms[-1] += ms
            continue
        merged.append(im)
        merged_ms.append(ms)
    print(f"  {len(images)} captured frames -> {len(merged)} distinct frames")

    # One shared 256-colour palette, derived from a strip of frames sampled across the whole reel so
    # every screen (question, spec, SQL, funnel) gets a say in it.
    step = max(1, len(merged) // 12)
    sample = merged[::step]
    strip = Image.new("RGB", (sample[0].width, sample[0].height * len(sample)))
    for i, im in enumerate(sample):
        strip.paste(im, (0, i * im.height))
    palette = strip.quantize(colors=256, method=Image.MEDIANCUT)

    # No dithering: on this flat, dark UI it costs nothing visually, and it keeps large areas of
    # each frame byte-identical to the last, which is what GIF compression feeds on. Dithering the
    # same frames with Floyd-Steinberg triples the file (8.0 MB vs 2.6 MB) for no legibility gain.
    quantised = [im.quantize(palette=palette, dither=Image.NONE) for im in merged]

    out.parent.mkdir(parents=True, exist_ok=True)
    quantised[0].save(
        out,
        save_all=True,
        append_images=quantised[1:],
        duration=merged_ms,
        loop=0,        # loop forever
        optimize=True,
        disposal=1,    # leave the previous frame in place; frames are full-viewport anyway
    )
    total = sum(merged_ms) / 1000
    size_mb = out.stat().st_size / 1024 / 1024
    print(f"  {out}  {quantised[0].width}x{quantised[0].height}  {total:.1f}s  {size_mb:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
