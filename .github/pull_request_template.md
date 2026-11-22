## Summary

<!-- What changed and why. Call out decisions and anything reviewers should check closely. -->

Closes #

## Test evidence

<!-- Tick what you ran and paste relevant output or screenshots below. The validators run from the repository root and need `cd site-app && npm ci` first. -->

- [ ] `cd site-app && npm run check` (format, typecheck, lint, unit tests, generated-file sync, warning-free build, check harnesses, fresh fixtures)
- [ ] `python -m unittest discover -s engine/tests -v` (when `engine/` changed)
- [ ] Rule pack, research and criteria validators (when `templates/`, `docs/research/`, `docs/obligation-subitems.json` or `schemas/` changed):
      `node schemas/validate-rule-pack.mjs`, `node schemas/validate-art50-research.mjs`, `node schemas/validate-criteria.mjs --base origin/main`
- [ ] Schema validators (when `schemas/` or `engine/` changed):
      `node schemas/validate-run-schema.mjs`, `node schemas/validate-procedure-schema.mjs`, `node schemas/validate-working-paper-schema.mjs`, `node schemas/validate-dataset-card-schema.mjs`, `node schemas/validate-genai-schema.mjs`
- [ ] End-to-end tests (when the UI or a user flow changed): `cd site-app && npm run build && npm run test:e2e`
- [ ] Checked the change in the running app (UI changes: say what you checked)
