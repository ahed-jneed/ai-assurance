## Summary

<!-- What changed and why. Call out decisions and anything reviewers should check closely. -->

Closes #

## Test evidence

<!-- Tick what you ran and paste relevant output or screenshots below. -->

- [ ] `cd site-app && npm run check` (format, typecheck, lint, unit tests, build, check harnesses)
- [ ] `python -m unittest discover -s engine/tests -v` (when `engine/` changed)
- [ ] `node schemas/validate-run-schema.mjs` and `node schemas/validate-procedure-schema.mjs` (when `schemas/` changed)
- [ ] Checked the change in the running app (UI changes: say what you checked)
