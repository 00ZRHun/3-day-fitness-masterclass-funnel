#!/usr/bin/env python3
"""Build optimised, responsive image assets for the ApexFitness funnel.

Source photography is from Unsplash (free to use under the Unsplash licence).
Run from the project root:

    python3 tools/build_assets.py

The script downloads sources into a temporary cache, then writes WebP variants
used by the page, plus the social card icons. Requires Pillow.
"""

from __future__ import annotations

import io
import tempfile
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images"
FONT_TTF = Path("/tmp/fit-assets-test/fonts")

UNSPLASH = "https://images.unsplash.com/{photo}?w=2000&q=90&auto=format&fit=crop"
SOURCES = {
    # hero
    "hero-athlete": ("photo-1548690312-e3b507d8c110", (0.5, 0.35), "3:4"),
    "hero-class": ("photo-1571902943202-507ec2618e8f", (0.5, 0.45), "4:3"),
    "hero-dumbbells": ("photo-1534438327276-14e5300c3a48", (0.5, 0.5), "4:3"),
    # movement cards
    "move-arms": ("photo-1581009146145-b5ef050c2e1e", (0.5, 0.42), "4:3"),
    "move-core": ("photo-1566241142559-40e1dab266c6", (0.5, 0.5), "4:3"),
    "move-chest": ("photo-1594737625785-a6cbdabd333c", (0.5, 0.5), "4:3"),
    "move-legs": ("photo-1541534741688-6078c6bfb5c5", (0.5, 0.4), "4:3"),
    "move-back": ("photo-1526506118085-60ce8714f8c5", (0.5, 0.45), "4:3"),
    "move-shoulders": ("photo-1599901860904-17e6ed7083a0", (0.5, 0.45), "4:3"),
    # coaches
    "coach-maya": ("photo-1548690312-e3b507d8c110", (0.48, 0.25), "4:5"),
    "coach-andre": ("photo-1549476464-37392f717541", (0.5, 0.35), "4:5"),
    # social proof avatars
    "avatar-sarah": ("photo-1494790108377-be9c29b29330", (0.5, 0.4), "1:1"),
    "avatar-marcus": ("photo-1500648767791-00dcc994a43e", (0.5, 0.4), "1:1"),
    "avatar-priya": ("photo-1534528741775-53994a69daeb", (0.5, 0.4), "1:1"),
    # bonuses
    "bonus-nutrition": ("photo-1490645935967-10de6ba17061", (0.5, 0.5), "4:3"),
    "bonus-class": ("photo-1571902943202-507ec2618e8f", (0.5, 0.5), "4:3"),
    "bonus-equipment": ("photo-1584735935682-2f2b69dff9d2", (0.5, 0.5), "4:3"),
}
RATIOS = {
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "4:5": 4 / 5,
    "1:1": 1.0,
}
SIZES = {
    "hero-athlete": [480, 720, 1040],
    "hero-class": [360, 560],
    "hero-dumbbells": [360, 560],
    "move-arms": [560, 840],
    "move-core": [560, 840],
    "move-chest": [560, 840],
    "move-legs": [560, 840],
    "move-back": [560, 840],
    "move-shoulders": [560, 840],
    "coach-maya": [320, 640],
    "coach-andre": [320, 640],
    "avatar-sarah": [96, 160],
    "avatar-marcus": [96, 160],
    "avatar-priya": [96, 160],
    "bonus-nutrition": [420, 760],
    "bonus-class": [320, 560],
    "bonus-equipment": [320, 560],
}

download_cache = Path(tempfile.mkdtemp(prefix="apex-assets-"))


def fetch(photo: str) -> Image.Image:
    url = UNSPLASH.format(photo=photo)
    cache = download_cache / f"{photo}.jpg"
    if not cache.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "ApexFitnessAssetBuilder/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            cache.write_bytes(response.read())
    return Image.open(cache).convert("RGB")


def fit(image: Image.Image, ratio: float, centering: tuple[float, float], width: int) -> Image.Image:
    height = round(width / ratio)
    return ImageOps.fit(
        image,
        (width, height),
        method=Image.Resampling.LANCZOS,
        centering=centering,
    )


def save_webp(image: Image.Image, path: Path, quality: int = 82) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6)


