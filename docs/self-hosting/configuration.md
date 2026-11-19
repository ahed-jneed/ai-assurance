# Configuration reference

This page lists every setting of a self-hosted AI Assurance workspace: what it means, its default, and how to set it under Docker and under Node.js. You do not need to set anything to get started. With no settings, the app listens on port 8787, keeps its data in one folder and uses its built-in accounts (email and password).

A setting is an **environment variable**: a named value, such as `PORT=3000`, that a program reads when it starts.

## Two kinds of settings

The settings fall into two groups, and **the two groups are set in different ways**.

1. **Start-script variables** (`PORT`, `HOST`, `DATA_DIR`). The start script (`site-app/scripts/self-host.mjs`, which `npm run self-host` and the Docker image both run) reads these from its own environment. You set them like any other environment variable.
2. **App variables** (everything else on this page). The app itself reads these. The project's other documents call them "Worker variables", because the app runs inside a small local runtime called a Worker. The start script hands the app exactly one file, `DATA_DIR/secrets.env`, so an app variable takes effect only when it is a line in that file. **Setting an app variable as an ordinary environment variable has no effect**: not in your shell, and not under `environment:` in `docker-compose.yml`.

Both groups are read at start, so restart the app after a change.

## Start-script variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | The port the app listens on. |
| `HOST` | `127.0.0.1` (the Docker image sets `0.0.0.0`) | The network address the app listens on. `127.0.0.1` accepts connections from the same machine only; `0.0.0.0` accepts them from any machine that can reach yours. |
| `DATA_DIR` | `./data`, which is `site-app/data` (the Docker image sets `/data`) | The folder that holds the database, the evidence files and `secrets.env`. A relative path starts at `site-app/`. |

### Under Node.js

Put the variables before the command, in `site-app/`:

```bash
PORT=3000 DATA_DIR=/srv/ai-assurance npm run self-host
```

Or keep them in a file and let Node.js load it. Copy [`.env.example`](../../.env.example) from the repository root to `.env` (git ignores that name), remove the `#` in front of the lines you want, and start the script directly:

```bash
cp .env.example .env        # in the repository root
cd site-app
node --env-file=../.env scripts/self-host.mjs
```

`npm run self-host` on its own does not read a `.env` file.

If you set `HOST=0.0.0.0`, other machines can reach the app over plain HTTP. Put it behind a reverse proxy that serves HTTPS first; `docs/security/identity.md` ("Built-in accounts", Exposure) explains why.

### Under Docker

The image already sets all three (`HOST=0.0.0.0`, `PORT=8787`, `DATA_DIR=/data`), and you rarely need to change them:

- **To use another port on your machine,** change the left number of the `ports` entry in `docker-compose.yml`. For example `"3000:8787"` serves the app on <http://localhost:3000>. The right number is the port inside the container and stays as it is.
- **The data** lives in the `ai-assurance-data` volume, which Docker mounts at `/data`. Leave `DATA_DIR` alone, or the data lands outside the volume and is lost with the container.
- If you do need to change the port inside the container, set `PORT` under `environment:` for the service in `docker-compose.yml` and change the right number of the `ports` entry to match.

## App variables

