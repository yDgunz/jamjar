# Operations

## Resetting the server

Full reset of the production server: wipe the database, clear R2 storage, and recreate the superadmin user.

### Prerequisites

- SSH access to the server (credentials in GitHub Secrets)
- R2 credentials in your local `.env` with `JAM_R2_ENABLED=true`

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
