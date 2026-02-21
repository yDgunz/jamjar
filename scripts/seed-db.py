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
        #
        "[Verse 1]\n"
        "Fat cat sittin' on the windowsill\n"
        "Watchin' the world go by\n"
        "Got no worries, got no bills\n"
        "Just a lazy kinda guy\n"
        "\n"
        "He don't care about the rent\n"
        "He don't care about the news\n"
        "Stretched out long in a patch of sun\n"
        "Ain't got nothin' left to lose\n"
        "\n"
        "[Chorus]\n"
        "Fat cat, fat cat\n"
        "Livin' like a king on a welcome mat\n"
        "Fat cat, fat cat\n"
        "Where'd you learn to live like that?\n"
        "\n"
        "[Verse 2]\n"
        "Screen door swingin' in the summer heat\n"
        "Crickets singin' out of time\n"
        "He just yawns and licks his feet\n"
        "Like the whole damn world is fine\n"
        "\n"
        "Mailman comes, he doesn't flinch\n"
        "Thunder rolls, he doesn't care\n"
        "Only moves about an inch\n"
        "When you're sittin' in his chair\n"
        "\n"
        "[Chorus]\n"
        "Fat cat, fat cat\n"
        "Livin' like a king on a welcome mat\n"
        "Fat cat, fat cat\n"
        "Where'd you learn to live like that?\n"
        "\n"
        "[Bridge]\n"
        "Maybe he knows somethin' that we don't\n"
        "Maybe he's the wise one after all\n"
        "We keep runnin' but he won't\n"
        "He just watches from the wall\n"
        "\n"
        "[Chorus]\n"
        "Fat cat, fat cat\n"
        "Livin' like a king on a welcome mat\n"
        "Fat cat, fat cat\n"
        "Where'd you learn to live like that?\n"
        "\n"
        "[Outro]\n"
        "Where'd you learn to live like that?\n"
        "Where'd you learn to live... like that?",
        #
        "Key of E. Dave kicks off the riff, bass comes in on the & of beat 4. "
        "Bridge is half-time feel.",
    ),
    "Good God Damn": (
        "Intro: Am | Am | Am | Am\n"
        "Verse: Am | C | G | D\n"
        "Chorus: F | G | Am | Am\n"
        "Outro: Am | G | F | E",
        #
        "[Verse 1]\n"
        "Good god damn, what a mess\n"
        "Woke up late in yesterday's dress\n"
        "Coffee's cold and the dog got out\n"
        "That's what Monday's all about\n"
        "\n"
        "Phone is buzzin' with the things I missed\n"
        "Boss is callin', landlord's pissed\n"
        "Stepped outside and it started to rain\n"
        "Here we go again\n"
        "\n"
        "[Chorus]\n"
        "Good god damn, good god damn\n"
        "Nothin' ever goes the way I plan\n"
        "Good god damn, good god damn\n"
        "Doin' the best that I can\n"
        "\n"
        "[Verse 2]\n"
        "Truck won't start, battery's dead\n"
        "Got a song stuck in my head\n"
        "Can't remember if I locked the door\n"
        "What am I even livin' for?\n"
        "\n"
        "But then the sun breaks through the clouds\n"
        "Neighbor waves and the kid laughs loud\n"
        "Maybe Monday ain't so bad\n"
        "Best worst day I ever had\n"
        "\n"
        "[Chorus]\n"
        "Good god damn, good god damn\n"
        "Nothin' ever goes the way I plan\n"
        "Good god damn, good god damn\n"
        "Doin' the best that I can\n"
        "\n"
        "[Outro]\n"
        "Good god damn... good god damn...\n"
        "Doin' the best that I can\n"
        "Yeah, doin' the best that I can",
        #
        "Starts quiet, builds each verse. Outro is a slow burn — let the last Am ring.",
    ),
    "Spit Me Out": (
        "Verse: D | F#m | Bm | G\n"
        "Pre-chorus: G | A | G | A\n"
        "Chorus: D | A | Bm | G",
        #
        "[Verse 1]\n"
        "You took a bite and spit me out\n"
        "Left me lyin' on the ground\n"
        "Said I wasn't what you wanted\n"
        "Wasn't worth the keepin' round\n"
        "\n"
        "[Pre-chorus]\n"
        "But I got up, I brushed it off\n"
        "I found my feet, I found my way\n"
        "\n"
        "[Chorus]\n"
        "You can spit me out\n"
        "But I won't stay down\n"
        "You can spit me out\n"
        "But I'll come back around\n"
        "\n"
        "[Verse 2]\n"
        "Every scar's a lesson learned\n"
        "Every bruise a badge of pride\n"
        "You thought I'd crumble at the curb\n"
        "But I'm still standin' on this side\n"
        "\n"
        "[Pre-chorus]\n"
        "I got up, I brushed it off\n"
        "I found my spine, I found my say\n"
        "\n"
        "[Chorus]\n"
        "You can spit me out\n"
        "But I won't stay down\n"
        "You can spit me out\n"
        "But I'll come back around\n"
        "\n"
        "[Bridge]\n"
        "Maybe I should thank you\n"
        "For showin' me the door\n"
        "'Cause the view from here is better\n"
        "Than anything before\n"
        "\n"
        "[Chorus]\n"
        "You can spit me out\n"
        "But I won't stay down\n"
        "Spit me out\n"
        "I'll come back around",
        #
        "Uptempo. The pre-chorus pushes hard — don't rush into the chorus, "
        "leave a breath. Eric drops out on bass for the first half of verse 2.",
    ),
    "Be Forever": (
        "Intro: Cmaj7 | Em7 | Am7 | Fmaj7\n"
        "Verse: C | Em | Am | F\n"
        "Chorus: F | G | Am | C\n"
        "Bridge: Dm | G | C | Am",
        #
        "[Verse 1]\n"
        "If I could be forever\n"
        "Standin' in the pouring rain\n"
        "I'd hold the sky together\n"
        "Just to wash away the pain\n"
        "\n"
        "Every drop a little prayer\n"
        "Every puddle a goodbye\n"
        "I'd be soaked down to the bone\n"
        "But at least I'd feel alive\n"
        "\n"
        "[Chorus]\n"
        "Be forever, be forever\n"
        "Caught between the earth and sky\n"
        "Be forever, be forever\n"
        "Some things never really die\n"
        "\n"
        "[Verse 2]\n"
        "If I could be forever\n"
        "Sittin' on your front porch step\n"
        "Watchin' fireflies in the evening\n"
        "Before the world had wept\n"
        "\n"
        "I'd stay right there in the amber light\n"
        "With the radio down low\n"
        "And I'd hold that moment tight\n"
        "And never let it go\n"
        "\n"
        "[Chorus]\n"
        "Be forever, be forever\n"
        "Caught between the earth and sky\n"
        "Be forever, be forever\n"
        "Some things never really die\n"
        "\n"
        "[Bridge]\n"
        "Time moves on, I know it does\n"
        "But the heart holds what it was\n"
        "And somewhere in the in-between\n"
        "Is every song we never sing\n"
        "\n"
        "[Final chorus]\n"
        "Be forever, be forever\n"
        "Caught between the earth and sky\n"
        "Be forever, be forever\n"
        "You and I... you and I",
        #
        "Ballad feel. Key change from C to D on the last chorus — watch Dave's nod.",
    ),
    "River Mouth": (
        "Intro: Em | Em | Em | Em\n"
        "Verse: Em | G | C | D\n"
        "Chorus: C | D | Em | Em\n"
        "Breakdown: Am | Am | Em | Em",
        #
        "[Verse 1]\n"
        "Down by the river mouth\n"
        "Where the water meets the sound\n"
        "I left my heavy heart\n"
        "And let the current pull it down\n"
        "\n"
        "The cattails bent and whispered\n"
        "Like they knew what I'd been through\n"
        "And the heron didn't move\n"
        "Just stood there like it knew\n"
        "\n"
        "[Chorus]\n"
        "Let the river take it\n"
        "Let the river carry me\n"
        "Let the river take it\n"
        "Out beyond the cypress trees\n"
        "\n"
        "[Verse 2]\n"
        "I sat there 'til the sunset\n"
        "Turned the water into gold\n"
        "And every stone I skipped\n"
        "Was another story told\n"
        "\n"
        "The bullfrogs started singing\n"
        "And the bats came out to play\n"
        "And for the first time in forever\n"
        "I had nothin' left to say\n"
        "\n"
        "[Chorus]\n"
        "Let the river take it\n"
        "Let the river carry me\n"
        "Let the river take it\n"
        "Out beyond the cypress trees\n"
        "\n"
        "[Breakdown]\n"
        "(bass and drums only)\n"
        "\n"
        "[Verse 3]\n"
        "Now I go back every Sunday\n"
        "When the world gets way too loud\n"
        "Sit right down on that same bank\n"
        "And let the river sort it out\n"
        "\n"
        "[Chorus]\n"
        "Let the river take it\n"
        "Let the river carry me\n"
        "Let the river take it\n"
        "All the way out to the sea",
        #
        "Open-string riff in the intro. Breakdown is just bass and drums, "
        "guitar comes back on the repeat.",
    ),
    "Dust & Neon": (
        "Verse: A | D | A | E\n"
        "Chorus: D | E | A | F#m\n"
        "Solo: A | D | E | A",
        #
        "[Verse 1]\n"
        "Dust and neon, two-lane road\n"
        "Dashboard lights and a heavy load\n"
        "Left that town in the rearview glow\n"
        "Ain't comin' back, that much I know\n"
        "\n"
        "Diner coffee at a quarter past three\n"
        "Waitress smiled and looked right through me\n"
        "Jukebox playin' somethin' old and slow\n"
        "Reminded me of letting go\n"
        "\n"
        "[Chorus]\n"
        "Dust and neon, that's all I see\n"
        "Mile markers countin' down to free\n"
        "Dust and neon in the dead of night\n"
        "Chasin' somethin' that feels right\n"
        "\n"
        "[Verse 2]\n"
        "Crossed the state line just past dawn\n"
        "Radio faded, so I drove on\n"
        "Windows down in the desert heat\n"
        "Gravel hummin' underneath my feet\n"
        "\n"
        "Saw a sign for a town I'd never heard\n"
        "Population: none — or so the paint inferred\n"
        "Pulled off the highway just because I could\n"
        "Stood in the silence and it felt good\n"
        "\n"
        "[Chorus]\n"
        "Dust and neon, that's all I see\n"
        "Mile markers countin' down to free\n"
        "Dust and neon in the dead of night\n"
        "Chasin' somethin' that feels right\n"
        "\n"
        "[Solo]\n"
        "(trade off)\n"
        "\n"
        "[Verse 3]\n"
        "Maybe I'll stop when the gas runs out\n"
        "Maybe I'll stop when I figure it out\n"
        "But for now the white lines pull me on\n"
        "Dust and neon 'til the dust is gone\n"
        "\n"
        "[Chorus]\n"
        "Dust and neon, that's all I see\n"
        "Mile markers countin' down to free\n"
        "Dust and neon in the dead of night\n"
        "Chasin' somethin' that feels right\n"
        "\n"
        "[Outro]\n"
        "Dust and neon... dust and neon...\n"
        "Chasin' somethin' that feels right",
        #
        "Driving rock feel. Bass follows the kick pattern in the verse, "
        "locks with guitar on the chorus. Solo section is open — trade off.",
    ),
    "Low Tide": (
        "Intro: Dm | Am | Bb | F\n"
        "Verse: Dm | Am | Bb | C\n"
        "Chorus: Bb | C | Dm | Dm",
        #
        "[Verse 1]\n"
        "Low tide pulling at the shore\n"
        "Everything I had before\n"
        "Slipping through my hands like sand\n"
        "Nothing goes the way you plan\n"
        "\n"
        "Seashells broken, scattered wide\n"
        "Footprints vanish with the tide\n"
        "I keep looking for a sign\n"
        "But the ocean takes its time\n"
        "\n"
        "[Chorus]\n"
        "Low tide, low tide\n"
        "Take me where the water's wide\n"
        "Low tide, low tide\n"
        "I'll be waitin' on the other side\n"
        "\n"
        "[Verse 2]\n"
        "Moon is pullin' from so far\n"
        "Doesn't know how small we are\n"
        "Still it moves the whole damn sea\n"
        "Maybe it could move in me\n"
        "\n"
        "Salt air stings but clears the head\n"
        "Better than the words unsaid\n"
        "Let the fog roll in tonight\n"
        "I don't need to see the light\n"
        "\n"
        "[Chorus]\n"
        "Low tide, low tide\n"
        "Take me where the water's wide\n"
        "Low tide, low tide\n"
        "I'll be waitin' on the other side\n"
        "\n"
        "[Bridge]\n"
        "And when the morning comes\n"
        "The tide will turn again\n"
        "And all the things I lost\n"
        "Will wash back in\n"
        "\n"
        "[Chorus]\n"
        "Low tide, low tide\n"
        "Take me where the water's wide\n"
        "Low tide, low tide\n"
        "I'll be waitin'... on the other side",
        #
        "Slow and spacey. Lots of reverb. Let notes ring and decay. "
        "Mike plays sparse — leave room.",
    ),
    "Copper Wire": (
        "Verse: Em | Em | Am | Am\n"
        "Build: C | D | Em | Em\n"
        "Peak: Em | G | D | Am",
        #
        "[Verse 1]\n"
        "Copper wire hummin' in the wall\n"
        "Signal fadin' down the hall\n"
        "Can you hear me through the static?\n"
        "Are you there at all?\n"
        "\n"
        "Fluorescent flicker, empty room\n"
        "A frequency I can't quite tune\n"
        "Somethin's buzzin' in the background\n"
        "Like a half-remembered tune\n"
        "\n"
        "[Build]\n"
        "And it's gettin' louder now\n"
        "And it's gettin' louder now\n"
        "\n"
        "[Peak]\n"
        "Copper wire, copper wire\n"
        "Burnin' through the noise and fire\n"
        "Copper wire, copper wire\n"
        "Take me higher, take me higher\n"
        "\n"
        "[Verse 2]\n"
        "Hands are shakin', amp is fed\n"
        "Every word I never said\n"
        "Runs along the copper vein\n"
        "Straight from the heart into the brain\n"
        "\n"
        "Volume up until it hurts\n"
        "Feedback sings in little bursts\n"
        "This is where the silence breaks\n"
        "This is where the whole thing shakes\n"
        "\n"
        "[Build]\n"
        "And it's gettin' louder now\n"
        "And it's gettin' louder now\n"
        "\n"
        "[Peak]\n"
        "Copper wire, copper wire\n"
        "Burnin' through the noise and fire\n"
        "Copper wire, copper wire\n"
        "Take me higher, take me higher\n"
        "\n"
        "[Feedback section]\n"
        "(controlled chaos — come back in together on the downbeat)\n"
        "\n"
        "[Peak — final]\n"
        "Copper wire, copper wire\n"
        "Burnin' through the noise and fire\n"
        "Copper wire...\n"
        "(let ring and decay)",
        #
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
