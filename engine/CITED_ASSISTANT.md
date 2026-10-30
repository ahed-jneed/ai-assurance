# Optional cited evidence briefing service

This standalone service generates an evidence briefing draft from an authenticated, permission-scoped platform export. It cannot retrieve documents, call tools, load models, adopt working-paper text, review, sign, release or certify conformity. It is optional: the working audit platform remains usable with its deterministic evidence assistant.

No real provider, production key or approved processing destination is configured by this implementation. The accompanying tests use synthetic keys and mocked responses; they never send network requests. Compatibility, quality, privacy, residency, provider retention and actual deployment behavior remain to be qualified for an operator-selected service.

## Trust and human workflow

1. The platform authenticates the auditor and authorizes the engagement and each source. It exports only allowed excerpts, with source revisions, full-source SHA-256 declarations, excerpt hashes, capture version and an expiring permission statement.
2. An independently authenticated channel gives the service the expected packet SHA-256, or the platform signs the packet with an externally allowlisted Ed25519 exporter key. A hash copied from the same untrusted packet is not an independent authorization check.
3. The operator explicitly approves the configured destination identifier. Provider configuration and exporter trust pins are operator-controlled inputs, never document-derived settings.
4. The service verifies authorization, exact source membership, excerpt hashes and capture authentication before forwarding any document text.
5. Strictly validated suggestions, support gaps and scope-matched contradiction candidates become a new draft snapshot. A malformed answer rejects the entire response; there is no guessing, citation repair or automatic retry.
6. The consuming platform captures the returned draft digest through its authenticated service channel and seals the draft as evidence. An independent human checks each citation against its source and adopts edited text as a separate working-paper revision. Existing review and sign-off controls apply to that revision.

The service binds suggestions to allowed IDs and preserved source pins. Citation presence does not establish that a statement follows from the source, that the source is true, or that a quoted metric is reproducible. Candidate contradictions compare declared scope, not independently proven conflicting facts. These are human-assessed suggestions.

The create-once CLI output and draft digest provide a snapshot contract, not filesystem immutability, a qualified signature, a trusted timestamp or WORM retention. The application must store an independently captured digest or signature and enforce append-only storage. The verification helper requires that independently captured expected draft digest, so changing a draft and recomputing its self-hash cannot pass against the original trusted pin.

## Allowed source packet, version 1.0

All object fields are strict; extra fields are rejected. UTF-8 JSON uses recursively sorted object keys, compact separators and no whitespace for hashing/signatures. Duplicate keys, floats, nonfinite values, unsafe-sized integers and excessive nesting are rejected. Numeric observations belong in source excerpts or strings, avoiding cross-language floating-point canonicalization.

Example shape:

    {
      "schemaVersion": "1.0",
      "tenantId": "tenant-1",
      "engagementId": "engagement-1",
      "context": {
        "capturedAt": "2025-01-01T11:00:00Z",
        "sourceVersion": "engagement-capture-42"
      },
      "authorization": {
        "principalId": "auditor-1",
        "tenantId": "tenant-1",
        "engagementId": "engagement-1",
        "purpose": "evidence_briefing",
        "sourceIds": ["source-1"],
        "issuedAt": "2025-01-01T10:00:00Z",
        "expiresAt": "2025-01-01T13:00:00Z"
      },
      "sources": [{
        "id": "source-1",
        "engagementId": "engagement-1",
        "sha256": "64 lowercase hexadecimal characters",
        "excerptSha256": "64 lowercase hexadecimal characters",
        "sourceVersion": "paper-revision-7",
        "location": "paper:P-1/revision:7/paragraph:3",
        "excerpt": "Allowed captured excerpt.",
        "semantics": null
      }],
      "packetSha256": "64 lowercase hexadecimal characters"
    }

This is a shape illustration, not a runnable valid fixture. Times and digests must reflect a current authenticated capture.

The packet digest is SHA-256 of the canonical root object excluding packetSha256 and signature. An optional exporter signature has exactly algorithm, keyId and signature fields, with algorithm Ed25519 and canonical base64 signature bytes. It signs those same canonical body bytes. Trusted exporter configuration maps each allowed keyId to base64 DER SubjectPublicKeyInfo; no self-declared packet key is automatically trusted. Cryptography is required only for signed packet verification. No signing key is generated or persisted by the service.

Operator principal, tenant and engagement must exactly match the permission statement. The packet sources must exactly equal the unique authorized source set; every source must belong to that engagement. The temporal constraint is issuedAt <= capturedAt <= current time < expiresAt. The module owns a deep-copied snapshot, so concurrent caller edits cannot alter the request or final source pins after validation.

Source sha256 declares the full-document digest attested by the exporter. The service does not fetch or rehash full documents; it recomputes excerptSha256 over the exact UTF-8 excerpt. Locations are opaque audit references and are never dereferenced.

For comparable observations, semantics is either null or an object containing all of:

    subjectId, systemId, populationId, periodStart, periodEnd,
    metricId, unit, definitionVersion, decisionSemantics

All values are nonempty strings; periods have explicit timezones and ordered boundaries. A candidate contradiction must cite exactly two different allowed sources with identical complete semantics. Different systems, populations, periods, metric definitions, units or decision meanings fail closed. Null or partial semantics cannot support a candidate contradiction.

## Provider and model configuration

Example operator-controlled configuration:

    {
      "endpoint": "https://provider.example/v1/chat/completions",
      "allowed_hosts": ["provider.example"],
      "destination_id": "approved-region-contract",
      "provider_id": "operator-selected-compatible-provider",
      "provider_version": "operator-pinned-deployment-version",
      "model": "operator-pinned-model-version",
      "api_key_env": "ASSURANCE_BRIEFING_API_KEY",
      "timeout_seconds": 30,
      "max_response_bytes": 262144,
      "max_completion_tokens": 2000
    }

