"""Local speech-to-text for tracks (optional: needs the ``transcribe`` extra).

Runs a Whisper model on the CPU through faster-whisper; nothing leaves the server.
The model is downloaded once into ``<JAM_DATA_DIR>/models`` on first use. Audio is
decoded with ffmpeg and fed in fixed-size chunks so memory stays flat (about 0.8 GB
for ``small.en``) however long the track is.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from jam_session_processor.song_match import clean_transcript

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "small.en"
CHUNK_SEC = 180
SAMPLE_RATE = 16000


def model_name() -> str:
    return os.environ.get("JAM_TRANSCRIBE_MODEL", "").strip() or DEFAULT_MODEL


def is_available() -> bool:
    """True when the speech-to-text library is installed."""
    return importlib.util.find_spec("faster_whisper") is not None


@dataclass
class Transcript:
    text: str
    # [start_sec, end_sec, text, compression_ratio] per phrase, times from the track start
    segments: list[list]
    # loudness (dB) of each second of the track
    levels: list[int]


class Transcriber:
    def __init__(self, model: str | None = None, model_dir: Path | None = None, threads: int = 1):
        self.model = model or model_name()
        self._model_dir = model_dir
        self._threads = threads
        self._whisper = None

    def _load(self):
        if self._whisper is None:
            from faster_whisper import WhisperModel

            if self._model_dir:
                self._model_dir.mkdir(parents=True, exist_ok=True)
                # Fetch the model (first run only) in a throwaway process: downloading
                # in this one would add a few hundred MB to its peak memory.
                code = "import sys; from faster_whisper import download_model as d; "
                code += "d(sys.argv[1], cache_dir=sys.argv[2])"
                subprocess.run(
                    [sys.executable, "-c", code, self.model, str(self._model_dir)], check=True
                )
            logger.info("Loading speech-to-text model %s", self.model)
            self._whisper = WhisperModel(
                self.model,
                device="cpu",
                compute_type="int8",
                cpu_threads=self._threads,
                download_root=str(self._model_dir) if self._model_dir else None,
            )
        return self._whisper

    def _decode(self, path: Path, offset: float):
        import numpy as np

        cmd = ["ffmpeg", "-v", "error", "-ss", str(offset), "-t", str(CHUNK_SEC), "-i", str(path)]
        cmd += ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
        raw = subprocess.run(cmd, capture_output=True, check=True).stdout
        return np.frombuffer(raw, np.int16).astype(np.float32) / 32768

    def transcribe(self, path: Path) -> str:
        """Rough transcript of the vocals in an audio file ('' when nothing is sung)."""
        return self.transcribe_timed(path).text

    def transcribe_timed(self, path: Path) -> Transcript:
        """The transcript with the time of each phrase, and the track's loudness."""
        import numpy as np

        whisper = self._load()
        segments: list[list] = []
        levels: list[int] = []
        offset = 0.0
        while True:
            audio = self._decode(path, offset)
            if len(audio) < SAMPLE_RATE:  # under a second left
                break
            found, _ = whisper.transcribe(
                audio,
                language="en",
                beam_size=1,
                temperature=0.0,
                condition_on_previous_text=False,
            )
            segments.extend(
                [
                    round(offset + s.start, 1),
                    round(offset + s.end, 1),
                    s.text.strip(),
                    round(s.compression_ratio, 2),
                ]
                for s in found
            )
            seconds = audio[: len(audio) // SAMPLE_RATE * SAMPLE_RATE].reshape(-1, SAMPLE_RATE)
            mean_sq = np.maximum((seconds.astype(np.float64) ** 2).mean(axis=1), 1e-10)
            levels.extend(int(round(v)) for v in 10 * np.log10(mean_sq))
            if len(audio) < CHUNK_SEC * SAMPLE_RATE:
                break
            offset += CHUNK_SEC
        text = clean_transcript([(s[2], s[3]) for s in segments])
        return Transcript(text=text, segments=segments, levels=levels)
