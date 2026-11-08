#!/usr/bin/env python3
"""Regenerate the bundled crapsTV voice pack with local, open-weight Kokoro TTS.

Install Python 3.10+ dependencies with:
    python -m pip install 'kokoro==0.9.4' 'soundfile==0.14.0'
    python -m spacy download en_core_web_sm
FFmpeg must be on PATH. First use downloads Kokoro weights/voice from Hugging Face.
No speech service/API key is used. Run from any directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "hexgrad/Kokoro-82M"
MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
PHRASES = {
    "welcome": "Welcome to Craps TV. Your table is ready. Let's roll!",
    "betting-open": "Place your bets. The table is open.",
    "bets-locked": "All bets are locked. Here come the dice!",
    "come-out": "Coming out. A brand new roll!",
    "point-set": "The point is set. Let's bring it home.",
    "point-hit": "That's the point! Pay the line!",
    "seven-out": "Seven out. A new shooter steps up.",
    "natural": "Winner, winner! Pay the pass line!",
    "craps": "Craps. The pass line loses this one.",
    "push": "That's a push. Your bet stays on the table.",
    "player-joined": "Another player at the table. Welcome aboard!",
    "player-left": "Cashing out. Thanks for playing!",
    "re-up": "A fresh stack. You're back in the game!",
    "session-ended": "That's a wrap. Let's see how you rolled!",
    "your-roll": "Shooter, the dice are yours!",
    "game-started": "The table is live. Good luck, everyone!",
    "crapless": "Crapless craps. Every number but seven can be the point.",
    "classic": "Classic craps. Seven or eleven wins on the come out.",
    "teach-mode": "Teach mode is on. Check your phone for odds and payouts.",
    "big-win": "Now that's a big win. Nice shooting!",
    "bust": "Out of chips? Take a fresh stack and stay in the action.",
    "disconnected": "Waiting for the table to reconnect.",
    "connected": "We're back at the table.",
    "dont-pass-win": "Pay the don't pass line.",
    "field-win": "Winner in the field!",
    "hardway": "The hard way! Nice roll!",
}
NUMBERS = {2:"Two. Snake eyes!",3:"Three. Ace deuce!",4:"Four. Little Joe!",5:"Five. Five alive!",6:"Six. Easy six!",7:"Seven!",8:"Eight. The eighter from Decatur!",9:"Nine. Center field!",10:"Ten. The big one!",11:"Eleven. Yo eleven!",12:"Twelve. Boxcars!"}
for number, text in NUMBERS.items():
    PHRASES[f"roll-{number}"] = text
    if number != 7:
        PHRASES[f"point-{number}"] = f"The point is {number}. Let's hit it!"
PHRASES["hard-4"] = "Hard four! Two and two!"
PHRASES["hard-6"] = "Hard six! A pair of threes!"
PHRASES["hard-8"] = "Hard eight! A pair of fours!"
PHRASES["hard-10"] = "Hard ten! A pair of fives!"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", help="Generate only these phrase keys")
    parser.add_argument("--voice", default="am_michael", help="Kokoro voice ID (default: am_michael)")
    parser.add_argument("--speed", type=float, default=1.02)
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "audio")
    parser.add_argument("--force", action="store_true", help="Overwrite existing MP3s")
    args = parser.parse_args()
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KModel, KPipeline
    from huggingface_hub import hf_hub_download
    torch.manual_seed(20261107)
    def download(filename):
        return hf_hub_download(repo_id=MODEL_ID, filename=filename, revision=MODEL_REVISION)
    model = KModel(repo_id=MODEL_ID, config=download("config.json"), model=download("kokoro-v1_0.pth")).to("cpu").eval()
    voice_path = download(f"voices/{args.voice}.pt")
    pipeline = KPipeline(lang_code="a", repo_id=MODEL_ID, model=model, device="cpu")
    args.output.mkdir(parents=True, exist_ok=True)
    selected = args.only or list(PHRASES)
    unknown = set(selected) - set(PHRASES)
    if unknown:
        parser.error(f"Unknown phrase keys: {', '.join(sorted(unknown))}")
    with tempfile.TemporaryDirectory(prefix="crapstv-voice-") as tmp:
        for key in selected:
            dest = args.output / f"{key}.mp3"
            if dest.exists() and not args.force:
                print(f"Keeping {key}", flush=True)
                continue
            print(f"Generating {key}: {PHRASES[key]}", flush=True)
            chunks = [audio.numpy() if hasattr(audio, "numpy") else audio
                      for _graphemes, _phonemes, audio in pipeline(PHRASES[key], voice=voice_path, speed=args.speed)]
            if not chunks:
                raise RuntimeError(f"No audio generated for {key}")
            wav_path = Path(tmp) / f"{key}.wav"
            sf.write(wav_path, np.concatenate(chunks), 24000)
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path),
                "-af", "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-48dB,loudnorm=I=-18:TP=-1.5:LRA=7",
                "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k",
                "-metadata", "artist=crapsTV · Kokoro am_michael",
                "-metadata", f"title={key}", str(dest)
            ], check=True)
    manifest = {key: {"file": f"{key}.mp3", "text": text} for key, text in PHRASES.items() if (args.output / f"{key}.mp3").exists()}
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    provenance = {
        "model": "hexgrad/Kokoro-82M", "modelLicense": "Apache-2.0", "voice": args.voice,
        "modelRevision": MODEL_REVISION,
        "engine": "kokoro", "speed": args.speed, "seed": 20261107,
        "sampleRate": 44100, "codec": "MP3 / libmp3lame", "bitrate": "128kbps mono",
        "files": {key: {"sha256": hashlib.sha256((args.output / value["file"]).read_bytes()).hexdigest(),
                         "text": value["text"]} for key, value in manifest.items()}
    }
    (args.output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"Saved {len(manifest)} phrases in {args.output}", flush=True)


if __name__ == "__main__":
    main()
