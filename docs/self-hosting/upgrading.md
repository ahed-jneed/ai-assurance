# Upgrade a self-hosted install

This guide shows how to move a self-hosted install to a newer version of the app without losing data, and what to do when an upgrade goes wrong. It covers both ways of running the app from the [Quick start](../../README.md#quick-start): Docker (`docker compose up -d`) and Node.js (`npm run self-host`).

See [Tested](#tested) for what was tried and what was not.

## Back up before upgrading

**Take a backup first, every time.** Follow [Back up and restore a self-hosted install](backup-restore.md). It takes a few minutes, and it is the only way back if the upgrade fails.

Why it matters: an upgrade can change the layout of the database, and that change cannot be undone by the app (see [How an upgrade works](#how-an-upgrade-works)).

Before you start, also write down which version you run now. You need it to go back:

```bash
git rev-parse HEAD
```

This prints the commit (the exact version of the code) that your copy of the repository is on. If you checked out a release tag, write down the tag as well.

## How an upgrade works

An upgrade has two parts:

1. **New code.** You get the new version of the repository and build it. Under Docker the build happens when the image is built. Under Node.js you ask for it with `--rebuild`.
2. **Database migrations.** A migration is a script that updates the layout of the database, for example by adding a table. The app applies all pending migrations by itself at every start, before it serves. You never run them by hand. It records each applied migration in the database, so a migration is applied only once.

Two facts follow from the code in `site-app/scripts/db-migrate-local.mjs`:

- **Migrations only go forward.** There are no scripts that reverse a migration. Going back to an older version of the code does not put the database back.
- **If a migration fails, the app does not start.** It prints `db:migrate:local failed:` with the reason and stops.

Your data stays where it is during an upgrade: in the Docker volume, or in `site-app/data/`. The upgrade steps below do not delete it.

## Docker

Run every command from the repository root, the directory that holds `docker-compose.yml`. Stay in the same directory as before: Docker Compose names the data volume after the directory, so a clone in a directory with another name starts with a new, empty volume (see [The name of the Docker volume](backup-restore.md#the-name-of-the-docker-volume)).

```bash
# 1. Take a backup (see "Back up before upgrading"). The backup steps stop
#    the app and start it again.

# 2. Get the new version of the repository.
git pull
#    Or, to move to one release: git fetch --tags && git checkout <tag>

# 3. Build a new image from it and restart the app with that image.
docker compose up -d --build

# 4. Watch the start. Press Ctrl+C to stop watching; the app keeps running.
docker compose logs -f ai-assurance
```

`--build` matters. `docker-compose.yml` builds the image on your machine from the files in `site-app/`. Without `--build`, `docker compose up -d` finds the image it built last time and keeps using it, so you would still run the old version.

In step 4, look for these lines:

- `Applied 0019_....sql` and then `applied 1 pending migration(s)`: the new version brought migrations, and they were applied. (The numbers are examples.)
- or `is up to date: 19 migrations applied`: the new version brought no migrations.
- then `AI Assurance is starting on http://localhost:8787`.

Then open <http://localhost:8787>, sign in, and open an engagement.

Never use `docker compose down -v` as part of an upgrade. The `-v` deletes the data volume.

### If you run a published image instead of building one

`docker-compose.pull.yml` runs a ready-made image from the GitHub container registry, `ghcr.io/ahed-jneed/ai-assurance`, and builds nothing on your machine. If you started the app with that file, you do not need `git pull` or `--build`. Put `-f docker-compose.pull.yml` in every `docker compose` command, including the ones in the backup guide: `-f` names the file to use.

```bash
# 1. Take a backup (see "Back up before upgrading").

# 2. Download the newer image.
docker compose -f docker-compose.pull.yml pull

# 3. Restart the app with it.
docker compose -f docker-compose.pull.yml up -d

# 4. Watch the start. Press Ctrl+C to stop watching; the app keeps running.
docker compose -f docker-compose.pull.yml logs -f ai-assurance
```

Which version step 2 downloads depends on the variable `AI_ASSURANCE_VERSION`:

- **Not set:** the tag `latest`, the newest published build. Each `pull` moves you to whatever is newest at that moment.
- **Set to a release, for example `AI_ASSURANCE_VERSION=0.1.0`:** that release, and nothing newer. This is called pinning a version, and it is the safer choice for a real install. `pull` then finds nothing new, so **to upgrade you change the pin** to the new release and run steps 2 and 3. Set the variable in a file called `.env` next to `docker-compose.pull.yml`, or in front of each command.

Write down the pin you had before the upgrade. If you ran `latest`, you cannot name the previous build afterwards, which is one more reason to pin.

The image contains the finished build, and the migrations apply at start as described above, so step 4 shows the same lines.

**To go back** after a failed upgrade, do both things, as in [If an upgrade fails](#if-an-upgrade-fails): set `AI_ASSURANCE_VERSION` back to the previous release, and restore the backup. Stop the app, delete the upgraded data with `docker compose -f docker-compose.pull.yml down -v` (check first that your backup file is there), and follow [Restore, under Docker](backup-restore.md#restore) in the backup guide with `-f docker-compose.pull.yml` in each command. Its step 1 becomes `docker compose -f docker-compose.pull.yml pull`.

This route was not tested for this guide: the test environment could not download the image.

## Node.js

These commands are for Linux and macOS shells. Run them from `site-app/`.

```bash
# 1. Stop the app: press Ctrl+C in the terminal where "npm run self-host" runs.

# 2. Take a backup (see "Back up before upgrading").

# 3. Get the new version of the repository.
git pull
#    Or, to move to one release: git fetch --tags && git checkout <tag>

# 4. Install the packages the new version needs.
npm ci

# 5. Build the new version and start it.
npm run self-host -- --rebuild
```

**Do not leave out `--rebuild`.** `npm run self-host` builds the app only when there is no build yet. After that it reuses the build it finds in `site-app/dist/`, also when the source code has changed. Without `--rebuild`:

- the app starts and serves the **old** version, so the upgrade looks as if it did nothing;
- but the new migrations are applied all the same, because they are read from the new files at every start. You then run old code on a database with the new layout, which is not a supported combination.

If this happened to you, stop the app and start it once with `npm run self-host -- --rebuild`. That builds the new code, which is what the database now expects.

The two dashes before `--rebuild` are needed: they tell `npm` to pass the flag on to the script. The build takes a minute or two and prints `Building the workspace (first start only)...`. That message is also printed for a rebuild; it is the right step.

You need `--rebuild` once per upgrade. The next starts can use plain `npm run self-host`.

If you set `PORT`, `HOST` or `DATA_DIR` when you start the app, set them in the same way in step 5, for example `DATA_DIR=/srv/ai-assurance npm run self-host -- --rebuild`. The app needs Node.js 22.13 or later; a newer version of the app may need a newer Node.js, which `npm ci` reports.

After the build, look for the same lines as under Docker: `Applied ...` or `is up to date: ... migrations applied`, then `AI Assurance is starting on http://127.0.0.1:8787`. Then open the app, sign in, and open an engagement.

## If an upgrade fails

An upgrade has failed when the app does not start after it, or starts but does not work as before (pages show errors, sign-in fails, data seems to be missing).

First, keep the evidence of what went wrong: copy the messages from the terminal, or from `docker compose logs ai-assurance`. Under Docker a failed start repeats, because the container is set to restart; `docker compose ps` then shows it as restarting. Leave out anything from `secrets.env` when you share the messages.

Then go back. The honest answer is short: **restore the backup and run the previous version.** Do both. Going back to the previous code alone is not enough, because migrations are not reversed (see [What happens if an older version runs on an upgraded database](#what-happens-if-an-older-version-runs-on-an-upgraded-database)).

Anything that was entered after the backup was taken is not in the backup. This is why you take the backup immediately before the upgrade.

### Go back: Docker

```bash
# 1. Stop the app.
docker compose stop

# 2. Go back to the version you wrote down before the upgrade.
git checkout <commit or tag you wrote down>

# 3. Delete the upgraded data. Check first that your backup file is there
#    and holds both parts (the backup guide shows the check).
docker compose down -v
```

Then follow [Restore, under Docker](backup-restore.md#restore) in the backup guide from its step 1. Do not skip its step 1 (`docker compose build`): the image on your machine is the new version, and the build replaces it with the previous one.

### Go back: Node.js

```bash
# 1. Stop the app: press Ctrl+C.

# 2. Go back to the version you wrote down before the upgrade.
git checkout <commit or tag you wrote down>
npm ci

# 3. Move the upgraded data out of the way. Do not delete it yet.
mv data data.failed-upgrade

# 4. Put the backup in its place.
mkdir data
tar -xzf "$HOME/ai-assurance-backup.tar.gz" -C data

# 5. Build the previous version and start it.
npm run self-host -- --rebuild
```

Steps 3 and 4 use the default data directory and the backup file name from the backup guide; change them if yours differ. `--rebuild` is needed here too, for the same reason as in an upgrade: the build in `dist/` is the new version.

When the previous version works again, go through [After a restore: what to check](backup-restore.md#after-a-restore-what-to-check). Delete `data.failed-upgrade` once you no longer need it; it holds evidence and the secret key, so treat it like a backup until then.

`git checkout <commit>` leaves the repository on that fixed version. To try the upgrade again later, run `git checkout main` (or check out the newer tag) and follow the upgrade steps from the start, including a new backup.

Please report the failure, with the messages you kept and the two versions (from and to), as an issue in the project's repository.

### What happens if an older version runs on an upgraded database

This is not supported. Do not do it, and do not leave an install in this state.

The app does not notice it. The migration step only looks for migrations that the code has and the database lacks. A migration that the database has and the code lacks is ignored: the older version prints `is up to date: ... migrations applied` and starts, with no warning. It then runs on a database layout that it was not written for. Depending on what the newer migrations changed, it may seem to work, show errors, or store data in a way that neither version expects. Because the result cannot be predicted and is not checked, the safe route is the one above: restore the backup taken before the upgrade, and run the version that made it.

## Tested

Tried on 2026-11-19 on Linux with Node.js 22, at commit `62e9d13` of `main`, with a throwaway data directory.

No two released versions existed when this guide was written, so **a real upgrade from one version to another was not tested.** The upgrade was simulated in one clone of the repository:

| What was tried (Node.js) | Result |
| --- | --- |
| First start | Built the app, applied 19 migrations, served |
| Second start, nothing changed | No build; `is up to date: 19 migrations applied` |
| A page's source text changed, start without `--rebuild` | The old text was served |
| The same, start with `--rebuild` | Built again; the new text was served, and also on later starts without the flag |
| A made-up migration file added, start without `--rebuild` | The migration was applied (`Applied ...`, then `applied 1 pending migration(s)`), and the build was not renewed |
| Start again | `is up to date: 20 migrations applied` |
| The made-up migration file removed again (older code, newer database) | Started without a warning: `is up to date: 19 migrations applied`; the table the migration had created was still in the database |
| A made-up migration whose second statement fails | `db:migrate:local failed:` with the reason, exit status 1, the app did not serve; the same on the next start |

Under Docker, `docker compose up -d --build` could not finish in the test environment: its network settings stop the package download inside the image build. The image was therefore built by hand with `docker build` under the name that `docker-compose.yml` uses, and `docker compose up -d` (without `--build`) was run after each build:

| What was tried (Docker) | Result |
| --- | --- |
| First start | Applied 19 migrations, served |
| New image with a changed page text and a made-up migration, then `docker compose up -d` | The container was created again from the new image; the migration was applied; the new text was served; `secrets.env` in the data volume was unchanged |
| New image with a made-up migration whose second statement fails | `db:migrate:local failed:` in the logs; `docker compose ps` showed the container as restarting |

Not tested: an upgrade between two real versions; `docker compose up -d --build` to the end, as written; the route with `docker-compose.pull.yml` and the published image (the test environment could not download the image; only the way `AI_ASSURANCE_VERSION` selects the image tag was checked, with `docker compose config`); going back with a restore after a real failed upgrade (the restore itself is tested in the [backup guide](backup-restore.md#tested)); Windows.
