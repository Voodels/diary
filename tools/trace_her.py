import os
import sys
import glob
import vtracer
from PIL import Image

ART = "art"

def find_source():
    skip = lambda b: b.startswith("work-") or b.startswith("test-")
    for e in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp"):
        for p in sorted(glob.glob(os.path.join(ART, e))):
            if not skip(os.path.basename(p)):
                return p
    return None

src = find_source()
if not src:
    print("NO_SOURCE")
    sys.exit(0)

im = Image.open(src).convert("RGB")
w, h = im.size
print(f"source: {src} {w}x{h}")

full = im.copy()
full.thumbnail((700, 1100))
full.save(os.path.join(ART, "work-full.png"))

gate = im.crop((0, 0, w, int(h * 0.31)))
gate.thumbnail((420, 520))
gate.save(os.path.join(ART, "work-gate.png"))

def trace(s, d, speckle, diff):
    vtracer.convert_image_to_svg_py(
        s, d,
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=speckle,
        color_precision=7,
        layer_difference=diff,
        corner_threshold=60,
        length_threshold=4.0,
    )

trace(os.path.join(ART, "work-full.png"), os.path.join(ART, "her-full.svg"), 4, 16)
trace(os.path.join(ART, "work-gate.png"), os.path.join(ART, "her-gate.svg"), 5, 20)

for f in ("her-full.svg", "her-gate.svg"):
    p = os.path.join(ART, f)
    print(f, round(os.path.getsize(p) / 1024, 1), "KB")
print("DONE")
