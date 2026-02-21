#!/usr/bin/env python3
"""Reset the database and populate it with realistic test data.

Usage:
    python scripts/seed-db.py              # uses default DB path from config
    python scripts/seed-db.py /path/to.db  # explicit DB path

Creates: 2 groups, 3 users, 15 sessions, 8 songs, ~55 tracks.
Audio files are NOT created — paths are placeholders for UI/API testing.
"""

import random
import sys
from pathlib import Path

# Ensure the package is importable when running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from jam_session_processor.auth import hash_password
from jam_session_processor.db import Database

# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------

GROUPS = ["Porch Dogs", "The Slow Burners"]

USERS = [
    ("eric@example.com", "Eric", "Porch Dogs", "superadmin"),
    ("dave@example.com", "Dave", "Porch Dogs", "admin"),
    ("mike@example.com", "Mike", "The Slow Burners", "editor"),
]

DEFAULT_PASSWORD = "testpass123"

SONGS = {
    "Porch Dogs": [
        "Fat Cat",
        "Good God Damn",
        "Spit Me Out",
        "Be Forever",
        "River Mouth",
        "Dust & Neon",
    ],
    "The Slow Burners": [
        "Low Tide",
        "Copper Wire",
    ],
}

# Song details: (chart, lyrics, notes)
SONG_DETAILS: dict[str, tuple[str, str, str]] = {
    "Fat Cat": (
        "Intro: E | E | A | A\n"
        "Verse: E | G | A | E\n"
        "Chorus: A | B | E | E\n"
        "Bridge: C#m | A | B | E",
        "Fat cat sittin' on the windowsill\n"
        "Watchin' the world go by\n"
        "Got no worries, got no bills\n"
        "Just a lazy kinda guy",
        "Key of E. Dave kicks off the riff, bass comes in on the & of beat 4. "
        "Bridge is half-time feel.",
    ),
    "Good God Damn": (
        "Intro: Am | Am | Am | Am\n"
        "Verse: Am | C | G | D\n"
        "Chorus: F | G | Am | Am\n"
        "Outro: Am | G | F | E",
        "Good god damn, what a mess\n"
        "Woke up late in yesterday's dress\n"
        "Coffee's cold and the dog got out\n"
        "That's what Monday's all about",
        "Starts quiet, builds each verse. Outro is a slow burn — let the last Am ring.",
    ),
    "Spit Me Out": (
        "Verse: D | F#m | Bm | G\n"
        "Pre-chorus: G | A | G | A\n"
        "Chorus: D | A | Bm | G",
        "",
        "Uptempo. The pre-chorus pushes hard — don't rush into the chorus, "
        "leave a breath. Eric drops out on bass for the first half of verse 2.",
    ),
    "Be Forever": (
        "Intro: Cmaj7 | Em7 | Am7 | Fmaj7\n"
        "Verse: C | Em | Am | F\n"
        "Chorus: F | G | Am | C\n"
        "Bridge: Dm | G | C | Am",
        "If I could be forever\n"
        "Standin' in the pouring rain\n"
        "I'd hold the sky together\n"
        "Just to wash away the pain",
        "Ballad feel. Key change from C to D on the last chorus — watch Dave's nod.",
    ),
    "River Mouth": (
        "Intro: Em | Em | Em | Em\n"
        "Verse: Em | G | C | D\n"
        "Chorus: C | D | Em | Em\n"
        "Breakdown: Am | Am | Em | Em",
        "Down by the river mouth\n"
        "Where the water meets the sound\n"
        "I left my heavy heart\n"
        "And let the current pull it down",
        "Open-string riff in the intro. Breakdown is just bass and drums, "
        "guitar comes back on the repeat.",
    ),
    "Dust & Neon": (
        "Verse: A | D | A | E\n"
        "Chorus: D | E | A | F#m\n"
        "Solo: A | D | E | A",
        "Dust and neon, two-lane road\n"
        "Dashboard lights and a heavy load\n"
        "Left that town in the rearview glow\n"
        "Ain't comin' back, that much I know",
        "Driving rock feel. Bass follows the kick pattern in the verse, "
        "locks with guitar on the chorus. Solo section is open — trade off.",
    ),
    "Low Tide": (
        "Intro: Dm | Am | Bb | F\n"
        "Verse: Dm | Am | Bb | C\n"
        "Chorus: Bb | C | Dm | Dm",
        "Low tide pulling at the shore\n"
        "Everything I had before\n"
        "Slipping through my hands like sand\n"
        "Nothing goes the way you plan",
        "Slow and spacey. Lots of reverb. Let notes ring and decay. "
        "Mike plays sparse — leave room.",
    ),
    "Copper Wire": (
        "Verse: Em | Em | Am | Am\n"
        "Build: C | D | Em | Em\n"
        "Peak: Em | G | D | Am",
        "",
        "Builds from nothing to a wall of sound. Verse is just bass and "
        "a clean guitar line. Feedback section after the peak — "
        "controlled chaos, come back in together on the downbeat.",
    ),
}

