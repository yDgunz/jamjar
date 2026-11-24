#!/usr/bin/env python3
"""Import a piano-repertoire score library into a JamJar group, through the API.

Each piece in the library's index.json becomes a song (title -> name,
composer -> artist) with its MusicXML file attached as the song's score.

    python scripts/import-piano-library.py LIBRARY_DIR -s https://jam-jar.app -g Solo
    python scripts/import-piano-library.py LIBRARY_DIR -s https://jam-jar.app -g Solo --apply

Without --apply it only prints what it would do. It is safe to re-run:

- A song with the same name (ignoring case) already in the group is reused; its
  artist, chord sheet and notes are left alone and the score is attached to it.
- A song whose score is already this exact file is skipped (the server's
  score_version is the same hash the library uses as the piece id).
- A song that already has a *different* score is left alone and reported.
- Two pieces in the library with the same title: the later-added one is named
  "<title> (alternate edition)".

The API key is read from --api-key, $JAM_API_KEY, or JAM_API_KEY in ./.env.
Status, tags, difficulty, tempo and recorded takes are not imported.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests


def load_api_key(explicit: str | None) -> str:
    if explicit:
        return explicit
    if os.environ.get("JAM_API_KEY"):
        return os.environ["JAM_API_KEY"]
    env = Path(".env")
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("JAM_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    sys.exit("No API key: pass --api-key, set JAM_API_KEY, or run from a directory with .env")


def plan_names(entries: list[dict]) -> list[tuple[dict, str]]:
    """Pair each library entry with the song name it gets, resolving in-library duplicates."""
    seen: set[str] = set()
    planned = []
    for entry in sorted(entries, key=lambda e: e["addedAt"]):
        name = entry["title"].strip()
        if name.lower() in seen:
            name = f"{name} (alternate edition)"
        if name.lower() in seen:
            sys.exit(f"Three pieces share the title {entry['title']!r}; rename one first")
        seen.add(name.lower())
        planned.append((entry, name))
    return sorted(planned, key=lambda p: p[1].lower())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("library", type=Path, help="the library's scores directory (has index.json)")
    ap.add_argument("-s", "--server", required=True, help="e.g. https://jam-jar.app")
    ap.add_argument("-g", "--group", required=True, help="group name to import into")
    ap.add_argument("--api-key")
    ap.add_argument("--apply", action="store_true", help="make the changes (default: dry run)")
    args = ap.parse_args()

    base = args.server.rstrip("/")
    http = requests.Session()
    http.headers["X-API-Key"] = load_api_key(args.api_key)

    def call(method: str, path: str, **kw):
        resp = http.request(method, base + path, timeout=60, **kw)
        if resp.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    entries = json.loads((args.library / "index.json").read_text())
    planned = plan_names(entries)
    for entry, _ in planned:
        ext = "mxl" if entry["format"] == "mxl" else "musicxml"
        entry["_file"] = args.library / f"{entry['id']}.{ext}"
        if not entry["_file"].exists():
            sys.exit(f"Missing score file for {entry['title']!r}: {entry['_file']}")

    groups = [g for g in call("GET", "/api/admin/groups") if g["name"] == args.group]
    if not groups:
        sys.exit(f"Group {args.group!r} not found on {base}")
    group_id = groups[0]["id"]
    existing = {s["name"].lower(): s for s in call("GET", f"/api/songs?group_id={group_id}")}
    if existing and "score_version" not in next(iter(existing.values())):
        sys.exit("This server does not support song scores yet (no score_version field)")

    print(f"{'APPLYING' if args.apply else 'DRY RUN'}: {len(planned)} pieces -> "
          f"group {args.group!r} (id {group_id}, {len(existing)} songs) on {base}\n")

    counts = {"created": 0, "attached": 0, "already": 0, "conflict": 0, "failed": 0}
    for entry, name in planned:
        song = existing.get(name.lower())
        if song and song["score_version"] == entry["id"]:
            counts["already"] += 1
            continue
        if song and song["score_version"]:
            counts["conflict"] += 1
            print(f"  SKIP     {name!r}: song {song['id']} already has a different score")
            continue
        action = "attach" if song else "create"
        target = f"existing song {song['id']} ({song['artist'] or 'no artist'})" if song else "new"
        print(f"  {action.upper():8} {name!r} | {entry['composer']} -> {target}")
        if args.apply:
            try:
                if not song:
                    song = call("POST", "/api/songs", json={
                        "name": name, "group_id": group_id, "artist": entry["composer"].strip(),
                    })
                with open(entry["_file"], "rb") as f:
                    done = call("PUT", f"/api/songs/{song['id']}/score",
                                files={"file": (entry["_file"].name, f)})
                if done["score_version"] != entry["id"]:
                    raise RuntimeError(f"server stored version {done['score_version']}")
            except Exception as e:  # keep going; a re-run picks up what failed
                counts["failed"] += 1
                print(f"           FAILED: {e}")
                continue
            time.sleep(0.05)
        counts["created" if action == "create" else "attached"] += 1

    verb = "" if args.apply else "would be "
    print(f"\n{counts['created']} {verb}created with a score, "
          f"{counts['attached']} {verb}attached to an existing song, "
          f"{counts['already']} already imported, {counts['conflict']} skipped (different score), "
          f"{counts['failed']} failed.")

    if args.apply:
        after = call("GET", f"/api/songs?group_id={group_id}")
        ids = {e["id"] for e in entries}
        have = sum(1 for s in after if s["score_version"] in ids)
        print(f"Verified on server: {have} of {len(ids)} pieces have their score "
              f"({len(after)} songs in the group).")
        if have != len(ids) or counts["failed"]:
            sys.exit(1)


if __name__ == "__main__":
    main()
