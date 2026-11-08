# Bundled announcer

The game ships with an original English phrase pack synthesized locally with **Kokoro-82M v1.0**, using its **`am_michael` male voice**, at speed 1.02. No model, Python runtime, API token, or internet connection is required to play these MP3s in the game.

NeuTTS-2E was the requested first choice. Its official model and GGUF repositories required accepted Hugging Face gated-model access during this build. This pack therefore uses Kokoro; it is not a NeuTTS recording and does not imitate a named real person.

## Files and integration

- `public/audio/manifest.json` maps event keys to `{ "file": "event.mp3", "text": "Spoken words" }`.
- `public/audio/provenance.json` records model, voice, speed, seed, and the SHA-256 digest of every output.
- All clips are **mono MP3, 44.1 kHz, 128 kbps**, normalized toward −18 LUFS with a −1.5 dB true-peak ceiling.
- `roll-2` through `roll-12` cover every dice total; `point-N` covers every valid point in both variants. Event clips cover opening/locking bets, natural wins, craps, point wins, seven-out, re-ups, join/leave, teach mode, and session ending.
- Playback should happen on the shared TV only, after a user gesture enables audio. Queue clips, rather than overlapping them. Phones should not also announce every event.

## Regenerating

Requires Python 3.10+, FFmpeg on `PATH`, and a one-time download of the open model and voice. Generation is offline after those files are cached.

```sh
python -m venv .venv-audio
# macOS / Linux:
. .venv-audio/bin/activate
# Windows PowerShell instead: .venv-audio\Scripts\Activate.ps1
python -m pip install 'kokoro==0.9.4' 'soundfile==0.14.0'
python -m spacy download en_core_web_sm
python scripts/generate-announcer.py
```

Use `--only welcome roll-7` for selected phrases. Existing files are preserved unless `--force` is supplied. `--voice am_michael --speed 1.02` are the defaults. A seed is set, but bit-identical output is not guaranteed across Torch versions and platforms. The normal game build does not execute Python or download TTS weights.

## Sources and licensing

- [Kokoro model and model card](https://huggingface.co/hexgrad/Kokoro-82M): Apache-2.0 model weights; official model card describes the training data and upstream acknowledgments.
- [Kokoro inference library](https://github.com/hexgrad/kokoro): Apache-2.0.
- [Official voice inventory](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md): `am_michael` is the selected American English male voice.
- [NeuTTS official project](https://github.com/neuphonic/neutts) and [NeuTTS-2E model](https://huggingface.co/neuphonic/neutts-2e): referenced for the requested option; neither weights nor generated output from that model are included.

The original phrase scripts and generated clips are included as project assets. Model weights are not redistributed in this repository. The runtime and its model dependencies are only needed for optional regeneration; their own license terms still apply when installed.

## Verification completed

All 51 files decoded successfully with FFmpeg and were checked with FFprobe for MP3 encoding, mono output, and 44.1 kHz sampling. Total duration is 118.29 seconds; the pack is about 1.9 MiB. Individual clips run from 1.00 to 4.30 seconds. A local Whisper `tiny.en` transcription spot-check recognized the welcome, betting, seven-out, recap, shooter, dice totals, and extreme-point announcements. Casino slang can be transcribed phonetically by the small recognizer; the source text remains authoritative.

The model files are pinned to Hugging Face revision `f3ff3571791e39611d31c381e3a41a3af07b4987` for regeneration. The full upstream Apache license is included in `public/audio/LICENSE-Kokoro.txt` for reference.
