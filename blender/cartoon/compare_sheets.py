"""Put each character sheet next to its renders (prompt 2-5). Run with any Python that has Pillow:

    python blender/cartoon/compare_sheets.py [sax bass frontman]

Writes blender/cartoon/previews/<tag>_compare.png: sheet | front | 3/4 | side   /   solo | emerge | return | exported GLB
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PREVIEWS = os.path.join(HERE, "previews")
CELLS = ["sheet", "front", "34", "side", "solo", "emerge", "return", "glb"]
SIZE = 384


def compare(tag):
    sheet = os.path.join(ROOT, "reference", tag + ".png")
    out = Image.new("RGB", (SIZE * 4, SIZE * 2), "white")
    draw = ImageDraw.Draw(out)
    for i, cell in enumerate(CELLS):
        path = sheet if cell == "sheet" else os.path.join(PREVIEWS, "%s_%s.png" % (tag, cell))
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert("RGB").resize((SIZE, SIZE))
        x, y = (i % 4) * SIZE, (i // 4) * SIZE
        out.paste(im, (x, y))
        draw.rectangle((x, y, x + 80, y + 18), fill="white")
        draw.text((x + 4, y + 3), cell, fill="black")
    path = os.path.join(PREVIEWS, tag + "_compare.png")
    out.save(path)
    print(path)


if __name__ == "__main__":
    for tag in sys.argv[1:] or ["sax", "bass", "frontman"]:
        compare(tag)
