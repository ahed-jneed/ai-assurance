# Source runtime distribution

`assurance-runtime.zip` contains the Python source modules, documentation,
Dockerfile, dependency baselines, synthetic examples and common schemas, plus
`engine/threshold-library.json`, the copy of `schemas/threshold-library.json`
that `engine/statistics.py` loads (so the compute image built from `engine/`
carries it).
It contains no engine tests, test fixtures or fixture generators (they stay in
the repository's `engine/tests/`), no Site application, installed packages,
compiled runtimes, retained worker jobs, caches, credentials or production data. Extract it into a dedicated
directory; keep service secrets in your environment/secret manager.

`RUNTIME-MANIFEST.json` records a SHA-256 digest and byte count for every source
entry. This detects accidental changes; it is not a signed release, attestation,
dependency lock or approval of a native runtime. The Dockerfile's default base
tag is for development; production requires an operator-reviewed immutable
base/image digest and golden native inference qualification.

From the extracted directory, using Python 3.12 (the one supported version;
`engine/README.md`, section Packaging):

```powershell
python -m engine.worker --readiness
python -m engine --data engine/examples/predictions.csv --reference engine/examples/reference.csv --config engine/examples/config.json --output new-example-report.json
```

The core CSV computation path needs only Python's standard library. Signature
verification and Inspect `.eval` reading need `cryptography` and `zstandard`,
hash-locked in `requirements-image.txt`, which the Dockerfile installs. Optional
native model and Parquet capabilities need separately reviewed runtimes.
`requirements-optional.txt` is a baseline, not a resolved transitive lock. No native runtime or Docker execution was qualified in this distribution's
local checks. The repository's engine tests use synthetic fixtures,
application-owned test predictors, dummy credentials and loopback/mocked
transports.

Contract versions remain distinct: engine report **1.3** (statistics 1.0.0;
1.0 stays readable), hosted configuration and saved-prediction run **1.1**,
authenticated external compilation **1.2** and **1.5**, worker transport
request/result envelope schema **1.0**. Diagnostic runner is **1.5.0**, worker
is **1.3.0** (client-held datasets read locally by SHA-256 pin, #102). Earlier
immutable evidence retains its versions.
The result envelope is retained byte for byte alongside its imported projection.
Provided/client-local predictions never establish independent model scoring;
native inference additionally requires approved artifact hashes, typed numeric
features, installed adapters and the no-network container execution path.

The optional cited evidence assistant is a separate, permission-scoped draft
service. No provider endpoint or production key is supplied; the repository's
tests mock responses.
See `CITED_ASSISTANT.md` before enabling any provider or forwarding excerpts.

For schema verification, use a pre-existing dependency tree with Ajv 2020 and
ajv-formats; the archive deliberately includes no node_modules:

```powershell
python schemas/.build-run-schema.py --check
node schemas/validate-run-schema.mjs --ajv-package path/to/package.json
node schemas/validate-procedure-schema.mjs --ajv-package path/to/package.json
node schemas/validate-working-paper-schema.mjs --ajv-package path/to/package.json
node schemas/validate-rule-pack.mjs --ajv-package path/to/package.json
```

The run-schema validator accepts `--external-run path/to/imported-run.json` for
a fresh platform projection. Portable schema validity does not establish its
custody or signature; the committed exact-byte fixture checks exercise binding
logic independently. `python schemas/generate-external-fixtures.py` recomputes
fictional example reports and updates timestamps, without a Site API call.

Rebuild a deterministic source package from the workspace/extracted runtime:

```powershell
python -m engine.package_runtime --output tmp/assurance-runtime.zip
```

Outputs are created once; choose a new path for another archive. Packaging
rejects symlinked source components and uses explicit source-file allowlists.
The archive is reproducible from an LF checkout: entries are sorted, carry a
fixed timestamp and mode, and stock zlib builds produce identical bytes. The
workspace commits the downloadable copy as
`site-app/public/tools/assurance-runtime.zip`; `npm run sync` in `site-app/`
rebuilds it, and CI rebuilds it into a temporary path and fails unless the
SHA-256 matches (or, for another zlib build, every entry is identical).
Operators remain responsible for independent release review/signing, deployment,
worker enrollment, access rotation, quotas and retained-evidence verification.
