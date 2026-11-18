# Contributing

Thank you for helping. This guide covers setup, the checks to run before you
open a pull request, and the rules that keep the generated and regulatory
content consistent.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), as Section 5 of that licence describes. Please
follow the [code of conduct](CODE_OF_CONDUCT.md). Report security problems
privately, as [SECURITY.md](SECURITY.md) describes.

## Finding something to work on

New here? Welcome. You do not need to know the whole project to help.

- **Start with [`good first issue`](https://github.com/ahed-jneed/ai-assurance/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).** These issues are small. Each one says what "done" looks like (its acceptance criteria) and points to the files to change.
- **Then try [`help wanted`](https://github.com/ahed-jneed/ai-assurance/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22).** These are bigger or need more background, and we would be glad of a hand with them.

The other labels tell you what an issue is about:

- `type:` says what kind of work it is: bug, feature, docs, question or maintenance.
- `area:` says which part of the project it touches: web app, engine, regulatory content, self-hosting or security.
- `needs: legal review` and `needs: practitioner review` mark items that need a qualified expert, not code.

Milestones group issues by when we plan to do them: `v0.1 Public preview`, `v0.2 Contributor-ready`, `Regulatory content review` and `Next features`. [ROADMAP.md](ROADMAP.md) holds the longer list.

**Claiming an issue.** Comment on the issue to say you would like to take it. On a good first issue you do not need to wait for a reply: just start. If you get stuck or have to step away, say so in the issue. That is completely fine, and it lets someone else help or pick it up.

**Ask before you start anything large.** Open an issue or a discussion first, so nobody spends a week on something we cannot merge. Please also read section 3 of the product direction, ["What we will not build"](docs/product/direction.md#3-what-we-will-not-build), before you propose a new feature.

**You do not have to write code.** Lawyers, auditors and standards experts can help a great deal by checking the regulatory and methodology content. The [expert-review issue (#261)](https://github.com/ahed-jneed/ai-assurance/issues/261) explains what needs review and how to send your comments.

**Questions** go to [GitHub Discussions](https://github.com/ahed-jneed/ai-assurance/discussions). No question is too basic.

## Prerequisites

- Node.js 22.13 or later. Use npm 11 when you change the lockfile, for example `npx npm@11 install <pkg>`.
- Python 3.12, the engine's one supported version.
- Docker, optional. It is one way to try the self-hosted app (`docker compose up -d` builds `site-app/Dockerfile` through `docker-compose.yml`), and you need it to work on the compute image (`engine/Dockerfile`).

## Setup

Web app:

```bash
cd site-app
npm ci
npm run build
npm run db:migrate:local
npm run dev
```

The migration step creates the local database tables. The dev server needs them, so do not skip it. To fill the app with a demo practice and test personas, run `npm run seed:demo` in a second terminal while the dev server runs. The [README](README.md#development) explains how to sign in as a persona.

On Windows, keep the checkout path short (`site-app\` under about 120 characters). The local database sits about 125 characters below `site-app\`, and Windows cannot open a path longer than 260 characters, so in a deeper folder `npm run db:migrate:local` fails with `SQLITE_CANTOPEN`.

To try the app as a user instead, see the [Quick start](README.md#quick-start): `docker compose up -d`, or `npm run self-host` in `site-app/`.

Engine, from the repository root:

```bash
python -m pip install -r engine/requirements-dev.txt
```

To ignore formatting-only commits in `git blame`:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Two documents help you find your way around:

- [docs/capabilities.md](docs/capabilities.md) lists what the project does today, with the code and tests for each capability.
- [docs/engineering/codebase-map.md](docs/engineering/codebase-map.md) describes the components, the data flow and where each module lives.

## Before you open a pull request

- `cd site-app && npm run check`: format, typecheck, lint, unit tests, generated-file sync, a warning-free build and the check harnesses.
- `python -m unittest discover -s engine/tests -v`, when `engine/` changed.
- The schema validators in `schemas/`, when schemas, templates or research data changed. `.github/workflows/ci.yml` has the full list.
- `cd site-app && npm run test:e2e`, when the UI changed. Run `npx playwright install chromium` once first.

Fill in the [pull request template](.github/pull_request_template.md).

## Conventions

- **Commit messages** use the Conventional Commits style that the history already uses, for example `feat(evaluation): ...`, `fix(ui): ...` or `refactor(site-app): ...`.
- **Canonical sources and generated copies.** Edit the canonical files in `docs/`, `engine/`, `schemas/` and `templates/`. Then run `npm run sync` in `site-app/` and commit both the source and the generated copies. CI fails when they drift apart.
- **Database migrations.** Add a new `site-app/drizzle/NNNN_*.sql` file. Never edit a migration that has already been applied.
- **Regulatory and standards content** must cite primary sources and stay marked as pending legal review (see [docs/product/decisions.md](docs/product/decisions.md)). Do not paste copyrighted standard text (ISO/IEC, CEN/CENELEC). Reference those standards by clause number and write titles in your own words.
- **No real data.** Never commit client data, personal data, credentials or real audit evidence, not even in tests or fixtures. Use `example.com`, `.test` or `.invalid` addresses and fictional names.

## How decisions are recorded

Product and technical decisions live in one table, [docs/product/decisions.md](docs/product/decisions.md). Each row has an ID (D-01, D-02 and so on), a date, the decision, why it was made and where it was recorded.

- **The table is append-only.** New decisions go at the bottom with the next ID.
- **To change a decision,** append a new row that names the decision it replaces, and mark the old row "Superseded by D-nn". Old rows are not otherwise rewritten, so the history stays readable.
- **If your change needs a new decision, or contradicts an existing one,** say so in the issue or pull request. You do not have to edit the table yourself: the maintainer adds the row once the decision is agreed.

**Who approves regulatory content releases** (D-08 and D-17). A qualified legal reviewer approves framework documents for legislation. The methodology owner approves packs and crosswalks. An entry that records a legal effect needs both, and they must be two different people. The methodology owner may release legislation content while its legal review is still pending; the app then shows it as pending, and the legal approval is added later.

A few decisions every newcomer should know:

- **D-02:** legal content is shown as pending legal review, not approved, until a qualified reviewer signs it off. Please keep that wording.
- **D-03:** standards text is never reproduced. Cite clauses by number, with a short title in your own words, and copy no text, tables or figures.
- **D-14:** the root `schemas/`, `templates/` and `engine/` folders (and `docs/obligation-subitems.json`) are canonical. The copies in `site-app/` are generated: refresh them with `npm run sync` and never edit them by hand.
