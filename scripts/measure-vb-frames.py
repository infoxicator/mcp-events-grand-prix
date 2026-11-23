"""Score native and production game captures against the extracted VB film."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

REFERENCE = Path(__file__).resolve().parents[1] / 'reference' / 'vb-ferrari'


def read_image(path):
    with Image.open(path) as image:
        if image.size != (1440, 1080):
            raise ValueError(f'{path} has size {image.size}, expected 1440 × 1080')
        return image.convert('RGB')


def capture(directory, shot):
    if isinstance(shot, str):
        return read_image(directory / f'{shot}.png')
    left = read_image(directory / (shot['left'] + '.png'))
    image = read_image(directory / (shot['right'] + '.png'))
    box = (0, 0, shot['split'], 1080)
    image.paste(left.crop(box), box)
    return image


def pixels(image):
    return np.asarray(image.resize((720, 540), Image.Resampling.LANCZOS), dtype=np.int16)


def cap_centre(image):
    # Isolate the yellow face of the near axle cap at the scoring resolution.
    window = image[196:280, 136:250]
    r, g, b = window.transpose(2, 0, 1)
    mask = (r > 110) & (g > 90) & (b < .49 * r) & (g > .75 * r)
    if not mask.any():
        raise ValueError('No yellow axle cap in frame 010')
    return np.argwhere(mask).mean(axis=0)


def measure(blender, game):
    sequence = json.loads((REFERENCE / 'shots.json').read_text())
    result = {}
    for number, shot in enumerate(sequence['frames'], start=1):
        ref = pixels(read_image(REFERENCE / f'frame-{number:03}.jpg'))
        pair = [pixels(capture(directory, shot)) for directory in (blender, game)]
        deltas = [np.abs(im - ref) for im in pair]
        full = [round(float(d[78:438].mean()), 2) for d in deltas]
        row = {'full': full}
        for name, (x0, y0, x1, y1) in sequence['regions'].get(str(number), {}).items():
            row.setdefault('details', {})[name] = [
                round(float(d[y0:y1, x0:x1].mean()), 2) for d in deltas
            ]
        if number == 10:
            origin = cap_centre(ref)
            row['cap px'] = [round(float(np.linalg.norm(cap_centre(im) - origin)), 2) for im in pair]
        result[number] = row
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('blender', type=Path, help='1440 × 1080 native render directory')
    parser.add_argument('game', type=Path, help='1440 × 1080 production WebGL capture directory')
    args = parser.parse_args()
    print(json.dumps(measure(args.blender, args.game), indent=2))
