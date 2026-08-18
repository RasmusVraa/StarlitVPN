"""Build crisp StarlitVPN icons from a high-res lock PNG."""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"


def hue_shift_to_purple(im: Image.Image, target_h: float = 0.75) -> Image.Image:
    im = im.convert("RGBA")
    pix = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a < 8:
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < 0.18 or v < 0.22:
                pix[x, y] = (r, g, b, a)
                continue
            hh = 0.73
            s = min(1.0, s * 1.08)
            nr, ng, nb = colorsys.hsv_to_rgb(hh, s, v)
            pix[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def trim(im: Image.Image, pad: int = 8) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    im = im.crop(bbox)
    canvas = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad), im)
    return canvas


def rounded_bg(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(6, size * 22 // 100)
    # gradient purple square
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(168 - t * 40)
        g = int(130 - t * 20)
        b = int(255 - t * 18)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0))
    out.putalpha(mask)
    return out


def fit_lock(lock: Image.Image, size: int, margin: float = 0.14) -> Image.Image:
    inner = int(size * (1 - 2 * margin))
    lock = lock.copy()
    lock.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    bg = rounded_bg(size)
    x = (size - lock.width) // 2
    y = (size - lock.height) // 2 + max(0, size // 40)
    bg.alpha_composite(lock, (x, y))
    return bg


def draw_crisp_lock(size: int) -> Image.Image:
    """Sharp geometric lock for 16/32 toolbar sizes."""
    img = rounded_bg(size)
    d = ImageDraw.Draw(img)
    m = max(1, size // 16)
    # body
    x0, y0 = int(size * 0.28), int(size * 0.48)
    x1, y1 = int(size * 0.72), int(size * 0.84)
    d.rounded_rectangle((x0, y0, x1, y1), radius=max(2, size // 10), fill=(255, 255, 255, 255))
    # shackle
    sw = max(2, size // 8)
    sx0, sx1 = int(size * 0.36), int(size * 0.64)
    top = int(size * 0.22)
    d.arc((sx0, top, sx1, y0 + sw), 200, 340, fill=(255, 255, 255, 255), width=sw)
    d.line((sx0, top + (y0 - top) // 2, sx0, y0 + 1), fill=(255, 255, 255, 255), width=sw)
    d.line((sx1, top + (y0 - top) // 2, sx1, y0 + 1), fill=(255, 255, 255, 255), width=sw)
    # keyhole
    cx = size // 2
    ky = int((y0 + y1) / 2) - m
    kh = max(1, size // 14)
    d.ellipse((cx - kh, ky - kh, cx + kh, ky + kh), fill=(92, 74, 196, 255))
    d.polygon([(cx - kh // 2, ky), (cx + kh // 2, ky), (cx + 1, y1 - m * 2), (cx - 1, y1 - m * 2)], fill=(92, 74, 196, 255))
    return img


def pick_source() -> Image.Image:
    for name in ("fluent-3d.png",):
        path = ICONS / name
        if path.exists() and path.stat().st_size > 8000:
            im = Image.open(path).convert("RGBA")
            # treat near-black as transparent
            pix = im.load()
            w, h = im.size
            for y in range(h):
                for x in range(w):
                    r, g, b, a = pix[x, y]
                    if r + g + b < 30:
                        pix[x, y] = (r, g, b, 0)
            return trim(im)
    raise SystemExit("no source icon")


def main() -> None:
    src = pick_source()
    # If source is yellow fluent lock, shift to purple
    sample = src.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    r, g, b = sample[:3]
    h, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if s > 0.2 and (h < 0.2 or h > 0.9):
        src = hue_shift_to_purple(src)

    logo = fit_lock(src, 256, 0.12)
    logo.save(ICONS / "logo.png", "PNG")
    fit_lock(src, 128, 0.12).save(ICONS / "icon-128.png", "PNG")
    fit_lock(src, 48, 0.12).save(ICONS / "icon-48.png", "PNG")
    fit_lock(src, 32, 0.10).save(ICONS / "icon-32.png", "PNG")
    draw_crisp_lock(16).save(ICONS / "icon-16.png", "PNG")
    print("wrote", ICONS)


if __name__ == "__main__":
    main()
