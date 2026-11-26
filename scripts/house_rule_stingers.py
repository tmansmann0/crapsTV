"""Original house-rule audio. Run directly to export the chance-roll cues."""

import numpy as np

# Each note is onset, duration, starting pitch, ending pitch, and gain.
TONES = {
    "house-second-wind": [
        (0.00, 0.36, 140, 420, 0.36),
        (0.28, 0.26, 690, 410, 0.30),
    ],
    "house-hard-point": [
        (0.07, 0.24, 165, 105, 0.45),
        (0.18, 0.35, 457, 450, 0.30),
    ],
    "house-hot-hand": [
        (0.01, 0.21, 262, 262, 0.33),
        (0.12, 0.24, 330, 330, 0.33),
        (0.24, 0.36, 523, 523, 0.32),
    ],
    "house-craps-cashback": [
        (0.01, 0.18, 523, 392, 0.34),
        (0.23, 0.26, 392, 523, 0.35),
        (0.35, 0.21, 659, 659, 0.24),
    ],
    "house-lucky-seven": [
        (0.00, 0.13, 392, 392, 0.32),
        (0.10, 0.18, 494, 494, 0.34),
        (0.22, 0.37, 784, 784, 0.35),
        (0.22, 0.28, 587, 587, 0.20),
    ],
    "house-pass-the-dice": [
        (0.03, 0.32, 400, 760, 0.32),
        (0.23, 0.19, 760, 310, 0.22),
    ],
    "house-table-jackpot": [
        (0.02, 0.19, 262, 262, 0.30),
        (0.11, 0.21, 392, 392, 0.25),
        (0.19, 0.45, 523, 523, 0.35),
        (0.19, 0.38, 659, 659, 0.25),
        (0.19, 0.45, 784, 784, 0.21),
        (0.36, 0.23, 1046, 1046, 0.21),
    ],
}
CLICKS = {
    "house-second-wind": [0.00, 0.05, 0.12, 0.24, 0.39],
    "house-hard-point": [0.04, 0.11, 0.19],
    "house-hot-hand": [0.02, 0.12, 0.24],
    "house-craps-cashback": [0.02, 0.25, 0.32],
    "house-lucky-seven": [0.08, 0.21],
    "house-pass-the-dice": [0.01, 0.36],
    "house-table-jackpot": [0.05, 0.14, 0.22, 0.29, 0.39, 0.50],
}


def house_rule_stinger(key, rate=24000):
    """Return a bounded, deterministic mono accent or None for regular calls."""
    if key not in TONES:
        return None
    mix = np.zeros(int(rate * 0.72))
    for onset, duration, first, last, gain in TONES[key]:
        t = np.arange(int(rate * duration)) / rate
        phase = 2 * np.pi * (first * t + (last - first) * t**2 / (2 * duration))
        envelope = np.minimum(t / 0.012, 1) * (1 - t / duration) ** 2.4
        strike = np.sin(phase) + 0.22 * np.sin(2 * phase) + 0.1 * np.sin(3.01 * phase)
        start = int(rate * onset)
        mix[start : start + len(t)] += gain * strike * envelope
    rng = np.random.default_rng(sum(map(ord, key)))
    decay = np.exp(-np.arange(int(rate * 0.055)) / (0.010 * rate))
    for onset in CLICKS[key]:
        start = int(rate * onset)
        noise = np.diff(rng.normal(0, 1, len(decay) + 1))
        mix[start : start + len(decay)] += 0.065 * noise * decay
    return mix * (0.28 / np.max(np.abs(mix)))


def chance_roll_cues(rate=44100):
    """Return a short electric impact and a rising first-die cue."""
    rng = np.random.default_rng(2716)
    t = np.arange(int(rate * 0.49)) / rate
    bass = np.sin(2 * np.pi * (52 * t + 0.97 * (1 - np.exp(-t / 0.017))))
    sparks = np.zeros_like(t)
    for delay, gain in [(0.0, 0.43), (0.033, 0.31), (0.072, 0.17)]:
        onset = int(delay * rate)
        tail = t[:len(t) - onset]
        grit = np.diff(rng.uniform(-1, 1, len(tail) + 1))
        sparks[onset:] += gain * grit * np.exp(-tail / 0.010)
    arc = np.sin(2 * np.pi * (470 * t + 13 * (1 - np.exp(-t / 0.028))))
    strike = 0.45 * bass * np.exp(-t / 0.087) + sparks + 0.19 * arc * np.exp(-t / 0.12)
    strike *= np.minimum(t / 0.002, 1) * np.minimum((0.49 - t) / 0.055, 1)

    duration = 0.69
    t = np.arange(int(rate * duration)) / rate
    phase = 2 * np.pi * (102 * t + 28 * t**2)
    rise = np.sin(phase) + 0.3 * np.sin(phase * 2.01) + 0.15 * np.sin(phase * 3)
    swell = np.minimum(t / 0.14, 1) * np.minimum((duration - t) / 0.075, 1)
    tick = np.sin(2 * np.pi * 970 * t) * np.exp(-t / 0.025)
    anticipation = 0.53 * rise * swell * (0.65 + 0.35 * t / duration) + 0.38 * tick
    return {"house-electric": strike, "house-tension": anticipation}


if __name__ == "__main__":
    from pathlib import Path
    import subprocess

    output = Path(__file__).resolve().parents[1] / "public" / "audio" / "table"
    for name, cue in chance_roll_cues().items():
        normalized = cue * (0.64 / np.max(np.abs(cue)))
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "f32le", "-ar", "44100", "-ac", "1", "-i", "pipe:0",
            "-c:a", "libmp3lame", "-b:a", "128k", str(output / f"{name}.mp3"),
        ], input=normalized.astype("<f4").tobytes(), check=True)
