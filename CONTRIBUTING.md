# Contributing

Thank you for helping. This guide covers setup, the checks to run before you
open a pull request, and the rules that keep the generated and regulatory
content consistent.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), as Section 5 of that licence describes. Please
follow the [code of conduct](CODE_OF_CONDUCT.md). Report security problems
privately, as [SECURITY.md](SECURITY.md) describes.

## Prerequisites

- Node.js 22.13 or later. Use npm 11 when you change the lockfile, for example `npx npm@11 install <pkg>`.
- Python 3.12, the engine's one supported version.
- Docker, only if you work on the compute image.

## Setup

Web app:

```bash
cd site-app
npm ci
npm run build
npm run db:migrate:local
npm run dev
```

Engine, from the repository root:

```bash
python -m pip install -r engine/requirements-dev.txt
```

To ignore formatting-only commits in `git blame`:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

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
- **Regulatory and standards content** must cite primary sources and stay marked as pending legal review (see `docs/product/decisions.md`). Do not paste copyrighted standard text (ISO/IEC, CEN/CENELEC). Reference those standards by clause number and write titles in your own words.
- **No real data.** Never commit client data, personal data, credentials or real audit evidence, not even in tests or fixtures. Use `example.com`, `.test` or `.invalid` addresses and fictional names.
