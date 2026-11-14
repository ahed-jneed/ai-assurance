# Security policy

## Supported versions

This project is pre-1.0. Only the latest commit on `main` gets security fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
open the repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- the affected component: for example the site-app identity modes, evidence upload and storage, report signing, the engine worker or verifier, or the GenAI evidence parsers;
- the commit you tested;
- steps to reproduce, and a proof of concept if you have one;
- the impact you expect.

We aim to acknowledge a report within 3 business days and to triage it within
10 business days. We coordinate disclosure with you, and the target for a fix is
within 90 days.

## Scope

In scope:

- authorization bypass across practices, engagements or the client portal;
- forged identity headers or session handling flaws in a deployed identity mode;
- tampering with evidence, hashes, report snapshots or signatures without detection;
- code execution, path traversal or resource exhaustion in the engine parsers and worker (`engine/`);
- unsafe deserialization or server-side request forgery.

Out of scope:

- the `dev` and `trusted-headers` identity modes when they are used against their
  documented constraints (see [`docs/security/identity.md`](docs/security/identity.md));
- the demo personas and seed data;
- findings that need a compromised operator account or Worker secret.

## Hardening references

- [Identity modes](docs/security/identity.md)
- [Signing keys](docs/security/signing-keys.md)
- [Engine worker and compute isolation](engine/WORKER.md)

This reference implementation has not had an independent security assessment.
Do a security review of your own before you deploy it with real audit evidence.
