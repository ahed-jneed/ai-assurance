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

## Client dataset pins

A client that keeps its dataset (client-held pin, `WORKER.md`) and has no
enrolled worker computes the pin with the pin tool. It needs no token or
worker, opens no network connection and uploads nothing: it reads the file in
the client's environment and writes a small pin file (name, byte size,
SHA-256, header columns, who confirmed it and when) that the auditor loads
into the platform's "Pin client dataset" form. The header is read as the
worker reads it (UTF-8 CSV, byte order mark allowed, names kept exactly).

```powershell
python -m engine.client_pin pin --file data.csv --confirmed-by "Name, role" --output pin.json
```

**Client attestation.** The client can sign the pin with an Ed25519 key it
controls, so the custody record does not rest only on the auditor's entry.
The tool builds a statement of the pin, canonical JSON (sorted keys, no
spaces, UTF-8) with exactly the fields `columns`, `confirmedBy`,
`confirmedOn`, `kind` (`assurance.client-dataset-pin`), `name`,
`schemaVersion` (`1.0`), `sha256` and `size`, and a detached signature over
those exact bytes. The pin file's `attestation` carries the statement,
signature and DER public key (SubjectPublicKeyInfo), each base64, and
`keySha256`, the SHA-256 of that DER key. With the optional `cryptography`
package:

```powershell
python -m engine.client_pin keygen --output client-key.pem
python -m engine.client_pin pin --file data.csv --confirmed-by "Name, role" --key client-key.pem --output pin.json
```

Without it, sign with OpenSSL 3 and attach the signature (standard library
only):

```powershell
python -m engine.client_pin pin --file data.csv --confirmed-by "Name, role" --statement-out statement.json --output unsigned.json
openssl pkeyutl -sign -rawin -inkey client-key.pem -in statement.json -out statement.sig
openssl pkey -in client-key.pem -pubout -out client-key.pub.pem
python -m engine.client_pin attach --statement statement.json --signature statement.sig --public-key client-key.pub.pem --output pin.json
```

The platform verifies the signature when it records the pin and refuses a
pin whose fields differ from the signed statement; it keeps the statement,
signature and key, and the dossier names the key fingerprint. Anyone can
check a pin file again, and the file itself:

```powershell
python -m engine.client_pin verify --pin pin.json --file data.csv --key-sha256 <fingerprint>
```

A signature shows that the holder of the key made the statement. That the
holder is the client rests on the auditor confirming the key fingerprint with
the client through an independent channel (for example in the engagement
letter or a call), not on the platform. The signature is not a qualified
electronic signature or a timestamp, and the private key never leaves the
client.

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
