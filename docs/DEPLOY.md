# Deploying Rollproof

One server runs everything: Caddy (HTTPS, the dashboard, the mobile web build and the API under `/api`), the API and MongoDB. The same steps give a production install or the public demo; the demo adds one compose file.

## 1. Server and domain

- A Linux VM with 2 vCPUs and 4 GB of memory is enough for a demo or a few hundred employees (for example Hetzner CX22, DigitalOcean or any VPS with Docker). Face matching needs no GPU.
- A domain with two DNS records pointing at the server: `A` (IPv4) and, if the server has one, `AAAA` (IPv6). The demo uses `demo.rollproof.app`.
- Open ports 80 and 443 (TCP) and 443 (UDP, HTTP/3). Nothing else needs to be reachable.

Install Docker Engine with the compose plugin ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)), then:

```bash
sudo mkdir -p /opt/rollproof && sudo chown "$USER" /opt/rollproof
git clone https://github.com/Javanian/Hadir-Ops.git /opt/rollproof
cd /opt/rollproof
```

## 2. Configuration

```bash
cp .env.example .env
#   DOMAIN=demo.rollproof.app
#   DB_PASSWORD=$(openssl rand -hex 24)
cp backend/.env.example backend/.env
#   SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
#   optional: SENTRY_DSN=https://...  (error reports, no personal data)

openssl rand -base64 756 > deploy/mongo-keyfile
chmod 400 deploy/mongo-keyfile && sudo chown 999:999 deploy/mongo-keyfile
```

## 3. Start

Production:

```bash
docker compose -f docker-compose.prod.yml pull        # the released images from ghcr.io
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec backend \
    python scripts/create_admin.py --email it@example.com --name "IT Admin"
```

Public demo (never on a server with real data; it replaces everything every night):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up -d
```

The demo seeds itself on first start and again every day at 00:00 UTC; it needs no admin account. To build the images on the server instead of pulling them, use `up -d --build` (the web image builds the mobile web app too, which takes a few minutes).

Check it:

```bash
curl -s https://demo.rollproof.app/api/health/ready   # {"status":"ok", "version":"2.0.0", "demo":true, ...}
curl -s https://demo.rollproof.app/api/demo           # next reset time
```

Then open `https://DOMAIN` (dashboard) and `https://DOMAIN/app/` (mobile app in the browser). The camera and location prompts need HTTPS, which Caddy provides.

## 4. Updates

Releases are tagged `vX.Y.Z` and published as images. Change the tag in `docker-compose.prod.yml` (or `git pull` a newer checkout), then:

```bash
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

Verify an image before running it: `gh attestation verify oci://ghcr.io/javanian/rollproof-backend:2.0.0 --repo Javanian/Hadir-Ops`.

## 5. Monitoring

- **Uptime and status page.** Create an HTTP monitor on `https://DOMAIN/api/health/ready` every minute in [Better Stack](https://betterstack.com/uptime) or [UptimeRobot](https://uptimerobot.com) (both have free plans). The endpoint answers 503 when the database or the face model is missing, so it catches more than a dead process. Publish their status page (for example at `status.rollproof.app`) and put its badge next to the CI badge in the README.
- **Errors.** Set `SENTRY_DSN` in `backend/.env`; the environment is reported as `demo` on a demo server.
- **Logs.** `docker compose -f docker-compose.prod.yml logs -f backend web`; Caddy logs as JSON.

## 6. Backups (production)

```bash
crontab -e
# 15 1 * * * cd /opt/rollproof && ./deploy/backup.sh >> backups/backup.log 2>&1
```

The script keeps 14 days on the host; copy `backups/` off the host as well. The restore command is in the script's header. The demo needs no backups.

## 7. API reference on GitHub Pages

Once per repository: **Settings > Pages > Build and deployment > Source: GitHub Actions**. After that, every change to the API on `main` republishes the reference (workflow `api-docs.yml`).

## 8. Mobile app builds

The browser build at `/app/` needs nothing extra. For installable apps, use EAS with your Expo account:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                       # links the app to an EAS project (adds the project id to app.json)
npx eas-cli@latest env:set preview --name EXPO_PUBLIC_API_BASE_URL --value https://demo.rollproof.app/api --visibility plaintext
npx eas-cli@latest build --profile preview --platform android    # an APK anyone can install
```

Attach the APK to the GitHub release, or share the EAS link as a QR code in the README. Use the `production` profile and environment for store builds.

## 9. Releasing a version

1. Bump the version in `backend/app/__init__.py`, `backend/pyproject.toml`, `mobile/app.json` and `mobile/package.json`, and the image tags in `docker-compose.prod.yml`.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Commit, then `git tag v2.1.0 && git push origin v2.1.0`. The release workflow refuses a tag that does not match the versions or the changelog.
