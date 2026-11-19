# Back up and restore a self-hosted install

A self-hosted install holds audit evidence and signed reports. This guide shows how to copy all of it to a backup file, and how to get it back on a clean machine. It covers both ways of running the app from the [Quick start](../../README.md#quick-start): Docker (`docker compose up -d`) and Node.js (`npm run self-host`).

The commands were run as written on Linux on 2026-11-19; see [Tested](#tested) for what was checked.

## What to back up

Everything the app stores lives in one directory, called `DATA_DIR`:

| How you run it | Where `DATA_DIR` is |
| --- | --- |
| Docker | `/data` inside the container, kept in a Docker volume (a disk area that Docker manages and that outlives the container) |
| Node.js | `site-app/data/`, unless you set the `DATA_DIR` environment variable to another directory |

Inside it are two things, and a backup needs **both**:

| Path | What it holds |
| --- | --- |
| `state/` | The SQLite database (accounts, practices, engagements, records) and the uploaded evidence files |
| `secrets.env` | `DOSSIER_KEK`, a secret key created on first start. It protects the keys that sign reports, and it keys the sign-up links sent to invited members |

Three rules:

1. **Stop the app before you copy.** The database is a set of files that change while the app runs. A copy taken while it runs can be inconsistent.
2. **Keep `secrets.env` and `state/` in the same backup.** They belong together: `state/` stores the signing keys in encrypted form, and `secrets.env` is what decrypts them. The commands below copy the whole of `DATA_DIR`, so you get both.
3. **Keep the backup private.** It contains all evidence, all accounts (with password hashes) and the secret key. Anyone who has the file can read the evidence and can sign reports as your practice. Store it where only the people who run the install can read it, and encrypt it before it leaves the machine (see [Keep the backup private](#keep-the-backup-private)).

The commands write one file, `ai-assurance-backup.tar.gz` (a compressed archive). Add the date to the name if you keep several, for example `ai-assurance-backup-2026-11-19.tar.gz`.

Also write down which version you run (the release tag, or the output of `git rev-parse HEAD`). Restore with the same version.

## Docker

Run every command from the repository root, the directory that holds `docker-compose.yml`.

### Back up

```bash
# 1. Stop the app.
docker compose stop

# 2. Copy the data to a file in the current directory.
#    "umask 077" makes the file readable only by you.
(umask 077; docker compose run --rm --no-deps -T ai-assurance tar -czf - -C /data . > ai-assurance-backup.tar.gz)

# 3. Start the app again.
docker compose start
```

Step 2 starts a short-lived helper container from the same image, with the same data volume. It runs `tar` instead of the app, sends the archive to your terminal's output, and the `>` writes that output to the file. The helper removes itself afterwards (`--rm`).

Check that the file holds both parts:

```bash
tar -tzf ai-assurance-backup.tar.gz | grep -E '^\./(secrets\.env|state/)$'
```

It must print two lines, `./state/` and `./secrets.env`.

### Restore

On the new machine, install Docker, get the same version of this repository, and copy the backup file into the repository root. Do **not** run `docker compose up` first: restore into an empty volume.

```bash
# 1. Build the image (skip this if the image is already there).
docker compose build

# 2. Check that the data volume is empty. This must print nothing.
docker compose run --rm --no-deps -T ai-assurance ls -A /data

# 3. Unpack the backup into the volume.
docker compose run --rm --no-deps -T ai-assurance tar -xzf - -C /data < ai-assurance-backup.tar.gz

# 4. Start the app.
docker compose up -d
```

Then open <http://localhost:8787> and go through [After a restore: what to check](#after-a-restore-what-to-check).

If step 2 prints file names, the volume already holds an install. Unpacking over it would mix two databases. Stop here and decide which data you want to keep. To throw the existing data away for good, run `docker compose down -v` (this deletes the volume) and start again from step 2.

### The name of the Docker volume

`docker-compose.yml` calls the volume `ai-assurance-data`. Docker Compose puts the project name in front of it, and the project name is the name of the directory that holds `docker-compose.yml`. So in a directory called `ai-assurance` the real volume name is `ai-assurance_ai-assurance-data`. `docker volume ls` lists it. The commands above go through `docker compose`, so you never have to type the name. It also means that a clone in a directory with another name gets its own, new, empty volume.

## Node.js

These commands are for Linux and macOS shells. Run them from `site-app/`. They assume the default data directory, `data/`. If you set `DATA_DIR`, use that directory in place of `data` in every command.

### Back up

```bash
# 1. Stop the app: press Ctrl+C in the terminal where "npm run self-host" runs.

# 2. Copy the data to a file in your home directory.
#    "umask 077" makes the file readable only by you.
(umask 077; tar -czf "$HOME/ai-assurance-backup.tar.gz" -C data .)

# 3. Start the app again.
npm run self-host
```

Check that the file holds both parts:

```bash
tar -tzf "$HOME/ai-assurance-backup.tar.gz" | grep -E '^\./(secrets\.env|state/)$'
```

It must print two lines, `./state/` and `./secrets.env`.

### Restore

On the new machine, install Node.js 22.13 or later, get the same version of this repository, and copy the backup file to your home directory. Do **not** run `npm run self-host` first: restore into a `data/` directory that does not exist yet.

```bash
cd site-app
npm ci

# 1. Create the data directory. This fails if it already exists, on purpose.
mkdir data

# 2. Unpack the backup into it.
tar -xzf "$HOME/ai-assurance-backup.tar.gz" -C data

# 3. Start the app. The first start also builds it, which takes a minute or two.
npm run self-host
```

Then open <http://localhost:8787> and go through [After a restore: what to check](#after-a-restore-what-to-check).

If `mkdir data` says the directory exists, an install is already there. Unpacking over it would mix two databases. Move the old directory out of the way first (for example `mv data data.old`), then start again from step 1.

### Windows

The Node.js commands above were not tested on Windows. Windows 10 and later include `tar`, so in PowerShell the equivalent commands should be `tar -czf "$HOME\ai-assurance-backup.tar.gz" -C data .` to back up and `mkdir data; tar -xzf "$HOME\ai-assurance-backup.tar.gz" -C data` to restore. `umask` does not exist there: restrict who can read the file with the folder's permissions instead. Please treat this paragraph as untested advice, and run a restore test of your own before you rely on it.

## Keep the backup private

- Store the file where only the people who run the install can read it. The commands above create it readable only by the user who ran them.
- Encrypt it before you copy it to another machine, a cloud drive or removable media. For example, `gpg --symmetric --cipher-algo AES256 ai-assurance-backup.tar.gz` asks for a passphrase and writes `ai-assurance-backup.tar.gz.gpg`; `gpg --decrypt --output ai-assurance-backup.tar.gz ai-assurance-backup.tar.gz.gpg` turns it back. Keep the passphrase somewhere other than next to the file.
- Never commit a backup or `secrets.env` to a repository, and never paste the contents of `secrets.env` into an issue, a chat or a log. In documentation, write the key as a placeholder, like this: `DOSSIER_KEK=<44 characters of base64>`.
- Delete old backups on the schedule your practice has agreed, in the same way as other copies of client evidence.

## After a restore: what to check

1. **Sign in** with your usual email and password. Accounts and passwords come back with the database.
2. **Open an engagement** and look for the work you expect to see.
3. **Download an evidence file** from that engagement and open it.
4. **Members & access:** the list of members and pending invitations is as before.
5. **Signing:** the next time someone seals a report or exports a briefing packet, it must succeed. If it is refused with a message about "a different DOSSIER_KEK", the `secrets.env` in place is not the one that belongs to this data: see the next section.

Anything that was changed after the backup was taken is not in it.

## If `secrets.env` is lost

This is what happens when you restore `state/` without the `secrets.env` that belonged to it, or when the file is deleted or replaced. It was tried for this guide (see [Tested](#tested)) and it agrees with [docs/security/signing-keys.md](../security/signing-keys.md), section "Configure the key-encryption secret".

On the next start the app does not stop or warn. It creates a **new** `secrets.env` with a new key and prints `Created .../secrets.env`. After that:

| What | Result |
| --- | --- |
| Signing in, engagements, evidence files | Work as before. They do not depend on the key |
| Reports and packets signed earlier | Still verify. The public half of each signing key is stored in the database, not in `secrets.env` |
| Signing something new (sealing a report, exporting a briefing packet) | Refused with HTTP 503 and the message "The active signing key was wrapped with a different DOSSIER_KEK (...). Restore that secret, or ask a practice administrator to rotate the signing key. Nothing was signed." This applies to every practice that already had a signing key |
| Sign-up links already sent to invited members | Stop working: "This sign-up link is not valid" (HTTP 404). The invitations themselves are still there |

What to do:

1. **Look for the old file first.** If any backup still has the matching `secrets.env`, stop the app, put that file back in `DATA_DIR` in place of the new one, and start the app. Everything then works as before, and nothing below is needed.
2. **If the old file is gone for good,** a practice administrator of each practice opens **Members & access, Practice** and chooses **Rotate signing key**, with a reason. Rotation does not need the old key. It creates a new signing key under the new secret and retires the old one; what the old one signed still verifies. Tell the people who check your reports about the new key through a separate channel, as [docs/security/signing-keys.md](../security/signing-keys.md) describes.
3. **Send the sign-up links again.** Members & access now shows a new link for each pending invitation. Copy it and send it to the person again.
4. **Take a new backup** that holds the new `secrets.env`, and from now on keep the two parts together.

A lost `secrets.env` does not lose evidence or accounts. A lost `state/` does: `secrets.env` on its own restores nothing.

## Tested

Tested on 2026-11-19 on Linux, at commit `407952f` of `main`, with made-up data: an owner account `owner@example.com`, one client, one engagement, one uploaded evidence file, one signed briefing packet and one pending invitation.

| Test | Result |
| --- | --- |
| Docker: back up with the commands above, restore into a new, empty volume used by a new container | Passed |
| Node.js: back up with the commands above, restore into a second, fresh clone of the repository on the same machine (not a separate machine) | Passed |
| Both: restore `state/` without `secrets.env` | Behaved as described in [If `secrets.env` is lost](#if-secretsenv-is-lost), including the recovery by rotating the signing key |

After each full restore these checks passed: sign-in with the password set before the backup; the engagement opens; the evidence file downloads with the same SHA-256 hash as the uploaded file; the packet signed before the backup verifies against the key the restored app publishes; a new packet is signed with the same key; the sign-up link sent before the backup still opens.

Not tested: a restore on a physically separate machine, Windows, a restore into a different version of the app, and sealing a full report (the signing check used a briefing packet, which uses the same signing key).