The reserved example host does not configure a usable provider. Choose an approved provider and model explicitly; no model or destination is silently selected.

Only HTTPS on port 443, an exact allowlisted canonical DNS host and a Chat Completions path are accepted. Wildcards, IP literals, URL credentials, queries, fragments, nonstandard ports, traversal paths and local-host suffixes are rejected. Configuration is not provided by a client document. The transport uses the default TLS trust store and hostname verification, does not use proxy environment variables, disables redirects, compression and automatic retries, and requires application/json.

The API key comes only from the configured environment-variable name. It is never stored in the source packet, prompt, draft or audit output. The isolated transport process receives it in memory; operating-system access controls and process isolation remain deployment responsibilities. Do not commit secrets or put them in CLI arguments or JSON.

DNS resolution, connection, TLS, headers and response reads execute in a killable spawned subprocess with one elapsed deadline. Timeout is 1–60 seconds; shutdown allows at most two additional seconds for terminate/kill cleanup. A timeout means provider-side receipt is uncertain; the service does not replay the request. The runtime must permit process spawning. Process startup or transport failure rejects the draft. Production launchers should use the usual Python main guard.

Input packets are at most 256 KiB; source count is 1–50; each excerpt is at most 8,000 characters and their combined UTF-8 size is at most 128 KiB. Request bytes are at most 512 KiB. Response bytes are capped at 256 KiB, completion tokens at 4,000, arrays at 20 items, suggestion text at 2,000 characters and individual citation lists at 10 IDs. Unsupported providers, refusals, tool calls, truncation, malformed JSON, unknown citations and out-of-scope contradictions reject the whole answer.

The provider receives a system message defining untrusted document handling and a user-data message containing only captured source records and engagement context. There are no tools, functions, external retrieval, browser, SQL or write capabilities. Prompt isolation narrows the attack surface; it cannot prove that a model ignored every malicious instruction or that cited prose is accurate.

The request uses Chat Completions with strict JSON Schema response_format, stream false and store false. Store false is a request parameter, not a claim about provider privacy or retention policy. The implementation follows the [official Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [official structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). Model support and provider behavior must be qualified before enabling the service.

## Output and API

The model answer must have exactly these arrays:

    {
      "suggestions": [{
        "text": "Proposed wording for human validation.",
        "citations": ["source-1"]
      }],
      "missingSupport": [{
        "topic": "What this packet cannot establish",
        "reason": "insufficient_excerpt",
        "relatedSourceIds": ["source-1"]
      }],
      "candidateContradictions": []
    }

Every suggestion needs one or more unique allowed source IDs. Missing-support reason is insufficient_excerpt, source_not_in_packet or context_mismatch; its related-source list may be empty but can never include an unknown ID. Contradiction candidates need exactly two distinct scope-matched IDs.

The returned record has schemaVersion 1.0 and type cited_evidence_briefing. It contains a new DRAFT identifier, tenant/engagement, captured time, draft status, immutable snapshot flag, validated draft arrays, exact retrievedPins, capturedContext, explicit humanWorkflow constraints and draftSha256. Provenance records packet authentication, operator principal, destination and exact host, provider ID/version, requested and returned model versions, response ID/fingerprint, prompt version/hash, schema hash, request hash and original response-byte hash. The draft digest covers its canonical content excluding draftSha256.

Public Python APIs:

    validate_packet(packet, principal_id=..., tenant_id=..., engagement_id=...,
                    expected_packet_sha256=... or trusted_exporter_keys=...)
    generate_briefing(packet, config=ProviderConfig(...),
                      approved_destination=..., principal_id=...,
                      tenant_id=..., engagement_id=...,
                      expected_packet_sha256=... or trusted_exporter_keys=...)
    verify_draft(draft, expected_draft_sha256=independently_captured_pin)

The completion callback seam exists for deterministic mocked tests. It is trusted Python code, never a document-selected adapter or remotely callable tool.

CLI, with an externally authenticated packet digest:

    python engine/cited_assistant.py --packet allowed-sources.json \
      --provider-config approved-provider.json \
      --approved-destination approved-region-contract \
      --principal-id auditor-1 --tenant-id tenant-1 --engagement-id engagement-1 \
      --expected-packet-sha256 INDEPENDENTLY_CAPTURED_PACKET_SHA256 \
      --output new-draft.json

Alternatively replace expected-packet-sha256 with trusted-exporter-keys pointing to the external exporter-key map. Output paths must be new; existing drafts are rejected before provider processing.

The web platform should expose this capability as unavailable until an approved configured service exists. Adoption must recheck current engagement membership and source access, compare pinned source revisions with current records, retain the original draft and exact adopted edits, and use the authenticated expected draft digest. The service's permission capture is an expiring authorization snapshot; it cannot query live revocation during provider execution.

## Validation

Run the offline suite:

    python -m unittest engine.tests.test_cited_assistant -v

The suite tests permission and tenant/engagement mismatch, expiry, exact allowed sets, missing and incorrect hashes, exporter trust/signature tampering, exact destination/host rules, absent keys, malicious document text, unknown citations, uncited claims, unknown fields, contradiction semantics, refusal/truncation/tool calls, bounded parsing, create-once output, concurrent caller mutation, independent draft pinning, no redirect/replay and isolated transport termination. All provider responses and HTTPS transports are mocked; no network or live model quality was tested.
