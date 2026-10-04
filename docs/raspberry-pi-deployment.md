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
installation that already has one, follow step 3 of "Promote and update
safely" below instead.

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
in distinct rate-limit buckets. Nothing publishes a host port, so the
backend and nginx are reachable only through the private Compose network and
cloudflared.

## Validate and start

```bash
docker compose config --quiet
./provision
docker compose ps
```

Ollama is optional. Enable the `ai` profile before running provisioning if the
Pi should host the model.

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
promotion PR from `main` into `prod`. Its description must contain a
`## Release record` with the rollback target and the backup; the required
`promotion-record` check refuses the merge until it does (see
[repository-controls.md](repository-controls.md)). Merge it when every required
check passes on its exact head.

Run the blocks below in order. Each one runs in a subshell that stops at its
first error without closing your session. Step 1 records the backup directory
in `~/secureinbox-backups/current`; later steps read it from there.

### 1. Back up before changing anything

Dump the database, copy the configuration, and tag the images the containers
are running right now. The copies stay on the Pi with mode `600`. They are the
fast rollback path, not a replacement for the owner's encrypted off-device
backups in the [recovery runbook](hibernation-recovery-runbook.md).

```bash
(
  set -Eeuo pipefail
  cd /opt/secureinbox
  test -z "$(git status --porcelain)"
  rollback="$(git rev-parse --short HEAD)"
  backup="$HOME/secureinbox-backups/$(date +%Y%m%d-%H%M%S)-$rollback"
  install -d -m 700 "$backup"
  cp -p .env "$backup/root.env"
  if test -f backend/.env.production.local; then cp -p backend/.env.production.local "$backup/backend.env.production.local"; fi
  DB_URI="$(bash -c 'source scripts/dotenv.sh; dotenv_get DB_URI backend/.env.production.local 2>/dev/null || dotenv_get DB_URI .env')" \
    docker run --rm -e DB_URI mongo:8.0.28 sh -c \
    'printf "uri: \"%s\"\n" "$DB_URI" > /tmp/dump.yaml && mongodump --config /tmp/dump.yaml --archive --gzip --quiet' \
    > "$backup/db.archive.gz"
  test -s "$backup/db.archive.gz"
  gzip -t "$backup/db.archive.gz"
  chmod 600 "$backup"/*
  for service in backend frontend; do
    docker tag "$(docker inspect --format '{{.Image}}' "secureinbox-$service-1")" "secureinbox-$service:rollback-$rollback"
  done
  printf '%s\n' "$backup" > "$HOME/secureinbox-backups/current"
  echo "backup: $backup  rollback: $rollback"
)
```

The database URI travels through the environment into a config file inside
the container, so it never appears in a command line, `ps`, or a log.
`mongodump` only reads. To check the archive restores, load it into a
throwaway container with no network and count documents:

```bash
backup="$(cat ~/secureinbox-backups/current)"
docker run -d --name restore-check --network none mongo:8.0.28
sleep 5
docker exec -i restore-check mongorestore --archive --gzip --quiet < "$backup/db.archive.gz"
docker exec restore-check mongosh --quiet --eval 'db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name))'
docker rm -f restore-check
```

### 2. Fetch the release, without starting it

```bash
(
  set -Eeuo pipefail
  cd /opt/secureinbox
  git fetch origin
  git switch prod
  git pull --ff-only origin prod
  git rev-parse HEAD
)
```

Nothing is rebuilt or restarted yet; the containers keep running the old images.

### 3. Migrate a configuration from before the consolidated layout

Skip this step when the root `.env` already contains `NODE_ENV=production`.

Revisions up to `dd7b89f` kept application secrets in
`backend/.env.production.local` and only the tunnel and Grafana values in the
root `.env`. Current revisions read everything from the root `.env`; the backend
does not read the old file, and `./provision` refuses a root `.env` without
`NODE_ENV` rather than generate new secrets into it.

The new root `.env` keeps every value verbatim:

- every key of `backend/.env.production.local`, feature flags included;
- `DB_URI` exactly as it is. A URI without a database path uses the driver's
  default database; copying the example path would point at an empty one;
- `TUNNEL_TOKEN` from the old root `.env`;
- the layout keys below. Add `ai` to `COMPOSE_PROFILES` only when
  `AI_SEMANTIC_ENABLED=true`; otherwise Ollama is not started.

```bash
(
  set -Eeuo pipefail
  cd /opt/secureinbox
  backup="$(cat ~/secureinbox-backups/current)"
  umask 077
  {
    cat backend/.env.production.local
    echo
    grep -E '^TUNNEL_TOKEN=' "$backup/root.env"
    printf '%s\n' NODE_ENV=production COMPOSE_PROJECT_NAME=secureinbox \
      COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml COMPOSE_PROFILES= \
      SEED_DEMO=false APP_PORT=8080
  } | awk -F= '!/^[[:space:]]*(#|$)/ { last[$1] = $0; if (!($1 in seen)) { seen[$1] = 1; order[++n] = $1 } }
               END { for (i = 1; i <= n; i++) print last[order[i]] }' > .env.new
  mv .env.new .env
)
```

Keep `backend/.env.production.local` until the release is verified: rolling
back to `dd7b89f` needs it.

### 4. Compare what the backend will receive

```bash
cd /opt/secureinbox && scripts/compare-backend-env secureinbox-backend-1 .env
```

It prints only variable names: those the running backend has that the new
configuration would drop, those whose VALUE would change (compared by
SHA-256), and new ones. Stop on any unexpected entry under "missing" or
"value changes". For the `dd7b89f` migration the expected output is exactly one
missing name, `OLLAMA_PROMPT_VERSION`, which the code no longer reads, and no
value changes. New names are Compose defaults.

### 5. Build and start

```bash
cd /opt/secureinbox && ./provision && docker compose ps && git rev-parse HEAD
```

`./provision` validates the production configuration, then builds and starts
the stack and waits for the health checks. Record the printed revision.

### 6. Verify

```bash
cd /opt/secureinbox
docker compose exec -T frontend wget -qO- http://backend:5500/api/v1/ready </dev/null
curl --fail --max-time 20 https://secure-inbox.app/api/v1/ready
curl --fail --silent -D - -o /dev/null https://secure-inbox.app/ | grep -i '^content-security-policy'
docker compose logs --since 10m backend | grep -iE 'error|warn' || true
```

Read the logs privately; do not paste them into public evidence.

### Roll back

If verification fails, return to the previous revision with its own images and
configuration:

```bash
cd /opt/secureinbox
backup="$(cat ~/secureinbox-backups/current)"
rollback="${backup##*-}"
git switch --detach "$rollback"
cp -p "$backup/root.env" .env
docker tag "secureinbox-backend:rollback-$rollback" secureinbox-backend:latest
docker tag "secureinbox-frontend:rollback-$rollback" secureinbox-frontend:latest
```

Then start it with that revision's commands: for `dd7b89f`, the legacy file
selection in the [recovery runbook](hibernation-recovery-runbook.md#rollback-across-the-environment-migration),
without `--build`. The database is not touched by a deployment, so rollback
does not restore it.

## Backups and maintenance

Atlas backups protect the database, but Gmail OAuth tokens stored there cannot
be recovered without the matching `MAIL_TOKEN_ENCRYPTION_KEY`. Keep encrypted,
access-controlled backups of `.env` separately from the database backup. Test a
restore before relying on it.

Regularly check `docker compose ps`, disk space,
Pi temperature, tunnel status, Atlas access rules, and container logs. Keep
the OS and Docker patched.
