"""Extract native 24 FPS transformation frames and key only the green background.

Development requirements: Pillow, NumPy, FFmpeg. Never overwrite an existing output directory.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import argparse
import json
import subprocess
import numpy as np

FRAME_COUNT = 241
FPS = 24
WIDTH, HEIGHT = 1280, 720
TIERS = ((360, 203), (640, 360), (960, 540))


def remove_green(rgb):
    """Green-dominance key; white clothing/cards/feathers are not color-keyed away."""
    values = rgb.astype(np.float32)
    border = np.concatenate((values[:20].reshape(-1, 3), values[-20:].reshape(-1, 3),
                             values[:, :20].reshape(-1, 3), values[:, -20:].reshape(-1, 3)))
    green = (border[:, 1] - np.maximum(border[:, 0], border[:, 2])) > 70
    key = np.median(border[green], axis=0) if green.any() else np.array([43, 190, 39], dtype=np.float32)
    key_dominance = float(key[1] - max(key[0], key[2]))
    threshold = max(75, key_dominance * 0.8)
    dominance = values[:, :, 1] - np.maximum(values[:, :, 0], values[:, :, 2])
    alpha = np.clip((threshold - dominance) / (threshold - 18), 0, 1)
    alpha[alpha < 0.015] = 0
    safe_alpha = np.maximum(alpha[:, :, None], 1 / 255)
    color = np.clip((values - (1 - safe_alpha) * key) / safe_alpha, 0, 255)
    # Spill suppression is limited to semi-transparent key edges, never solid white interiors.
    edge = (alpha > 0) & (alpha < 0.999)
    color[:, :, 1][edge] = np.minimum(color[:, :, 1][edge],
        np.maximum(color[:, :, 0][edge], color[:, :, 2][edge]) + 4)
    rgba = np.empty((*rgb.shape[:2], 4), dtype=np.uint8)
    rgba[:, :, :3] = np.rint(color).astype(np.uint8)
    rgba[:, :, 3] = np.rint(alpha * 255).astype(np.uint8)
    rgba[alpha == 0, :3] = 0
    return rgba


def save_frame(index, rgba, output):
    image = Image.fromarray(rgba)
    image.save(output / f'kid_{index}.webp', 'WEBP', quality=90, alpha_quality=100, method=4)
    for width, height in TIERS:
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        resized.save(output / f'display-{width}' / f'kid_{index}.webp', 'WEBP', quality=90,
                     alpha_quality=100, method=4)


def extract(video, output, ffmpeg):
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    output.mkdir(parents=True)
    for width, _height in TIERS:
        (output / f'display-{width}').mkdir()
    command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(video), '-map', '0:v:0',
               '-an', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
    count = 0
    with (output.parent / 'extraction.log').open('wb') as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log)
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                jobs = []
                while True:
                    data = process.stdout.read(WIDTH * HEIGHT * 3)
                    if not data:
                        break
                    if len(data) != WIDTH * HEIGHT * 3:
                        raise ValueError('Incomplete video frame')
                    rgb = np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH, 3)
                    rgba = remove_green(rgb)
                    count += 1
                    jobs.append(pool.submit(save_frame, count, rgba, output))
                    # Bound retained raw arrays while encoders work.
                    if len(jobs) >= 8:
                        jobs.pop(0).result()
                    if count == 1 or count % 24 == 0:
                        print(f'Processed {count}/{FRAME_COUNT} green-screen frames', flush=True)
                for job in jobs:
                    job.result()
            if process.wait() != 0:
                raise RuntimeError('Video decode failed; see extraction.log')
        except BaseException:
            process.kill(); process.wait()
            raise
    if count != FRAME_COUNT:
        raise ValueError(f'Expected {FRAME_COUNT} frames, got {count}')
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(video), '-map', '0:a:0',
                    '-t', str(count / FPS), '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame',
                    '-q:a', '3', str(output / 'kid_transform.mp3')], check=True)
    metadata = {'frames': count, 'fps': FPS, 'durationMs': round(count / FPS * 1000),
                'width': WIDTH, 'height': HEIGHT, 'tiers': TIERS, 'idleFrame': 1}
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent.parent / 'public' / 'kid')
    parser.add_argument('--ffmpeg', required=True)
    args = parser.parse_args()
    extract(args.video, args.output, args.ffmpeg)
