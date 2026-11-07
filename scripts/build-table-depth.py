"""Bake shared wood/padded-rail microrelief without touching albedo or model UVs.

Run after build-table-materials.py, or alone to iterate depth. NumPy + Pillow.
No runtime displacement/parallax: tangent normals, pore roughness, and restrained
microcavity occlusion stay one shared material per surface. The CC0 wood normal
is a real 2K scan, not an upsample of the former 1K runtime texture.
"""
from pathlib import Path
import json
import os
import tempfile
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
SOURCE = ROOT / 'assets/source/materials/dark-wood'
RANGES = {}


def atomic_write(path, writer):
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.stem}-', suffix=path.suffix, dir=path.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        writer(temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def noise(n, gx, gy, seed):
    """Periodic cubic value noise; all relief levels tile on the same UVs."""
    grid = np.random.default_rng(seed).random((gy, gx)).astype(np.float32)
    x = np.arange(n, dtype=np.float32) / n * gx
    y = np.arange(n, dtype=np.float32) / n * gy
    ix, iy = x.astype(int), y.astype(int)
    tx, ty = x - ix, y - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = grid[iy[:, None] % gy, ix[None, :] % gx] * (1 - tx) + grid[iy[:, None] % gy, (ix[None, :] + 1) % gx] * tx
    b = grid[(iy[:, None] + 1) % gy, ix[None, :] % gx] * (1 - tx) + grid[(iy[:, None] + 1) % gy, (ix[None, :] + 1) % gx] * tx
    return a * (1 - ty[:, None]) + b * ty[:, None]


def save(name, data, size=None):
    data = np.clip(data, 0, 1)
    im = Image.fromarray(np.round(data * 255).astype(np.uint8))
    if size and im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    atomic_write(OUT / f'{name}.png', lambda p: im.save(p, optimize=True))
    pixels = np.asarray(im, dtype=np.float32) / 255
    RANGES[name] = {'file': f'{name}.png', 'width': im.width, 'height': im.height,
                    'min': round(float(pixels.min()), 4), 'max': round(float(pixels.max()), 4),
                    'mean': round(float(pixels.mean()), 4)}


def normal(height, world):
    step = world / height.shape[0]
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * step)
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * step)
    n = np.stack((-dx, -dy, np.ones_like(height)), axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * .5 + .5


def wood_cavities(encoded):
    """Estimate tiny pore recesses from the matched scan, not from diffuse color.

    Periodic Poisson integration uses normal slopes. Removing low frequencies
    keeps knots/panel lighting out of AO; this is microcavity shading, not a
    claim of scanned displacement. OpenGL Y is up in the source image.
    """
    n = encoded.astype(np.float32) * 2 - 1
    nz = np.maximum(n[:, :, 2], .2)
    gx, gy = -n[:, :, 0] / nz, n[:, :, 1] / nz
    h, w = gx.shape
    kx = 2 * np.pi * np.fft.rfftfreq(w)[None, :]
    ky = 2 * np.pi * np.fft.fftfreq(h)[:, None]
    square = kx * kx + ky * ky
    square[0, 0] = 1
    height_fft = -(1j * kx * np.fft.rfft2(gx) + 1j * ky * np.fft.rfft2(gy)) / square
    # Smooth high pass, suppressing features broader than roughly 24 texels.
    highpass = 1 - np.exp(-square * 24 ** 2 / 2)
    height = np.fft.irfft2(height_fft * highpass, s=(h, w))
    lo, hi = np.percentile(height, [4, 70])
    recess = np.clip((hi - height) / max(hi - lo, 1e-6), 0, 1)
    return 1 - recess * .11


def build():
    # Preserve the actual dark scan albedo and board-local 4-unit mapping.
    encoded = np.asarray(Image.open(SOURCE / 'dark_wood_nor_gl_2k.png').convert('RGB'), dtype=np.float32) / 255
    save('material-table-walnut-normal', encoded)
    save('material-table-walnut-occlusion', wood_cavities(encoded), 1024)

    n = 2048
    pebble = noise(n, 150, 150, 61)
    seams = np.clip((.39 - pebble) / .39, 0, 1)
    pores = noise(n, 420, 420, 64)
    pore_recess = np.clip((.23 - pores) / .23, 0, 1)
    # Rounded upholstery grain with shallow fissures and sparse pinprick pores;
    # broad compression is much shallower than the pebble detail.
    height = pebble * .00057 - seams * .00017
    height += (pores - .5) * .000025 - pore_recess * .000055
    height += (noise(n, 12, 12, 62) - .5) * .00011
    save('material-table-leather-normal', normal(height, .8))
    burnish = noise(n, 17, 17, 63) - .5
    roughness = .68 + .078 * seams + .033 * pore_recess - .018 * burnish
    save('material-table-leather-roughness', roughness, 1024)
    save('material-table-leather-occlusion', 1 - .075 * seams - .035 * pore_recess, 1024)

    metadata_path = OUT / 'material-table-metadata.json'
    metadata = json.loads(metadata_path.read_text())
    metadata['maps'].update(RANGES)
    metadata['woodMapping'].update({'normalScale': .82, 'clearcoatNormalScale': .28,
                                    'occlusionIntensity': .5, 'normalResolution': 2048})
    metadata['materialDepth'] = {
        'version': 1, 'geometryChanged': False, 'additionalSharedTextures': 2,
        'wood': {'normalSource': 'dark_wood_nor_gl_2k.png', 'normalResolution': 2048,
                 'albedoChanged': False, 'clearcoatUsesMatchedGrain': True,
                 'occlusion': 'High-pass microcavity estimate from matched OpenGL normal; not displacement',
                 'occlusionIntensity': .5, 'normalScale': .82, 'clearcoatNormalScale': .28},
        'padding': {'tileSceneUnits': .8, 'normalResolution': 2048,
                    'albedoChanged': False, 'normalScale': 1,
                    'relief': 'Rounded pebble grain, recessed pores and broad soft compression',
                    'maximumHeightRangeSceneUnits': round(float(np.ptp(height)), 7),
                    'occlusionIntensity': .55},
        'runtime': 'Tangent normal, roughness and subtle occlusion maps; no parallax, displacement, extra geometry or material batches',
    }
    atomic_write(metadata_path, lambda p: p.write_text(json.dumps(metadata, indent=2) + '\n'))
    provenance_path = SOURCE / 'provenance.json'
    provenance = json.loads(provenance_path.read_text())
    provenance['runtimeTransform'] = 'Diffuse multiplied in sRGB by [0.70,0.86,0.99] unchanged; matched 2K OpenGL normal strength 0.82, also applied to varnish at 0.28; roughness 0.29 + 0.34 * source unchanged. Shared subtle pore occlusion estimated from the scanned normal.'
    provenance['runtimeDepthBake'] = 'scripts/build-table-depth.py: normal-derived high-pass microcavity estimate, not scanned displacement. Original scan files remain unchanged.'
    atomic_write(provenance_path, lambda p: p.write_text(json.dumps(provenance, indent=2) + '\n'))
    print(json.dumps({'depthMaps': RANGES, 'woodAlbedoUnchanged': True, 'paddingAlbedoUnchanged': True}, indent=2))


if __name__ == '__main__':
    build()