| Variable | Default | Meaning |
|---|---|---|
| `IDENTITY_MODE` | unset, which means `local`: the built-in accounts | How people sign in. `cloudflare-access` trusts a Cloudflare Access login instead. `trusted-headers` and `dev` are for automated tests and the development server only. An unknown value signs nobody in: the API answers 401 and the log says `Identity: unknown IDENTITY_MODE`. |
| `IDENTITY_TRUSTED_HEADERS` | unset | Must be `loopback-tests` for `IDENTITY_MODE=trusted-headers` to work. For automated tests on your own machine only; never set it on a real installation. |
| `CF_ACCESS_TEAM_DOMAIN` | unset | Your Cloudflare Access team domain (`<team>.cloudflareaccess.com`). Needed only with `IDENTITY_MODE=cloudflare-access`. |
| `CF_ACCESS_AUD` | unset | The audience tag of your Cloudflare Access application; several tags are separated by commas. Needed only with `IDENTITY_MODE=cloudflare-access`. |
| `SELF_SIGNUP` | unset, which means off (open only on the development server) | Who may create a practice (a firm's own workspace) without an invitation: `off` (nobody), `open` (every signed-in user), or a comma-separated list of email addresses and `@domain` entries, such as `owner@example.com,@example.com`. The owner account created on the first visit may always create the first practice. |
| `TENANT_MAX_ENGAGEMENTS` | `200` | The most engagements one practice may hold. A value that is not a whole number above zero is ignored and the default applies. |
| `TENANT_MAX_SAVES_PER_HOUR` | `1000` | The most engagement versions one practice may save in an hour. Invalid values are ignored in the same way. |
| `PLATFORM_OPERATORS` | unset, which means nobody | A comma-separated list of exact email addresses (no `@domain` entries) of the people who may open `/operator`, the page that lists every practice and removes abandoned ones. |
| `DOSSIER_KEK` | created automatically on first start | A secret: the key that protects the keys used to sign reports, and that signs invitation sign-up links. **Do not set or change it yourself.** See [The generated secret](#the-generated-secret-dossier_kek). |

`docs/security/identity.md` explains the identity modes, self-signup, the quotas and the platform operator in full. The names are declared in `site-app/cloudflare-env.d.ts`.

### How to set an app variable

Add a line `NAME=value` to the file `secrets.env` in your data folder, then restart the app. The start script creates this file on first start, so start the app once before you edit it. The file also holds `DOSSIER_KEK`: **keep that line exactly as it is**, and do not share or commit the file.

The second half of [`.env.example`](../../.env.example) lists the app variables in the right form. Copy the lines you want into `secrets.env`. Put each comment on a line of its own, starting with `#`.

**Under Node.js** the file is `site-app/data/secrets.env`, or `secrets.env` in your `DATA_DIR`. Open it in a text editor, or append a line:

```bash
cd site-app
echo "SELF_SIGNUP=off" >> data/secrets.env
```

Then stop the app (Ctrl+C) and run `npm run self-host` again.

**Under Docker** the file is `/data/secrets.env` inside the container, in the `ai-assurance-data` volume. Append a line from the repository root while the container runs, then restart it:

```bash
docker compose exec ai-assurance sh -c 'echo "SELF_SIGNUP=off" >> /data/secrets.env'
docker compose restart
```

To see which settings the file holds without showing the secret:

```bash
docker compose exec ai-assurance grep -v "DOSSIER_KEK" /data/secrets.env
```

To change or remove a setting later, edit the file. The Docker image has no text editor, so remove the old line with `sed` (a small text tool that the image includes), append the new one if you want one, and restart:

```bash
docker compose exec ai-assurance sed -i '/^SELF_SIGNUP=/d' /data/secrets.env
docker compose restart
```

Do not copy the file out and back in with `docker compose cp`: the copy can come back owned by another user, and then the app cannot read it and does not start.

### Cloudflare Workers deployments

This page is about self-hosting. If you deploy to Cloudflare Workers instead, you pass the app variables to Wrangler (Cloudflare's command-line tool) with `--var`, and `DOSSIER_KEK` as a Worker secret. See `docs/security/identity.md` ("Configure Cloudflare Access") and `docs/security/signing-keys.md`.

## The generated secret: `DOSSIER_KEK`

On first start, the start script creates `DATA_DIR/secrets.env` with one random secret, `DOSSIER_KEK` (32 random bytes, written in base64). You never choose this value, and it has no place in `.env.example` or in any file you commit or share.

- **Back it up together with the data.** The data folder (or the Docker volume) contains it, so a backup of the whole folder is enough.
- **If it is lost or changed,** reports that are already signed still verify, but the practices' current signing keys can no longer sign until they are rotated, and pending sign-up links stop working. `docs/security/signing-keys.md` has the details.
- The start script refuses to start when `secrets.env` exists but has no `DOSSIER_KEK` line.
