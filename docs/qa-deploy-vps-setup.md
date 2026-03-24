# QA Deploy: VPS Manual Setup Guide

This guide walks through the one-time VPS setup needed before QA branch deployments will work. **Order matters** — follow these steps sequentially.

## Before You Start

- You need SSH access to the VPS as a user with sudo privileges
- Production is currently running at `/opt/jamjar` with Docker binding directly to port 80
- These changes will cause a brief (~5 second) production interruption during step 5

## Step 1: Install Caddy

SSH into the VPS and install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

After install, **stop Caddy immediately** — it starts automatically and will conflict with prod on port 80:

```bash
sudo systemctl stop caddy
```

Verify it installed:

```bash
caddy version
```

## Step 2: Create directories and Caddyfile

```bash
# QA sites config directory (Caddy imports from here)
sudo mkdir -p /etc/caddy/qa-sites

# QA workspaces directory
sudo mkdir -p /opt/jamjar-qa

# Make sure your deploy user owns the QA workspace
sudo chown $USER:$USER /opt/jamjar-qa
```

Write the Caddyfile:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
jam-jar.app {
    reverse_proxy localhost:8000
}

import /etc/caddy/qa-sites/*
EOF
```

## Step 3: Configure DNS

Both `jam-jar.app` and `*.jam-jar.app` must be set to **"DNS only" (gray cloud)** in Cloudflare — not "Proxied" (orange cloud).

**Why DNS only is required:** Caddy obtains TLS certificates from Let's Encrypt using the TLS-ALPN-01 challenge. When Cloudflare proxy is enabled, Cloudflare terminates TLS before traffic reaches the VPS, which prevents Caddy from completing the challenge. Caddy will fail to start or serve HTTPS if the records are proxied.

**What you lose with DNS only:**
- No Cloudflare CDN caching (minimal impact — the app serves dynamic content and audio streams, not static assets that benefit from edge caching)
- No Cloudflare DDoS protection (low risk for a small private app; if this becomes a concern, switch to the Caddy Cloudflare DNS module for DNS-01 challenges, which works with proxied records)
- Your VPS IP is visible in DNS lookups (it's already known via SSH access, so this is not a meaningful exposure increase)

**What you keep:** Caddy provides TLS with auto-renewal, HTTP→HTTPS redirect, and HTTP/2 — covering the important security basics.

Add/verify these DNS records in Cloudflare:

| Type | Name | Value | Proxy status |
|------|------|-------|-------------|
| A | `jam-jar.app` | `<VPS IP>` | DNS only (gray cloud) |
| A | `*.jam-jar.app` | `<VPS IP>` | DNS only (gray cloud) |

**Note:** DNS propagation can take a few minutes to a few hours. You can proceed with the remaining steps while it propagates. To check if it's working:

```bash
# Run this from your local machine (not the VPS)
dig +short test-anything.jam-jar.app
# Should return your VPS IP
```

## Step 4: Grant deploy user Caddy reload permission

The GitHub Actions SSH user needs to run `sudo caddy reload` without a password. Add a sudoers rule:

```bash
# Replace 'deploy' with your actual SSH_USER
sudo tee /etc/sudoers.d/caddy-reload > /dev/null <<'EOF'
root ALL=(ALL) NOPASSWD: /usr/bin/caddy reload --config /etc/caddy/Caddyfile
EOF
sudo chmod 440 /etc/sudoers.d/caddy-reload
```

Verify it works without a password:

```bash
# This should NOT prompt for a password
sudo caddy reload --config /etc/caddy/Caddyfile 2>&1 || echo "Expected to fail (Caddy not running yet)"
```

## Step 5: Switch production behind Caddy

**This is the step that briefly interrupts production.** It takes about 5 seconds.

The sequence:
1. Stop prod (frees port 80)
2. Change prod to bind to localhost:8000
3. Start prod on the new port
4. Start Caddy (takes over port 80, proxies to localhost:8000)

```bash
cd /opt/jamjar

# Stop production
docker compose down

# Update the port mapping
# Change:  "80:8000"
# To:      "127.0.0.1:8000:8000"
sed -i 's/"80:8000"/"127.0.0.1:8000:8000"/' docker-compose.yml

# Start production on the new port
docker compose up -d

# Verify prod is listening on localhost:8000
curl -sf http://localhost:8000/health
# Should return: {"status":"ok"}

# Now start Caddy — it takes over ports 80 and 443
sudo systemctl start caddy
sudo systemctl enable caddy
```

**Verify production works through Caddy:**

```bash
# From the VPS
curl -sf http://localhost:8000/health    # direct — should work
curl -sf https://jam-jar.app/health      # through Caddy — should work (once DNS propagates)

# From your local machine
curl -sf https://jam-jar.app/health      # should work
```

If something goes wrong, roll back:

```bash
# Emergency rollback: put prod back on port 80
sudo systemctl stop caddy
cd /opt/jamjar
docker compose down
sed -i 's/"127.0.0.1:8000:8000"/"80:8000"/' docker-compose.yml
docker compose up -d
```

## Step 6: Set the QA password

Add `JAM_QA_PASSWORD` to the production `.env` file. This is the password used for all seeded test users in QA environments.

```bash
cd /opt/jamjar

# Choose a password — this is what you'll use to log into QA environments
echo 'JAM_QA_PASSWORD=your-qa-password-here' >> .env
```

## Step 7: Verify firewall

QA containers bind to localhost-only ports (8001+). Make sure your firewall doesn't expose them externally:

```bash
# Check if ufw is active
sudo ufw status

# Ports 80 and 443 should be open (for Caddy)
# Ports 8000-8099 should NOT be listed (they're localhost-only via Docker)
```

If you're not using ufw, check iptables:

```bash
sudo iptables -L -n | grep -E '800[0-9]'
# Should return nothing — these ports are only on localhost
```

## Step 8: Verify Caddy admin API

```bash
curl -sf localhost:2019/config/ | python3 -m json.tool | head -20
```

This should return Caddy's JSON config. The admin API is only accessible from localhost (default).

## Step 9: Push the code and test

Back on your local machine, push the commits:

```bash
git push origin main
```

**Important:** The prod deploy workflow will run and do `git pull` + `docker compose up --build`. Since you already updated `docker-compose.yml` on the VPS in Step 5, and the pushed code has the same change, this is a no-op for the port mapping. Production won't be interrupted.

Then test the QA pipeline:

```bash
# Create a test branch and PR
git checkout -b test/qa-deploy
git commit --allow-empty -m "test: verify QA deploy pipeline"
git push -u origin test/qa-deploy
gh pr create --title "Test QA deploy" --body "Testing the QA deploy pipeline"

# Trigger the deploy
gh pr edit --add-label deploy-qa

# Watch the workflow
gh run watch

# After it completes, check the PR for the QA URL comment
# Visit https://test-qa-deploy.jam-jar.app in a browser
# Log in with user "test" and your JAM_QA_PASSWORD

# Test teardown
gh pr close

# Verify cleanup
# SSH into VPS and confirm /opt/jamjar-qa/test-qa-deploy/ is gone
```

## Checklist

- [ ] Caddy installed
- [ ] `/etc/caddy/qa-sites/` directory created
- [ ] `/opt/jamjar-qa/` directory created
- [ ] Caddyfile written with prod proxy + import
- [ ] Wildcard DNS record added (`*.jam-jar.app`)
- [ ] Deploy user has passwordless `sudo caddy reload`
- [ ] Production switched behind Caddy (port 80 → localhost:8000)
- [ ] Production verified working through Caddy
- [ ] `JAM_QA_PASSWORD` added to `.env`
- [ ] Firewall verified (8001+ not externally accessible)
- [ ] Caddy admin API responding
- [ ] Code pushed and prod deploy successful
- [ ] Test QA deploy/teardown cycle works
