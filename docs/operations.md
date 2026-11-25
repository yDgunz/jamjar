# Operations

## Resetting the server

Full reset of the production server: wipe the database, clear R2 storage, and recreate the superadmin user.

### Prerequisites

- SSH access to the server (credentials in GitHub Secrets)
- R2 credentials in your local `.env` (`JAM_R2_BUCKET`, `JAM_R2_ACCESS_KEY_ID`, `JAM_R2_SECRET_ACCESS_KEY`, `JAM_R2_ACCOUNT_ID`)

### 1. SSH into the server

```bash
ssh <user>@<host>
cd /opt/jamjar
```

### 2. Clear the Docker volume

Stop the container, remove the data volume, and restart:

```bash
docker compose down
docker volume rm jamjar_jam-data
docker compose up -d
```

This wipes the SQLite database, uploaded recordings, and exported tracks from the container's `/data` directory.

### 3. Clear R2 storage

From your **local machine** using [rclone](https://rclone.org/) (`brew install rclone`):

```bash
source .env
rclone delete ":s3,provider=Cloudflare,access_key_id=${JAM_R2_ACCESS_KEY_ID},secret_access_key=${JAM_R2_SECRET_ACCESS_KEY},endpoint=https://${JAM_R2_ACCOUNT_ID}.r2.cloudflarestorage.com:${JAM_R2_BUCKET}"
```

To preview what will be deleted first (dry run), add `--dry-run`:

```bash
source .env
rclone delete ":s3,provider=Cloudflare,access_key_id=${JAM_R2_ACCESS_KEY_ID},secret_access_key=${JAM_R2_SECRET_ACCESS_KEY},endpoint=https://${JAM_R2_ACCOUNT_ID}.r2.cloudflarestorage.com:${JAM_R2_BUCKET}" --dry-run
```

This deletes all objects but keeps the bucket itself.

### 4. Recreate the superadmin user

Still on the server, run the CLI commands inside the container:

```bash
# Create groups
docker compose exec app jam-session add-group 5Biz
docker compose exec app jam-session add-group Solo

# Create superadmin user (will prompt for password)
docker compose exec app jam-session add-user eric@example.com
docker compose exec app jam-session set-role eric@example.com superadmin

# Assign user to groups
docker compose exec app jam-session assign-user eric@example.com 5Biz
docker compose exec app jam-session assign-user eric@example.com Solo
```
## Bulk uploading recordings

Upload multiple audio files to the server using the CLI.

### Prerequisites

- Python venv activated (`source .venv/bin/activate`)
- `JAM_API_KEY` set in your environment or `.env`

### Upload all files in a directory

```bash
for f in input/*; do
  jam-session upload "$f" -s https://jam-jar.app -g <group-name>
done
```

Each upload returns a 202 and the CLI polls the processing job until it completes before moving to the next file. Files are processed sequentially.

### Upload a single file

```bash
jam-session upload "path/to/recording.m4a" -s https://jam-jar.app -g <group-name>
```

### Notes

- The `-g` flag specifies the group name. The CLI resolves this to a group ID via the server's API.
- Supported formats: `.m4a`, `.wav`, `.mp3`, `.flac`, `.ogg`
- The server processes each file in the background (song detection + track export). On a VPS this can take a few minutes per file.
- Duplicate filenames within the same group are rejected (409 error).

## Importing a piano-repertoire score library

`scripts/import-piano-library.py` copies a piano-repertoire library (its `data/scores` folder: `index.json` plus one `.mxl`/`.musicxml` per piece) into a JamJar group through the API. Each piece becomes a song (title → name, composer → artist) with the file attached as its score.

```bash
# Dry run: prints what would be created or attached, changes nothing
python scripts/import-piano-library.py ~/code/piano-repertoir/data/scores -s https://jam-jar.app -g Solo

# Do it
python scripts/import-piano-library.py ~/code/piano-repertoir/data/scores -s https://jam-jar.app -g Solo --apply
```

The API key comes from `--api-key`, `$JAM_API_KEY`, or `JAM_API_KEY` in `./.env`. It is safe to re-run: a same-named song already in the group is reused (its artist, chart and notes are untouched), a piece whose score is already on the server is skipped, and a song that already has a different score is left alone and reported. Status, tags, difficulty, tempo and recorded takes are not imported.

## Cleaning up stale local recordings

When R2 storage is enabled, source recordings are uploaded to R2 during processing and the local copies should be deleted automatically. If local copies accumulate (e.g., from a bug or interrupted processing), you can reclaim disk space with the cleanup script.

### Check disk usage

```bash
docker compose exec app du -h --max-depth=1 /data/recordings/
```

### Run the cleanup

```bash
docker compose exec app /app/scripts/cleanup-local-recordings.sh
```

The script only deletes files when `JAM_R2_BUCKET` is set. It reports how many files and how much space was reclaimed.

**Caution:** This does not verify that each file exists in R2 before deleting it. If a recording failed to upload to R2 but exists locally, it will be lost. Check the processing job status for any failed jobs before running.

## Viewing logs

### Live logs (follow)

```bash
ssh <user>@<host>
cd /opt/jamjar
docker compose logs -f
```

### Recent logs (last 100 lines)

```bash
docker compose logs --tail 100
```

### Filter by time

```bash
# Last hour
docker compose logs --since 1h

# Since a specific time
docker compose logs --since "2026-03-12T10:00:00"
```

### Search logs for errors

```bash
docker compose logs 2>&1 | grep -i error
```

### App-level logging

The FastAPI app logs to stdout inside the container. Key log events:
- Upload processing progress and errors
- Invite email send/fail
- Auth failures

## Querying the database

Run SQLite queries directly against the production database from inside the Docker container.

### Interactive shell

```bash
docker compose exec app sqlite3 /data/jam_sessions.db
```

### One-liner from the host

```bash
docker compose exec app sqlite3 /data/jam_sessions.db "SELECT count(*) FROM sessions;"
```

### Useful queries

```sql
-- List sessions
SELECT id, name, date, duration_sec FROM sessions ORDER BY date DESC;

-- List songs with track counts
SELECT s.name, s.artist, COUNT(t.id) as tracks
FROM songs s LEFT JOIN tracks t ON t.song_id = s.id
GROUP BY s.id ORDER BY s.name;

-- Check users and groups
SELECT u.email, u.role, g.name as group_name
FROM users u
JOIN user_groups ug ON ug.user_id = u.id
JOIN groups g ON g.id = ug.group_id;

-- Find untagged tracks
SELECT t.id, t.track_number, s.name as session_name
FROM tracks t
JOIN sessions s ON s.id = t.session_id
WHERE t.song_id IS NULL
ORDER BY s.date DESC;
```

## Backups and restoring the database

**What is backed up.** `scripts/backup-db.sh` makes a consistent copy of the SQLite
database with `sqlite3 .backup`, gzips it into `/data/backups` (the 30 newest are
kept) and uploads it to R2. It runs before every deploy and nightly at 03:00 from the
server's crontab (installed by the deploy); nightly output goes to
`/var/log/jam-backup.log`. Audio is not part of it: with R2 on, audio lives in the
bucket; without R2 it lives only on the server's disk.

**Where the offsite copy goes.** Set `JAM_R2_BACKUP_BUCKET` in the server's `.env` to a
bucket that has no public domain. Without it the copy goes under `backups/` in the
audio bucket with a long random name, because that bucket is public when
`JAM_R2_CUSTOM_DOMAIN` is set. A backup contains every e-mail address, password hash
and share link.

**Restoring.** This replaces the live database, so everything since the backup is
lost. The steps below have not been rehearsed against production yet; try them on a
copy first.

```bash
cd /opt/jamjar

# 1. Pick a backup (local copies; or download one from the backup bucket)
docker compose exec -T app ls -1t /data/backups | head

# 2. Keep the current database, in case the restore is the wrong call
docker compose exec -T app /app/scripts/backup-db.sh

# 3. Stop the app so nothing writes during the swap
docker compose stop app

# 4. Put the backup in place (the -wal and -shm files belong to the old database)
docker compose run --rm --no-deps -T app sh -c '
  set -e
  cd /data
  gunzip -c backups/jam_sessions_YYYYMMDD-HHMMSS.db.gz > jam_sessions.db.restored
  sqlite3 jam_sessions.db.restored "PRAGMA integrity_check;"
  rm -f jam_sessions.db-wal jam_sessions.db-shm
  mv jam_sessions.db.restored jam_sessions.db
'

# 5. Start again and check
docker compose up -d --no-build
curl -sf http://127.0.0.1:8000/health
```

Tracks cut and recordings uploaded after the backup still have their files in storage
but no rows in the restored database; Admin → Storage lists them as unreferenced.
