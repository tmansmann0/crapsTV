"""Bake resin scuffs and short-fibre felt without rebuilding any model.

python3 scripts/build-surface-maps.py (requires numpy and Pillow)
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image
from surface_maps import dice_maps, felt_maps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
metadata = {'generator': 'scripts/build-surface-maps.py', 'seeded': True, 'maps': {},
            'feltTileWorldUnits': .46,
            'preservedSha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
             for p in ['public/assets/dice.glb', 'assets/source/dice.blend']}}


def save(name, data):
    pixels = np.uint8(np.clip(data * 255 + .5, 0, 255))
    target = OUT / (name + '.png')
    temporary = target.with_suffix('.tmp.png')
    Image.fromarray(pixels).save(temporary, optimize=True)
    temporary.replace(target)
    metadata['maps'][name] = {'width': pixels.shape[1], 'height': pixels.shape[0],
        'min': float(data.min()), 'max': float(data.max()),
        'standardDeviation': float(data[:, :, 0].std()),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


for i in range(1, 4):
    normal, rough = dice_maps(i)
    save(f'dice-wear-{i}', normal)
    save(f'dice-roughness-{i}', rough)
    if i == 1:
        save('dice-roughness', rough)  # Compatibility with existing source GLB/tooling.
normal, rough = felt_maps()
save('felt-normal', normal)
save('felt-roughness', rough)
(OUT / 'surface-detail-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
