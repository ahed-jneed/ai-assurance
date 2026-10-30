import type { Report } from './domain';
export async function verifyPackage(report: Report, digest: (value: string) => Promise<string>, client = false) {
    const snapshot = client ? report.clientSnapshot : report.snapshot, expected = client ? report.clientSha256 : report.sha256;
    if (!snapshot || !expected)
        throw Error('This report has no captured package for the requested audience');
    const actual = await digest(JSON.stringify(snapshot));
    const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence as {
        id: string;
        sha256: string;
        name: string;
    }[] : [];
    const papers = Array.isArray(snapshot.papers) ? snapshot.papers as {
        id: string;
        revision: number;
        title: string;
    }[] : [];
    const leaves = [];
    for (const p of papers)
        leaves.push({ kind: 'working_paper', id: p.id, revision: p.revision, title: p.title, sha256: await digest(JSON.stringify(p)) });
    for (const a of evidence)
        leaves.push({ kind: 'evidence', id: a.id, title: a.name, sha256: a.sha256 });
    leaves.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return { schemaVersion: '1.0', reportId: report.id, audience: client ? 'client' : 'internal', valid: actual === expected, expectedSha256: expected, actualSha256: actual, manifestSha256: await digest(JSON.stringify(leaves)), items: leaves, hashAlgorithm: 'SHA-256', serialization: 'JSON.stringify of the captured snapshot; property order preserved', scope: 'Snapshot bytes and captured manifest references. Evidence bytes are verified on diagnostic input loading; this check does not re-read every stored file or establish external signing or timestamping.' };
}
