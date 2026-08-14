from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

size = 1024
image = Image.new("RGBA", (size, size), (5, 16, 31, 255))
draw = ImageDraw.Draw(image)

# Layered cool-blue field.
for radius, alpha in [(430, 22), (330, 32), (230, 42)]:
    box = (
        size // 2 - radius,
        size // 2 - radius,
        size // 2 + radius,
        size // 2 + radius,
    )
    draw.ellipse(box, fill=(35, 185, 255, alpha))

# Rounded app tile and a compact D-shaped harness mark.
margin = 84
draw.rounded_rectangle(
    (margin, margin, size - margin, size - margin),
    radius=210,
    fill=(8, 27, 48, 255),
    outline=(83, 211, 255, 180),
    width=10,
)

cyan = (94, 222, 255, 255)
blue = (68, 125, 255, 255)
dark = (8, 27, 48, 255)
draw.rounded_rectangle((280, 240, 430, 784), radius=74, fill=cyan)
draw.pieslice((285, 240, 790, 784), start=270, end=90, fill=cyan)
draw.pieslice((405, 365, 665, 659), start=270, end=90, fill=dark)
draw.rectangle((405, 365, 535, 659), fill=dark)

# Three plugin nodes connected through the D spine.
nodes = [(352, 350), (352, 512), (352, 674)]
for index, (x, y) in enumerate(nodes):
    draw.line((x, y, 575 + index * 34, y), fill=blue, width=22)
    draw.ellipse((x - 38, y - 38, x + 38, y + 38), fill=(223, 249, 255, 255))
    draw.ellipse(
        (575 + index * 34 - 30, y - 30, 575 + index * 34 + 30, y + 30),
        fill=blue,
    )

png_path = ASSETS / "icon.png"
ico_path = ASSETS / "icon.ico"
image.save(png_path, optimize=True)
image.save(
    ico_path,
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(png_path)
print(ico_path)