def build_photos() -> None:
    for name, (photo, centering, aspect) in SOURCES.items():
        ratio = RATIOS[aspect]
        source = fetch(photo)
        for width in SIZES[name]:
            image = fit(source, ratio, centering, width)
            save_webp(image, OUT / f"{name}-{width}.webp")
        print(f"  built {name}: {', '.join(str(width) for width in SIZES[name])}")


def build_social_card() -> None:
    width, height = 1200, 630
    card = Image.new("RGB", (width, height), "#070d1d")
    photo = fit(fetch(SOURCES["hero-athlete"][0]), 0.72, (0.5, 0.25), 620)

    # Blue glow behind the photo.
    glow = Image.new("L", (width, height), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((720, -220, 1380, 720), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    blue = Image.new("RGB", (width, height), "#2f5bff")
    card = Image.composite(blue, card, glow)

    # Soft gradient scrim over the photo edge.
    scrim = Image.new("RGBA", photo.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for x in range(photo.width):
        alpha = int(210 * max(0, (x - 150) / photo.width))
        sd.line((x, 0, x, photo.height), fill=(7, 13, 29, alpha))
    photo = Image.alpha_composite(photo.convert("RGBA"), scrim).convert("RGB")
    card.paste(photo, (width - photo.width, 0))

    draw = ImageDraw.Draw(card)
    try:
        display = ImageFont.truetype(str(FONT_TTF / "Anton-Regular.ttf"), 82)
        display_sm = ImageFont.truetype(str(FONT_TTF / "Anton-Regular.ttf"), 46)
        body_bold = ImageFont.truetype(str(FONT_TTF / "Manrope-Variable.ttf"), 22)
        body = ImageFont.truetype(str(FONT_TTF / "Manrope-Variable.ttf"), 19)
        small = ImageFont.truetype(str(FONT_TTF / "Manrope-Variable.ttf"), 16)
    except OSError:
        display = ImageFont.load_default()
        display_sm = display
        body_bold = body = small = display

    # Monogram.
    draw.rounded_rectangle((68, 56, 106, 94), 10, fill="#2f5bff")
    draw.text((77, 61), "A", font=body_bold, fill="white")
    draw.text((116, 66), "APEXFITNESS", font=body_bold, fill="#e9eefc")

    draw.text((68, 138), "3-DAY LIVE STRENGTH MASTERCLASS", font=small, fill="#84a4ff")
    draw.text((68, 178), "SCULPT", font=display, fill="#ffffff")
    draw.text((68, 258), "YOUR BODY.", font=display, fill="#ffffff")
    draw.text((68, 338), "MASTER YOUR FORM.", font=display_sm, fill="#8fb0ff")

    draw.rounded_rectangle((68, 430, 510, 494), 32, fill="#ffffff")
    draw.text((96, 444), "NEXT COHORT · NOV 6–8", font=body_bold, fill="#0a1024")
    draw.text((68, 526), "6 hours of expert coaching  ·  20 spots  ·  $299", font=body, fill="#aab7d4")
    draw.text((68, 566), "apexfitness.com", font=small, fill="#7283a8")

    # Frosted rating pill.
    draw.rounded_rectangle((792, 500, 1134, 574), 18, fill="#ffffff")
    draw.text((814, 514), "★★★★★", font=body_bold, fill="#f2a52b")
    draw.text((814, 541), "4.9 from 1,241 members", font=small, fill="#2a3550")

    card.save(ROOT / "assets" / "og-image.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    print("  built assets/og-image.jpg")


def build_icons() -> None:
    icon = Image.new("RGBA", (180, 180), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    # Vertical gradient tile.
    for y in range(180):
        t = y / 179
        r = int(47 + (24 - 47) * t)
        g = int(91 + (33 - 91) * t)
        b = int(255 + (78 - 255) * t)
        draw.line((0, y, 180, y), fill=(r, g, b, 255))
    mask = Image.new("L", (180, 180), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 180, 180), 40, fill=255)
    icon.putalpha(mask)
    try:
        font = ImageFont.truetype(str(FONT_TTF / "Anton-Regular.ttf"), 118)
    except OSError:
        font = ImageFont.load_default()
    draw.text((90, 96), "A", font=font, fill="white", anchor="mm")
    draw.ellipse((128, 34, 146, 52), fill="#d8ff6b")
    icon.save(ROOT / "assets" / "apple-touch-icon.png")
    print("  built assets/apple-touch-icon.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_photos()
    build_social_card()
    build_icons()
    print("Done.")
