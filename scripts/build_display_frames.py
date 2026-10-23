"""Rebuild display-sized derivatives from the transparent full-resolution frames."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
from PIL import Image
from extract_frames import FRAME_COUNT, WIDTH, HEIGHT, TIERS


def build_frame(source, tiers=TIERS):
    total = 0
    with Image.open(source) as image:
        if image.size != (WIDTH, HEIGHT):
            raise ValueError(f'Unexpected frame size: {source}: {image.size}')
        image = image.convert('RGBA')
        for width, height in tiers:
            directory = source.parent / f'display-{width}'
            directory.mkdir(exist_ok=True)
            target = directory / source.name
            image.resize((width, height), Image.Resampling.LANCZOS).save(target, 'WEBP',
                quality=90, alpha_quality=100, method=4)
            total += target.stat().st_size
    return total


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parent.parent / 'public' / 'kid')
    parser.add_argument('--width', type=int, choices=[width for width, _ in TIERS])
    args = parser.parse_args()
    tiers = tuple(tier for tier in TIERS if args.width is None or tier[0] == args.width)
    sources = [args.source / f'kid_{i}.webp' for i in range(1, FRAME_COUNT + 1)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        total = sum(pool.map(lambda source: build_frame(source, tiers), sources))
    print(f'Generated {len(sources) * len(tiers)} display frames: {total/1024**2:.2f} MiB')
