## Summary

<!-- What changed and why. Call out decisions and anything reviewers should check closely. -->

Closes #

## Test evidence

<!-- Tick what you ran and paste relevant output or screenshots below. -->

- [ ] `cd site-app && npm run check` (format, typecheck, lint, unit tests, generated-file sync, warning-free build, check harnesses, fresh fixtures)
- [ ] `python -m unittest discover -s engine/tests -v` (when `engine/` changed)
- [ ] `node schemas/validate-run-schema.mjs`, `node schemas/validate-procedure-schema.mjs`, `node schemas/validate-working-paper-schema.mjs` and `node schemas/validate-dataset-card-schema.mjs` (when `schemas/` changed)
- [ ] Checked the change in the running app (UI changes: say what you checked)
