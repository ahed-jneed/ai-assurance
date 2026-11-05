import { z } from "zod";
import { assist, canonical } from "../../assurance-core";
import {
  addRecord,
  briefingExport,
  recordStatement,
} from "../../assurance-store";
import { bucket } from "../../bindings";
import { base64, signingKey, unbase64 } from "../../dossier";
import { save } from "../../engagement-repo";
import { ApiError } from "../../http";
import { now, sha256 } from "../../ids";
import { defineCommands } from "../command";
import { note, short } from "../fields";
import type { AssuranceModule } from "./target";
/**
 * The cited source assistant: signed briefing exports, imported external
 * drafts, deterministic cited assistance and adopting a draft into a paper.
 */
export const assistant: AssuranceModule = defineCommands({
  exportBriefing: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, lookup, pick, accepted }, d, ctx) {
      const v = z
        .object({
          sourceIds: z.array(short).min(1).max(30),
          processingDestination: short,
          governanceArtifactId: short,
          reason: note,
        })
        .strict()
        .parse(d);
      accepted(v.governanceArtifactId, "Governance");
      if (new Set(v.sourceIds).size !== v.sourceIds.length)
        throw new ApiError(400, "Source IDs must be unique");
      const sources = [],
        locations = await lookup(v.sourceIds);
      for (const sourceId of v.sourceIds) {
        const r = pick(locations, sourceId, "location"),
          artifact = accepted(r.body.artifactId),
          o = await bucket().get(artifact.key);
        if (
          !o ||
          artifact.sha256 !== r.body.artifactSha256 ||
          (await sha256(await o.arrayBuffer())) !== artifact.sha256
        )
          throw new ApiError(409, "Source bytes or authorization pin changed");
        if (r.body.excerpt.length > 8000)
          throw new ApiError(
            413,
            "Select a location with at most 8,000 excerpt characters",
          );
        sources.push({
          id: r.id,
          engagementId: e.id,
          sha256: r.sha256,
          excerptSha256: await sha256(r.body.excerpt),
          sourceVersion: r.sha256,
          location: r.body.locator,
          excerpt: r.body.excerpt,
          semantics: null,
        });
      }
      if (
        sources.reduce(
          (n, s) => n + new TextEncoder().encode(s.excerpt).length,
          0,
        ) >
        128 * 1024
      )
        throw new ApiError(413, "Combined excerpts exceed 128 KiB");
      const at = now(),
        base = {
          schemaVersion: "1.0",
          tenantId: ctx.tenantId,
          engagementId: e.id,
          context: {
            capturedAt: at,
            sourceVersion: await sha256(
              JSON.stringify(
                sources.map((s) => ({ id: s.id, sha256: s.sha256 })),
              ),
            ),
          },
          authorization: {
            principalId: ctx.user.userId,
            tenantId: ctx.tenantId,
            engagementId: e.id,
            purpose: "evidence_briefing",
            sourceIds: v.sourceIds,
            issuedAt: at,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
          sources,
        },
        packetSha256 = await sha256(canonical(base)),
        key = await signingKey(ctx),
        privateKey = await crypto.subtle.importKey(
          "pkcs8",
          unbase64(key.private_key),
          "Ed25519",
          false,
          ["sign"],
        ),
        signature = base64(
          await crypto.subtle.sign(
            "Ed25519",
            privateKey,
            new TextEncoder().encode(canonical(base)),
          ),
        );
      const record = await addRecord(ctx, e.id, "assistant_export", {
        packetSha256,
        sourcePins: sources.map(({ excerpt, engagementId, ...s }) => s),
        principalId: ctx.user.userId,
        processingDestination: v.processingDestination,
        governanceArtifactId: v.governanceArtifactId,
        reason: v.reason,
        keyId: key.id,
        expiresAt: base.authorization.expiresAt,
      });
      return Response.json(
        {
          record,
          packet: {
            ...base,
            packetSha256,
            signature: { algorithm: "Ed25519", keyId: key.id, signature },
          },
          trust: { [key.id]: key.public_key },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  },
  importBriefing: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, lookup, pick, accepted }, d, ctx) {
      const v = z
          .object({ artifactId: short, assessment: note })
          .strict()
          .parse(d),
        artifact = accepted(v.artifactId),
        o = await bucket().get(artifact.key);
      if (!o || o.size > 2 * 1024 * 1024)
        throw new ApiError(400, "Select a permitted briefing JSON up to 2 MB");
      const bytes = await o.arrayBuffer();
      if ((await sha256(bytes)) !== artifact.sha256)
        throw new ApiError(409, "Briefing bytes changed");
      const raw = JSON.parse(new TextDecoder().decode(bytes)),
        draft = z
          .object({
            schemaVersion: z.literal("1.0"),
            type: z.literal("cited_evidence_briefing"),
            tenantId: short,
            engagementId: short,
            status: z.literal("draft"),
            immutable: z.literal(true),
            humanWorkflow: z
              .object({
                requiresIndependentAdoption: z.literal(true),
                automaticallyAdopted: z.literal(false),
                canReview: z.literal(false),
                canSign: z.literal(false),
                canRelease: z.literal(false),
              })
              .strict(),
            draftSha256: z.string(),
            retrievedPins: z
              .array(
                z
                  .object({
                    id: short,
                    sha256: z.string(),
                    excerptSha256: z.string(),
                    sourceVersion: z.string(),
                    location: short,
                    semantics: z.null(),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
            provenance: z
              .object({
                packetSha256: z.string(),
                processingDestination: short,
                requestedModel: short,
                promptVersion: short,
                noTools: z.literal(true),
                principalId: short,
              })
              .passthrough(),
            draft: z
              .object({
                suggestions: z
                  .array(
                    z
                      .object({
                        text: note.max(2000),
                        citations: z.array(short).min(1).max(30),
                      })
                      .strict(),
                  )
                  .max(20),
                missingSupport: z
                  .array(
                    z
                      .object({
                        topic: note.min(1).max(1000),
                        reason: z.enum([
                          "insufficient_excerpt",
                          "source_not_in_packet",
                          "context_mismatch",
                        ]),
                        relatedSourceIds: z.array(short).max(30),
                      })
                      .strict(),
                  )
                  .max(20),
                candidateContradictions: z
                  .array(
                    z.object({
                      text: note,
                      citations: z.array(short).length(2),
                    }),
                  )
                  .max(100),
              })
              .strict(),
            limitations: z.array(z.string()).max(100),
          })
          .passthrough()
          .parse(raw);
      const { draftSha256, ...captured } = raw;
      if (
        (await sha256(canonical(captured))) !== draftSha256 ||
        draft.tenantId !== ctx.tenantId ||
        draft.engagementId !== e.id
      )
        throw new ApiError(409, "Briefing scope or immutable digest mismatch");
      const exported = await briefingExport(
        ctx,
        e.id,
        draft.provenance.packetSha256,
        draft.provenance.processingDestination,
      );
      if (
        !exported ||
        exported.body.principalId !== ctx.user.userId ||
        draft.provenance.principalId !== ctx.user.userId
      )
        throw new ApiError(
          403,
          "No authorized matching processing export for this principal",
        );
      const pinned = await lookup(draft.retrievedPins.map((p) => p.id));
      if (
        new Set(draft.retrievedPins.map((p) => p.id)).size !==
          draft.retrievedPins.length ||
        draft.retrievedPins.length !== exported.body.sourcePins.length ||
        draft.retrievedPins.some(
          (p) =>
            !exported.body.sourcePins.some(
              (s: typeof p) =>
                s.id === p.id &&
                s.sha256 === p.sha256 &&
                s.excerptSha256 === p.excerptSha256 &&
                s.sourceVersion === p.sourceVersion &&
                s.location === p.location,
            ) || !pinned.some((s) => s.id === p.id && s.sha256 === p.sha256),
        )
      )
        throw new ApiError(
          409,
          "Retrieved source pins do not match the authorized export",
        );
      if (
        draft.draft.missingSupport.some((x) =>
          x.relatedSourceIds.some(
            (id) => !draft.retrievedPins.some((p) => p.id === id),
          ),
        ) ||
        draft.draft.suggestions.some(
          (x) => new Set(x.citations).size !== x.citations.length,
        )
      )
        throw new ApiError(
          400,
          "Missing support or suggestion citations violate the source scope",
        );
      if (
        [
          ...draft.draft.suggestions,
          ...draft.draft.candidateContradictions,
        ].some((x) =>
          x.citations.some((c) => !draft.retrievedPins.some((p) => p.id === c)),
        )
      )
        throw new ApiError(400, "A proposal cites an unauthorized source");
      if (draft.draft.candidateContradictions.length)
        throw new ApiError(
          400,
          "These exported manual locations have no complete matched comparison semantics; record contradictions through human assessment",
        );
      return {
        record: await addRecord(ctx, e.id, "assistant", {
          provider: "external-unverified-proposal",
          originAssurance:
            "Uploaded provider, model and prompt provenance is declared. No independently authenticated service receipt has been captured.",
          modelVersion: draft.provenance.requestedModel,
          promptVersion: draft.provenance.promptVersion,
          provenance: draft.provenance,
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          sourceIds: draft.retrievedPins.map((p) => p.id),
          citations: draft.retrievedPins.map((p) => ({
            recordId: p.id,
            sha256: p.sha256,
            location: pick(pinned, p.id, "location").body.locator,
            label: pick(pinned, p.id, "location").body.label,
          })),
          items: draft.draft.suggestions.map((s) => ({
            text: s.text,
            citationIds: s.citations,
            type: "generative_proposal",
          })),
          missingSupport: draft.draft.missingSupport,
          auditorAssessment: v.assessment,
          limitations: draft.limitations,
          status: "proposal",
        }),
      };
    },
  },
  assist: {
    roles: ["Auditor", "Lead Auditor", "Reviewer"],
    async handle({ e, lookup, accepted }, d, ctx) {
      const v = z
        .object({
          sourceIds: z.array(short).min(1).max(30),
          action: z.enum([
            "summary",
            "contradictions",
            "questions",
            "unsupported",
          ]),
        })
        .strict()
        .parse(d);
      // The briefing reads the selected records and the source locations
      // their relations cite.
      const selected = await lookup(v.sourceIds),
        all = await lookup([
          ...v.sourceIds,
          ...selected.flatMap((x) =>
            (x.body.relations ?? []).map(
              (rel: { locationId: string }) => rel.locationId,
            ),
          ),
        ]);
      const locations = all.filter(
        (r) =>
          r.kind === "location" &&
          (v.sourceIds.includes(r.id) ||
            all
              .filter((x) => v.sourceIds.includes(x.id))
              .some((x) =>
                x.body.relations?.some(
                  (rel: { locationId: string }) => rel.locationId === r.id,
                ),
              )),
      );
      for (const loc of locations) {
        const a = accepted(loc.body.artifactId);
        if (a.sha256 !== loc.body.artifactSha256)
          throw new ApiError(409, "Cited source pin changed");
        const o = await bucket().get(a.key);
        if (!o || (await sha256(await o.arrayBuffer())) !== a.sha256)
          throw new ApiError(409, "Cited source bytes unavailable or altered");
      }
      return {
        record: await addRecord(ctx, e.id, "assistant", {
          ...assist(all, v.sourceIds, v.action),
          sourceIds: v.sourceIds,
        }),
      };
    },
  },
  acceptAssistant: {
    roles: ["Auditor", "Lead Auditor"],
    async handle({ e, lookup, find, accepted }, d, ctx) {
      const v = z
          .object({ assistantId: short, editedText: note, paperId: short })
          .strict()
          .parse(d),
        draft = await find(v.assistantId, "assistant"),
        p = e.papers.find((x) => x.id === v.paperId);
      if (
        !p ||
        p.status !== "draft" ||
        e.workflow?.procedures.some((x) => x.paperId === p.id)
      )
        throw new ApiError(
          409,
          "Select a supplementary draft paper; compiled procedure work must be recorded in its source procedure",
        );
      const cited = await lookup(
        draft.body.citations.map((c: { recordId: string }) => c.recordId),
      );
      for (const citation of draft.body.citations) {
        const source = cited.find(
          (r) => r.id === citation.recordId && r.sha256 === citation.sha256,
        );
        if (!source) throw new ApiError(409, "A cited revision is unavailable");
        if (source.kind === "location") {
          const artifact = accepted(source.body.artifactId),
            o = await bucket().get(artifact.key);
          if (
            artifact.sha256 !== source.body.artifactSha256 ||
            !o ||
            (await sha256(await o.arrayBuffer())) !== artifact.sha256
          )
            throw new ApiError(
              409,
              "Cited source bytes changed since the briefing",
            );
        }
      }
      p.history.push({
        revision: p.revision,
        body: { ...p.body },
        authorId: p.authorId,
        at: p.updatedAt,
        evidenceIds: [...p.evidenceIds],
        runIds: [...p.runIds],
        reviews: [...p.reviews],
        signatures: [...p.signatures],
        contributors: [...p.contributors],
      });
      p.body.results +=
        "\n\nAuditor-accepted cited draft:\n" +
        v.editedText +
        "\nSources: " +
        draft.body.citations
          .map(
            (x: { recordId: string; sha256: string }) =>
              x.recordId + " @ " + x.sha256,
          )
          .join("; ");
      p.contributors = [...new Set([...p.contributors, ctx.user.userId])];
      p.revision++;
      p.authorId = ctx.user.userId;
      p.updatedAt = now();
      p.reviews = [];
      p.signatures = [];
      const adoption = await recordStatement(
        ctx,
        e.id,
        "assistant_acceptance",
        { ...v, assistantSha256: draft.sha256, paperRevision: p.revision },
      );
      await save(
        ctx,
        e,
        e.version,
        "acceptCitedDraft",
        { assistantId: draft.id, paperId: p.id },
        (cmd) => [adoption.guarded(cmd)],
      );
      return { record: adoption.record };
    },
  },
});
