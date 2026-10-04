# Raspberry Pi production deployment

Production and development use the same source and Compose base. The root `.env`
selects the production overlay, Atlas database, and separate runtime name.
See [environment configuration](environments.md) for the complete variable list.
For backup evidence and recovery, see the
[recovery runbook](hibernation-recovery-runbook.md). Hibernation is optional.

```text
Browser -> Cloudflare -> cloudflared -> nginx -> Express -> MongoDB Atlas
                                                |
                                                +-> Ollama
```

The production Compose file publishes no host ports. Cloudflare Tunnel is the
only ingress; do not configure router port forwarding.

## Prerequisites

- Raspberry Pi OS Lite 64-bit on a cooled Pi with reliable storage and power
- Docker Engine plus the Compose plugin (`docker compose version`)
- MongoDB Atlas database, least-privileged database user, and a `/32` Atlas IP allow-list entry for the Pi
- Cloudflare-managed domain and a remotely managed tunnel
- Google OAuth web client with Gmail API enabled, if Gmail is used

Verify `dpkg --print-architecture` prints `arm64` and `docker run --rm hello-world`
works without `sudo`.

## Install the reviewed production revision

```bash
sudo mkdir -p /opt/secureinbox
sudo chown "$USER":"$USER" /opt/secureinbox
git clone --branch prod https://github.com/AndreiStolojan/SecureInbox.git /opt/secureinbox
cd /opt/secureinbox
git status --short --branch
git rev-parse HEAD
```

`prod` is the deployment branch. It must point to a reviewed, tested revision;
the Pi must never pull `main` as part of a routine update.

## Configure secrets

Use one root configuration. `-n` never overwrites an existing `.env`; on an
installation that already has one, follow the migration section below instead.

```bash
cp -n .env.example .env
chmod 600 .env
```

Apply the production values from [environments.md](environments.md). Keep the
existing Atlas URI, JWT secret, Gmail encryption key, OAuth credentials, and
tunnel token when migrating. The tunnel service remains `http://frontend:80`.
For a new installation, generate unique secrets with `openssl rand -hex 32`.

## Proxy and rate-limit identity

Production mounts `frontend/nginx.prod.conf`. The production-only `edge`
network has cloudflared as nginx's only peer; nginx resolves and trusts that
service name for `CF-Connecting-IP`, then replaces rather than appends the
forwarded client-IP chain. It forwards that client IP and `https` to the
backend, so Express's single trusted nginx hop keeps distinct public visitors
in distinct rate-limit buckets. Only optional monitoring publishes loopback ports, so the
backend and nginx are reachable only through the private Compose network and
cloudflared.

## Validate and start

```bash
docker compose config --quiet
./provision
docker compose ps
```

Ollama is optional. Enable the `ai` profile before running provisioning if the
Pi should host the model. Monitoring uses the separate `monitoring` profile.

### Choosing the model

`qwen2.5:7b-instruct` is 4.7 GB on disk and needs roughly 6 GB resident, so it
suits an 8 GB or 16 GB Pi 5 and not a 4 GB one. The size matters more than it
looks. Measured with `npm run eval:semantic` over the 40-message labelled corpus
in `backend/tests/fixtures/semantic-eval.fixtures.js`, on identical code and the
same prompt:

| | `qwen2.5:1.5b-instruct-q4_K_M` | `qwen2.5:7b-instruct` |
| --- | --- | --- |
| false positives on legitimate mail | 0% | 0% |
| signal accuracy | 15% | 85% |
| useful signal on malicious mail | 10% | 90% |

At 1.5B the semantic layer is effectively inert: it is quiet on benign mail only
because it has stopped discriminating at all, and it contributes nothing on real
phishing. It is harmless but not worth its latency. Prefer 7B wherever the RAM
allows, and re-run the evaluation after any prompt change:

```bash
cd backend && OLLAMA_MODEL=qwen2.5:7b-instruct npm run eval:semantic
```

`OLLAMA_TIMEOUT_MS` defaults to 300000 (5 minutes) because a 7B model on Pi 5
CPU is far slower than on a laptop. Scanning runs in the background, so latency
costs throughput rather than interactivity.

Check private health endpoints and then the public hostname:

```bash
docker compose exec frontend wget -qO- http://backend:5500/api/v1/ready
curl -i https://YOUR_HOSTNAME/api/v1/ready
```

## Promote and update safely

Test changes on a branch and merge them to `main`. Then open, or refresh, the
promotion PR from `main` into `prod`. Merge it when the required checks pass on
its exact head and its description records the release contents, the rollback
revision, and any configuration migration (see
[repository-controls.md](repository-controls.md)).

### Back up before every deployment

Take a database dump and a copy of the configuration, and tag the running
images, before changing anything. The copies stay on the Pi with mode `600`;
they are the fast rollback path, not a replacement for the owner's encrypted
off-device backups in the [recovery runbook](hibernation-recovery-runbook.md).

