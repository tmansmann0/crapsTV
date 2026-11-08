"""Deterministic lighting-only resin/felt microsurface maps, without Blender.

Normal vectors are tangent-space, linear data. No albedo, UV, mesh or physics changes.
"""
import numpy as np


def filtered_noise(rng, size, xscale, yscale):
    f = np.fft.fftfreq(size)
    x, y = np.meshgrid(f, f)
    image = np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) *
                         np.exp(-((x / xscale) ** 2 + (y / yscale) ** 2))).real
    return (image - image.mean()) / image.std()


def normal_from_height(height, strength):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .5 * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * .5 * strength
    normal = np.stack((-dx, -dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal * .5 + .5


def dice_maps(version, size=512):
    rng = np.random.default_rng(1107 + version)
    fine = filtered_noise(rng, size, .28, .28)
    handling = filtered_noise(rng, size, .018, .022)
    scratch = np.zeros((size, size))
    for _ in range(145):
        x, y = rng.uniform(0, size, 2)
        length = rng.uniform(5, 54)
        angle = rng.uniform(0, np.pi * 2)
        strength = rng.uniform(.3, 1)
        for t in np.linspace(0, 1, int(length * 2)):
            px = x + np.cos(angle) * length * t
            py = y + np.sin(angle) * length * t
            ix, iy = int(px), int(py)
            # Wrap exact coordinates before applying the brush so seams are periodic.
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    coverage = np.exp(-((ix + ox - px)**2 + (iy + oy - py)**2) / .65)
                    yy, xx = (iy + oy) % size, (ix + ox) % size
                    scratch[yy, xx] = max(scratch[yy, xx], strength * coverage * np.sin(np.pi * t)**.35)
    height = fine * .004 - scratch * .09
    normal = normal_from_height(height, 4)
    roughness = np.clip(.236 + fine * .004 + handling * .012 + scratch * .20, .205, .46)
    return normal, np.repeat(roughness[:, :, None], 3, axis=2)


def felt_maps(size=1024):
    rng = np.random.default_rng(8675309)
    # Matted wool has short, overlapping directions rather than a woven grid.
    nap = filtered_noise(rng, size, .065, .26)
    cross = filtered_noise(rng, size, .21, .09)
    fibre = nap * .72 + cross * .28
    fine = filtered_noise(rng, size, .32, .32)
    matting = filtered_noise(rng, size, .012, .014)
    height = fibre * .13 + fine * .018 + matting * .035
    normal = normal_from_height(height, 3.2)
    roughness = np.clip(.955 + fibre * .012 + matting * .006, .91, .99)
    return normal, np.repeat(roughness[:, :, None], 3, axis=2)
