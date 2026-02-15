from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from mutagen import File as MutagenFile


@dataclass
class AudioMetadata:
    filename: str
    duration_seconds: float
    sample_rate: int | None
    channels: int | None
    bitrate: int | None
    file_size_mb: float
    recording_date: datetime | None
    codec: str | None

    def summary(self) -> str:
        lines = [
            f"File:       {self.filename}",
            f"Duration:   {self._format_duration()}",
            f"Size:       {self.file_size_mb:.1f} MB",
        ]
        if self.codec:
            lines.append(f"Codec:      {self.codec}")
        if self.sample_rate:
            lines.append(f"Sample rate: {self.sample_rate} Hz")
        if self.channels:
            lines.append(f"Channels:   {self.channels}")
        if self.bitrate:
            lines.append(f"Bitrate:    {self.bitrate // 1000} kbps")
        if self.recording_date:
            lines.append(f"Recorded:   {self.recording_date.strftime('%Y-%m-%d %H:%M')}")
        return "\n".join(lines)

    def _format_duration(self) -> str:
        total = int(self.duration_seconds)
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours}h {minutes}m {seconds}s"
        return f"{minutes}m {seconds}s"


def extract_metadata(file_path: Path) -> AudioMetadata:
    audio = MutagenFile(str(file_path))
    if audio is None:
        raise ValueError(f"Could not read audio file: {file_path}")

    info = audio.info
    file_size_mb = file_path.stat().st_size / (1024 * 1024)

    recording_date = None
    # iPhone Voice Memos store date in ©day tag
    tags = audio.tags
    if tags:
        for key in ("©day", "\xa9day"):
            if key in tags:
                raw = str(tags[key][0])
                try:
                    recording_date = datetime.fromisoformat(raw)
                except ValueError:
                    pass
                break

    return AudioMetadata(
        filename=file_path.name,
        duration_seconds=info.length,
        sample_rate=getattr(info, "sample_rate", None),
        channels=getattr(info, "channels", None),
        bitrate=getattr(info, "bitrate", None),
        file_size_mb=file_size_mb,
        recording_date=recording_date,
        codec=getattr(info, "codec", None) or type(info).__name__,
    )
