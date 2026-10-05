# Self-hosting Barb

Everything you need to run your own copy: first start, Gmail, the optional
detection services, and day-to-day operations. For the Raspberry Pi production
setup, see [raspberry-pi-deployment.md](raspberry-pi-deployment.md).

## First start

Requirements:

- Docker Engine or Docker Desktop with the Docker Compose plugin, running and
  accessible without `sudo`.
- OpenSSL, used to generate the local secrets.

```bash
git clone https://github.com/AndreiStolojan/SecureInbox.git
cd SecureInbox
./provision
```

`./provision` creates a root `.env`, generates development secrets, starts the
application and local MongoDB, and seeds six demo messages. Passwords stay in
`.env`. Open `http://localhost:8080` and sign in as `demo@secureinbox.test`.

```bash
docker compose ps
curl --fail http://127.0.0.1:8080/api/v1/ready
```

The same source and command support development with local MongoDB or Atlas,
and production with Atlas. Only the root environment configuration changes.
See [development and deployment](environments.md) for native hot reload,
optional Ollama, and running both environments on one Pi.

## Optional Gmail connection

The local application starts without Google, email, or Arcjet credentials.
Features that need a missing integration return a clear message only when used.

To connect Gmail, add these values to `.env`:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/mail-accounts/google/callback
```

Add the same redirect URI to the OAuth client in Google Cloud, then run
`./provision` again:

```bash
nano .env
./provision
```

SMTP and Arcjet variables are documented in `.env.example` and are optional.

## Optional detection integrations

Every integration below is off or degraded by default and fails independently:
a missing key or an unreachable service never blocks a scan, but the missing
signal is not evidence that the message is safe. Common Compose variables are
documented with their defaults in `.env.example`; backend-only bounds remain in
`backend/src/config/env.js`.

| Feature | Env vars | Without it |
| --- | --- | --- |
| Gmail push notifications | `GMAIL_PUSH_ENABLED`, `GOOGLE_CLOUD_PROJECT_ID`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_AUDIENCE` | Falls back to incremental history polling |
| Threat intelligence (Web Risk, URLhaus, domain age) | `THREAT_INTEL_ENABLED`; keys configure Web Risk and URLhaus | Link scoring stays lexical while disabled; enabled RDAP needs no API key |
| Attachment verification | `ATTACHMENT_ANALYSIS_ENABLED` | Attachments are scored by extension only |

Enabling threat intelligence sends bounded URLs to Google Web Risk and URLhaus,
registrable domains to RDAP registries, and DNS queries to the configured
resolver path. Enabling MalwareBazaar reputation sends only attachment SHA-256
hashes, not attachment bytes. Review those providers' privacy and retention
terms before using real mailbox data.

Gmail push notifications additionally need a public HTTPS endpoint (the
Cloudflare Tunnel used in the production deployment) and are not meant to be
exercised on a bare local install; incremental history sync is what runs
out of the box.

## Local operations

Show status and logs:

```bash
docker compose ps
docker compose logs --tail=100
docker compose logs --follow backend
```

Restart the application:

```bash
docker compose restart
```

Update the local installation:

```bash
git pull --ff-only origin main
./provision
```

Create a validated MongoDB backup:

```bash
./scripts/backup
ls -lh backups
```

The archive contains email content and encrypted OAuth tokens. Store it with
restricted access and encrypt any copy that leaves the machine.

Restore the latest backup:

```bash
LATEST_BACKUP="$(find backups -name '*.archive.gz' -type f | sort | tail -1)"
test -n "$LATEST_BACKUP" || { echo "No backup archive found" >&2; exit 1; }
./scripts/restore "$LATEST_BACKUP" --confirm-replace
```

Restore is destructive: it verifies the timestamped archive and manifest, then
replaces the configured local database. Backup names use a zero-padded UTC
timestamp, so their lexical order is chronological.

Keep an encrypted backup of `.env` with every MongoDB backup. In particular,
`MAIL_TOKEN_ENCRYPTION_KEY` is required to decrypt restored Gmail tokens.

Stop the application while preserving all data:

```bash
docker compose down
```

To erase MongoDB and the downloaded Ollama model:

```bash
docker compose down --volumes
```

That command is destructive and cannot be undone without a backup.
