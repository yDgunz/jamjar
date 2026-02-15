# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLI tool that processes iPhone audio recordings of band jam sessions. It extracts metadata from recordings and splits full sessions into individual songs based on energy-level analysis, then exports each song as a `.wav` file.

## Core Features

**1. Metadata Extraction (`jam-session info <file>`)**
- Reads metadata from `.m4a` and `.wav` files using mutagen
- Displays: filename, duration, file size, codec, sample rate, channels, bitrate, recording date (from iPhone `©day` tag)

**2. Song Detection & Splitting (`jam-session process <file>`)**
- Uses ffmpeg to decode audio to raw PCM, then computes per-second RMS energy levels
- Applies a 15-second rolling average to smooth out brief spikes/dips
- Identifies sustained high-energy sections as songs (default: 2+ minutes above -30 dB)
- Exports only the detected songs via ffmpeg seek+split (no full-file loading)
- Output filenames include track number and timestamp range: `<date>_<track>_<start>-<end>.wav`

**CLI Options:**
- `-t, --threshold` — energy threshold in dB (default: -30, higher = more selective)
- `-m, --min-duration` — minimum song duration in seconds (default: 120)
- `-o, --output-dir` — output directory (default: `./output/<input_stem>/`)

## Architecture

- **`cli.py`** — click entry points, wires together the pipeline
- **`metadata.py`** — `extract_metadata()` returns an `AudioMetadata` dataclass with a `.summary()` display method
- **`splitter.py`** — `compute_rms_profile()` decodes audio via ffmpeg to 8kHz mono PCM and computes per-second RMS dB values in Python; `detect_songs()` smooths the profile and finds sustained high-energy regions; `export_segment()` uses ffmpeg to extract a time range directly to `.wav`
- **`output.py`** — `generate_output_name()` builds filenames with date, track number, and timestamps; `export_segments()` orchestrates exporting all segments with progress callbacks

## Build & Development Commands

```bash
# Activate the venv (Python 3.12 via Homebrew)
source .venv/bin/activate

# Install in development mode
pip install -e ".[dev]"

# Run the CLI
jam-session process <file>
jam-session info <file>

# Run all tests
pytest

# Run a single test
pytest tests/test_splitter.py::test_function_name

# Lint
ruff check src/ tests/

# Format
ruff format src/ tests/
```

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`

## Design Decisions

- **Output format:** `.wav` (PCM 16-bit)
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -30 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -25). For quieter recordings, lower it (e.g., -35).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Metadata:** Extract and display only; no write-back to split tracks
- **Splitting mode:** Automatic (no interactive confirmation)

## Test Data

- `input/5Biz 2-3-26.m4a` — full 1h38m jam session (iPhone Voice Memo)
- `input/unknown-date_02.wav` — 18-minute excerpt containing ~4 songs, useful for testing detection tuning

## Potential Future Updates

- Merge nearby segments that likely belong to the same song (e.g., songs 6 & 7 overlapping at boundaries)
- Interactive mode to preview and adjust split points before exporting
- Batch processing of multiple files / entire directories
- Visual energy profile output (e.g., ASCII or image) to help tune threshold
- Write metadata (track number, date) back into exported `.wav` files