```bash
cd /opt/secureinbox
backup="$HOME/secureinbox-backups/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
install -d -m 700 "$backup"
cp -p .env "$backup/root.env"
test ! -f backend/.env.production.local || cp -p backend/.env.production.local "$backup/backend.env.production.local"
DB_URI="$(bash -c 'source scripts/dotenv.sh; dotenv_get DB_URI backend/.env.production.local 2>/dev/null || dotenv_get DB_URI .env')" \
  docker run --rm -e DB_URI mongo:8.0.28 sh -c 'mongodump --uri "$DB_URI" --archive --gzip --quiet' > "$backup/db.archive.gz"
chmod 600 "$backup"/*
for image in secureinbox-backend secureinbox-frontend; do
  docker tag "$image:latest" "$image:rollback-$(git rev-parse --short HEAD)"
done
```

`mongodump` only reads. The database URI is passed through the environment, so
it never appears in a command line or a log.

### Migrate an installation from before the consolidated configuration

Revisions up to `dd7b89f` kept application secrets in
`backend/.env.production.local` and only the tunnel and Grafana values in the
root `.env`. Current revisions read everything from the root `.env`. The
backend does not read the old file at all, and `./provision` refuses a root
`.env` without `NODE_ENV` rather than generate new secrets into it.

Build the new root `.env` from both old files, keeping every value verbatim:

- Every key of `backend/.env.production.local`, including the feature flags.
  Compose defaults `THREAT_INTEL_ENABLED`, `ATTACHMENT_ANALYSIS_ENABLED` and
  `GMAIL_PUSH_ENABLED` to `false` and `ARCJET_ENV` to `development`, so a
  forgotten flag silently weakens detection or rate limiting.
- `DB_URI` exactly as it is. An installation whose URI has no database path
  uses the driver's default database; copying the example path instead would
  point at an empty database.
- `TUNNEL_TOKEN`, `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` from the old
  root `.env`.
- Then the layout keys: `NODE_ENV=production`, `COMPOSE_PROJECT_NAME=secureinbox`,
  `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`,
  `COMPOSE_PROFILES=monitoring`, `SEED_DEMO=false`, `APP_PORT=8080`,
  `PROMETHEUS_PORT=9090` and `GRAFANA_PORT=3000`.

```bash
cd /opt/secureinbox
umask 077
{
  cat backend/.env.production.local
  grep -E '^(TUNNEL_TOKEN|GRAFANA_ADMIN_USER|GRAFANA_ADMIN_PASSWORD)=' "$backup/root.env"
  printf '%s\n' NODE_ENV=production COMPOSE_PROJECT_NAME=secureinbox \
    COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml COMPOSE_PROFILES=monitoring \
    SEED_DEMO=false APP_PORT=8080 PROMETHEUS_PORT=9090 GRAFANA_PORT=3000
} | awk -F= '!/^[[:space:]]*(#|$)/ { last[$1] = $0; if (!($1 in seen)) { seen[$1] = 1; order[++n] = $1 } }
             END { for (i = 1; i <= n; i++) print last[order[i]] }' > .env.new
mv .env.new .env
```

Before starting, compare the variable NAMES the running backend has with the
ones the new configuration gives it. Only names are printed:

```bash
docker exec secureinbox-backend-1 printenv | cut -d= -f1 | sort > /tmp/before.names
docker compose --env-file .env config --format json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s).services.backend.environment).sort().join("\n")))' > /tmp/after.names
comm -23 /tmp/before.names /tmp/after.names
```

Anything listed besides shell and image variables (`PATH`, `HOSTNAME`, `HOME`,
`NODE_VERSION`, `YARN_VERSION`) is a value the new release would lose. Keep
`backend/.env.production.local` until the release is verified: rollback to
`dd7b89f` needs it.

### Update the Pi from `prod`

```bash
cd /opt/secureinbox
git fetch origin
git switch prod
git pull --ff-only origin prod
docker compose build --pull
docker compose up -d
docker compose ps
```

On a consolidated installation `./provision` validates the configuration and
runs the same build and `up`. Record `git rev-parse HEAD` after each
deployment. Stop if the working tree is not clean; do not resolve local changes
by pulling `main`.

CI verifies the promotion inputs only. Rollout remains a manual Pi operation
until dedicated deployment infrastructure is introduced.

## Backups and maintenance

Atlas backups protect the database, but Gmail OAuth tokens stored there cannot
be recovered without the matching `MAIL_TOKEN_ENCRYPTION_KEY`. Keep encrypted,
access-controlled backups of `.env` separately from the database backup. Test a
restore before relying on it.

Regularly check `docker compose ps`, disk space,
Pi temperature, tunnel status, Atlas access rules, and container logs. Keep
the OS and Docker patched.
