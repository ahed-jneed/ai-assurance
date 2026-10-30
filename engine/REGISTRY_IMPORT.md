# Read-only model-registry snapshots

`registry_import.py` acquires a **proposed registration snapshot** from an MLflow REST registry or Hugging Face Hub without loading any model. It resolves mutable references to an exact MLflow numeric version or Hugging Face full commit, captures acquisition times and original response-byte hashes, and produces a typed declaration of known input/output fields with explicit unknowns. It never grants audit approval or runtime readiness.

The MLflow GET paths follow the official [REST API model-version and alias endpoints](https://mlflow.org/docs/latest/api_reference/rest-api.html). Hugging Face metadata acquisition uses the model revision API documented through its [Hub API reference](https://huggingface.co/docs/hub/api). Signatures are interpreted as input/output declarations using [MLflow signature concepts](https://mlflow.org/docs/latest/ml/model/signatures/); column presence requirements do not establish cell nullability. Model-card metadata is handled as declared information using the [Hugging Face repository-card reference](https://huggingface.co/docs/huggingface_hub/package_reference/cards).

## Commands

Use a dedicated read-only registry token provisioned through the service environment or secret manager. `--token-env` takes the **variable name**, never the token value. The tool's CLI logs only proposed/rejected state, provider, snapshot digest, artifact-acquired boolean and local output path.

```powershell
python -m engine.registry_import mlflow --origin https://mlflow.example --allowed-host mlflow.example --token-env MLFLOW_READONLY_TOKEN --name credit-model --alias champion --output snapshots\credit-model.json

python -m engine.registry_import mlflow --origin https://mlflow.example --allowed-host mlflow.example --token-env MLFLOW_READONLY_TOKEN --name credit-model --version 17 --output snapshots\credit-model-v17.json

python -m engine.registry_import huggingface --origin https://huggingface.co --allowed-host huggingface.co --token-env HF_READONLY_TOKEN --repo owner/model-name --revision main --output snapshots\hub-model.json
```

Create the output directory beforehand. Outputs use exclusive creation: an existing snapshot or artifact is never overwritten.

MLflow requires exactly one `--version` or `--alias`. Alias acquisition first reads the alias record, then reads its resolved numeric version; name/version and observed source/run must match. Later alias movement does not change the captured version. The actual artifact content is separate from the registry version record: mutable tags/descriptions and source URIs remain declarations until independently verified.

Hugging Face `--revision` defaults to `main`, which is resolved once. Metadata and an available `README.md` are then acquired from exact-commit paths. An explicit commit must match the API response. `--no-card` retains only card metadata supplied by the pinned model API response. Repository identity and pinned commit must match. Redirects, including model downloads redirected to another artifact host, are rejected.

## Signature extraction and explicit gaps

The MLflow model-version REST response does not itself provide the model's full signature. Supply a separately acquired bounded signature JSON export and an exact source reference:

```text
--signature-json signatures/credit-model.json
--signature-reference runs:/run-id/model/MLmodel#signature
```

The export accepts the MLflow `ModelSignature.to_dict()` shape: `inputs` and `outputs` are JSON schema arrays, or JSON strings containing those arrays. A local signature export records its actual file SHA-256 and size; its association to the registry version remains operator-declared. This module does not retrieve and parse arbitrary YAML `MLmodel` files, infer signatures from sample data, follow source URIs, or use a model loader. When no signature is supplied, feature and output fields remain explicit unknowns.

For traditional models published on Hugging Face, a publisher may place a MLflow-style `signature` object in custom `cardData.signature` metadata. That is an optional publisher declaration, **not a standard guaranteed feature of every model card**. Absent signatures remain unknown. The captured `library_name`, pipeline tag, license, model-index/evaluation statements and model-card prose are preserved as source declarations; they are not independently measured metrics and do not determine task compatibility or approval.

Known scalar signature types map to number, integer, text and boolean. Strings are not assumed to be categories. Tensor dtype/shape and nested/unrecognized types are retained; unsupported types become `unknown`. Unnamed tensor inputs remain `name:null` rather than receiving invented feature names. `required:false` records optional field presence; `nullable`, units and null handling remain unknown. Output type declarations do not establish class ordering, probability meaning, decision threshold, intended use or preprocessing. A proposed contract needs human review and a supported runtime adapter before execution.

## Exact artifact approval

Model bytes are acquired only when **all four** parameters are supplied:

```text
--artifact-url https://approved-host/exact/path
--approved-artifact-url https://approved-host/exact/path
--expected-artifact-sha256 <64 lowercase hex>
--artifact-output acquired/model.onnx
```

The requested URL must equal the operator-approved URL and use the same exact allowlisted hostname/port as metadata acquisition. The actual bytes must match the expected SHA-256 before a file is created. Hugging Face URLs must identify the captured repository and commit through `/owner/repo/resolve/<commit>/<filename>`; the filename must appear in the pinned listing, and an available LFS hash must agree. Branch/latest URLs are rejected for artifacts. MLflow gateway URLs remain explicitly operator-associated to the frozen version when the declared source URI differs; the module does not invent a stronger registry-to-artifact custody relationship.

Downloads copy bounded bytes only; the artifact is never deserialized or executed. A `.pkl` or unknown artifact remains inert bytes, and this acquisition does not authorize the worker to load it. The worker's format/isolation/runtime/local-hash gates are independent. Hosted LFS/Xet/CDN redirects are deliberately rejected: acquire through an approved same-host artifact gateway or a separately implemented, reviewed connector rather than widening this collector's authority automatically.

## Snapshot contract

The JSON envelope contains:

```text
schemaVersion: "1.0"
type: "registry_snapshot"
provider: "mlflow" | "huggingface"
status: "proposed"
auditApproval: "not_granted"
registration: {name, version, task:null, format:null, framework, declaredPipelineTag,
               status:"proposed", declarationAssurance}
source: {registryOrigin, allowedHost, requestedReference, resolvedReference,
         acquiredAt, responses:[{url, kind, acquiredAt, sha256, bytes}],
         declarationAssurance}
metadata: <captured exact-version provider JSON contents>
card: {metadata, text, sha256, acquisition, declarationAssurance} | null
systemContract: {schemaVersion, features:[{name, type, declaredType, tensorDtype,
                shape, presenceRequired, nullable:null, nullHandling:"unknown",
                unit:null, declarationAssurance}], outputs:{fields, semantics:null,
                classOrder:null, threshold:null}, preprocessing:{status:"unknown",
                artifactSha256:null}, signature, signatureSource, unknownFields,
                declarationAssurance, executionReadiness:"not_assessed"}
artifact: {acquired:false} | <approved URL/digest/size/filename/scope record>
limitations: string[]
snapshotDigestEncoding: "engine-canonical-json-v1"
snapshotSha256: <canonical checksum excluding only snapshotSha256>
```

Response digests hash original acquired bytes, while parsed metadata/card contents are included in the snapshot. Original HTTP response bodies are not separately retained by this module; retain them through an organization-controlled acquisition/custody service if independent byte-for-byte source reconstruction is required. Snapshot checksums use the engine's canonical JSON encoding. Preserve the original uploaded snapshot bytes and compute a separate file digest in the platform; parsing and reserializing it in another language can change numeric encodings. `verify_snapshot()` checks the checksum locally, but no checksum authenticates the provider or proves the declaration's truth. There is no signature or timestamp anchor in this collector.

## Security bounds and validation

The collector permits GET requests only and requires HTTPS plus an explicit exact `--allowed-host` (including a nondefault port where present). No wildcard, cross-host redirect, URL user-info, unsafe relative path or credential-bearing URL query is accepted. Bearer tokens come from the named environment variable and are never included in snapshot structures or CLI log messages. Read-only token scopes and permitted network egress remain operator/server controls. Metadata/card content is treated as data; no document instructions, imports or repository code run.

Requests have a 15-second default socket timeout and checked read-loop budget (maximum configured timeout 30 seconds); an in-flight socket read remains bounded by the socket timeout. Metadata is at most 2 MiB, UTF-8 card at most 512 KiB and artifact at most 100 MiB. Compressed responses are rejected to avoid uncontrolled decoding. JSON rejects duplicate keys and non-finite numbers. No package installation is required. Loopback HTTP is accessible only through an explicit test-only Python constructor argument; the public CLI exposes no HTTP bypass.

Injected synthetic fixture tests verify mutable alias/version freezing, exact Hugging Face commit/card acquisition, changed registry source and commit rejection, wrong host/redirect/oversize rejection, corrupted artifact hashes, exact artifact approval, proposal-only status, malicious model-card statements remaining inert, optional presence versus nullability, unknown tensor/nested schemas, checksum tampering and create-once CLI output. No real user models or production registry connections were used for QA. Enterprise MLflow auth variations, provider-managed artifact redirects, native runtime compatibility and deployed registry integrations remain unvalidated.