# Sessions: (group, source_file, date, notes, tracks)
# Each track: (start, end, song_name_or_None, notes)
SESSIONS = [
    # --- Porch Dogs sessions ---
    (
        "Porch Dogs",
        "Rehearsal 10-15-25.m4a",
        "2025-10-15",
        "First session at the new space. Drums sounded great.",
        [
            (0, 245, "Fat Cat", "Solid take, nailed the bridge"),
            (280, 510, "Good God Damn", ""),
            (550, 780, "Spit Me Out", "Tempo drifted in the outro"),
            (820, 1050, None, "Jam — untagged improv"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 10-22-25.m4a",
        "2025-10-22",
        "",
        [
            (0, 230, "Fat Cat", ""),
            (270, 520, "Be Forever", "Key change worked well"),
            (560, 800, "Good God Damn", ""),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 11-5-25.m4a",
        "2025-11-05",
        "Short session, Dave had to leave early.",
        [
            (0, 260, "Spit Me Out", "Best take yet"),
            (300, 540, "River Mouth", "First time playing this one"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 11-12-25.m4a",
        "2025-11-12",
        "",
        [
            (0, 210, "Fat Cat", ""),
            (250, 490, "River Mouth", ""),
            (530, 770, "Good God Damn", "Tried the half-time break"),
            (810, 1020, "Dust & Neon", "First rehearsal of this tune"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 11-19-25.m4a",
        "2025-11-19",
        "Recorded with the new mic setup.",
        [
            (0, 280, "Be Forever", ""),
            (320, 550, "Dust & Neon", "Getting tighter"),
            (590, 830, "Fat Cat", ""),
            (870, 1100, None, "Blues jam"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 12-3-25.m4a",
        "2025-12-03",
        "",
        [
            (0, 240, "Spit Me Out", ""),
            (280, 530, "Good God Damn", ""),
            (570, 800, "River Mouth", "Extended solo section"),
            (840, 1060, "Fat Cat", ""),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 12-10-25.m4a",
        "2025-12-10",
        "Pre-gig runthrough. Setlist order.",
        [
            (0, 250, "Fat Cat", ""),
            (290, 540, "Good God Damn", ""),
            (580, 810, "Be Forever", ""),
            (850, 1090, "Spit Me Out", ""),
            (1130, 1350, "Dust & Neon", ""),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 1-7-26.m4a",
        "2026-01-07",
        "First session of the new year.",
        [
            (0, 270, "River Mouth", "New arrangement"),
            (310, 540, "Dust & Neon", ""),
            (580, 820, None, "New song idea — needs a name"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 1-14-26.m4a",
        "2026-01-14",
        "",
        [
            (0, 230, "Fat Cat", ""),
            (270, 510, "Be Forever", ""),
            (550, 790, "Spit Me Out", ""),
            (830, 1050, "Good God Damn", ""),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 1-28-26.m4a",
        "2026-01-28",
        "Working on transitions between songs.",
        [
            (0, 260, "Dust & Neon", ""),
            (300, 530, "River Mouth", ""),
            (570, 810, "Fat Cat", "Tried the new ending"),
            (850, 1090, None, "Improv"),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 2-4-26.m4a",
        "2026-02-04",
        "",
        [
            (0, 240, "Good God Damn", ""),
            (280, 520, "Spit Me Out", ""),
            (560, 790, "Be Forever", ""),
        ],
    ),
    (
        "Porch Dogs",
        "Rehearsal 2-11-26.m4a",
        "2026-02-11",
        "Tight session. Everything clicked.",
        [
            (0, 250, "Fat Cat", "Best version yet"),
            (290, 540, "Dust & Neon", ""),
            (580, 830, "River Mouth", ""),
            (870, 1100, "Good God Damn", ""),
        ],
    ),
    # --- The Slow Burners sessions ---
    (
        "The Slow Burners",
        "Slow Burners 11-20-25.m4a",
        "2025-11-20",
        "Mike's side project. Chill vibes.",
        [
            (0, 320, "Low Tide", "Long intro, let it breathe"),
            (360, 650, "Copper Wire", ""),
            (700, 950, None, "Ambient jam"),
        ],
    ),
    (
        "The Slow Burners",
        "Slow Burners 12-18-25.m4a",
        "2025-12-18",
        "",
        [
            (0, 350, "Low Tide", ""),
            (390, 680, "Copper Wire", "Added the feedback section"),
            (720, 980, "Low Tide", "Second take — better dynamics"),
        ],
    ),
    (
        "The Slow Burners",
        "Slow Burners 1-22-26.m4a",
        "2026-01-22",
        "Exploring new textures.",
        [
            (0, 300, "Copper Wire", ""),
            (340, 620, None, "New idea — drone thing"),
            (660, 900, "Low Tide", ""),
        ],
    ),
]


def fake_audio_path(source_stem: str, track_num: int, start: int, end: int) -> str:
    """Generate a plausible output path (no real file created)."""
    return f"output/{source_stem}/{source_stem}_track{track_num:02d}_{start}-{end}.m4a"


def seed(db: Database):
    db.reset()
    print("Database reset.")

    # Groups
    group_ids = {}
    for name in GROUPS:
        gid = db.create_group(name)
        group_ids[name] = gid
        print(f"  Group: {name} (id={gid})")

    # Users
    pw_hash = hash_password(DEFAULT_PASSWORD)
    for email, name, group_name, role in USERS:
        uid = db.create_user(email, pw_hash, name=name, role=role)
        db.assign_user_to_group(uid, group_ids[group_name])
        print(f"  User: {email} [{role}] -> {group_name}")

    # Eric is in both groups
    eric = db.get_user_by_email("eric@example.com")
    db.assign_user_to_group(eric.id, group_ids["The Slow Burners"])
    print(f"  User: eric@example.com -> The Slow Burners (additional)")

    # Songs (pre-create so we can tag tracks)
    song_ids: dict[tuple[str, str], int] = {}  # (group_name, song_name) -> id
    for group_name, songs in SONGS.items():
        gid = group_ids[group_name]
        for song_name in songs:
            sid = db._get_or_create_song(song_name, gid)
            song_ids[(group_name, song_name)] = sid
    print(f"  Songs: {sum(len(s) for s in SONGS.values())} created")

    # Song details (charts, lyrics, notes)
    details_count = 0
    for (group_name, song_name), sid in song_ids.items():
        if song_name in SONG_DETAILS:
            chart, lyrics, notes = SONG_DETAILS[song_name]
            db.update_song_details(sid, chart, lyrics, notes)
            details_count += 1
    print(f"  Song details: {details_count} with charts/lyrics/notes")

    # Sessions and tracks
    total_tracks = 0
    tagged_tracks = 0
    for group_name, source_file, date, notes, tracks in SESSIONS:
        gid = group_ids[group_name]
        session_id = db.create_session(source_file, gid, date=date, notes=notes)
        source_stem = Path(source_file).stem

        for i, (start, end, song_name, track_notes) in enumerate(tracks, 1):
            audio_path = fake_audio_path(source_stem, i, start, end)
            track_id = db.create_track(
                session_id=session_id,
                track_number=i,
                start_sec=float(start),
                end_sec=float(end),
                audio_path=audio_path,
            )
            if track_notes:
                db.update_track_notes(track_id, track_notes)
            if song_name:
                db.tag_track(track_id, song_name, gid)
                tagged_tracks += 1
            total_tracks += 1

    print(f"  Sessions: {len(SESSIONS)}")
    print(f"  Tracks: {total_tracks} ({tagged_tracks} tagged, {total_tracks - tagged_tracks} untagged)")
    print(f"\nAll users have password: {DEFAULT_PASSWORD}")
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])
        db = Database(db_path)
    else:
        db = Database()
    try:
        seed(db)
    finally:
        db.close()
