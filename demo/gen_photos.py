"""Generate the dish photos with the Codex CLI image tool, one Codex run per photo.

    python3 demo/gen_photos.py                 # every missing photo
    python3 demo/gen_photos.py mango-sticky-rice cashew-chicken   # redo these

Needs `codex` logged in. Raw PNGs land in demo/photos/raw/, the menu uses the JPEGs
written next to them by prepare_photos() (1200 px square, ~85 quality).
"""

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

DEMO = Path(__file__).resolve().parent
PHOTOS = DEMO / "photos"
RAW = PHOTOS / "raw"
PARALLEL = 5


def generate(slug: str, style: str, subject: str) -> str:
    out = RAW / f"{slug}.png"
    out.unlink(missing_ok=True)
    prompt = (
        "Use your built-in image generation tool to create exactly ONE photorealistic image and save it "
        f"as {out} (copy the generated PNG there; do not draw it with code). Then print the saved path.\n\n"
        f"Image: {subject}\n\n{style}"
    )
    cmd = [
        "codex", "exec", "--skip-git-repo-check", "-s", "workspace-write",
        "-C", str(RAW), "-c", "skills.include_instructions=false",
        "-c", 'model_reasoning_effort="low"', prompt,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=420)
    ok = out.exists() and out.stat().st_size > 50_000
    return f"{slug}: {'ok' if ok else 'FAILED (exit %d)' % res.returncode}"


def prepare_photos() -> None:
    for png in sorted(RAW.glob("*.png")):
        jpg = PHOTOS / f"{png.stem}.jpg"
        if jpg.exists() and jpg.stat().st_mtime >= png.stat().st_mtime:
            continue
        img = Image.open(png).convert("RGB")
        side = min(img.size)
        left, top = (img.width - side) // 2, (img.height - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize((1200, 1200), Image.LANCZOS)
        img.save(jpg, "JPEG", quality=85, optimize=True, progressive=True)
        print(f"wrote {jpg.relative_to(DEMO)}")


def main() -> None:
    spec = json.loads((DEMO / "photo_prompts.json").read_text())
    RAW.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or [s for s in spec["photos"] if not (RAW / f"{s}.png").exists()]
    with ThreadPoolExecutor(PARALLEL) as pool:
        for line in pool.map(lambda s: generate(s, spec["style"], spec["photos"][s]), wanted):
            print(line, flush=True)
    prepare_photos()


if __name__ == "__main__":
    main()
