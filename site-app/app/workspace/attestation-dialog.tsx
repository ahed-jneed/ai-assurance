"use client";
// The attestation dialog (F-45): every sign-off, approval, stage advance,
// evidence acceptance and finding closure opens it instead of firing on one
// click. It shows the record, revision and digest the decision binds and the
// statement the person makes, takes their rationale, and sends all of it with
// the command, whose audit event records it (lib/attestation.ts).
import {
  createContext,
  use,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  attestationDigest,
  attestationSubject,
  attestedOps,
  type AttestationSubject,
  type AttestedOp,
} from "@/lib/attestation";
import type { Engagement } from "@/lib/domain";
import { errorMessage } from "@/lib/fetch-json";
import type { WorkspaceAct } from "./types";

/** Opens the attestation dialog for an attested command and its data. */
export type Attest = (op: AttestedOp, values: Record<string, unknown>) => void;
type Request = { op: AttestedOp; values: Record<string, unknown>; run: number };

const AttestContext = createContext<Attest | null>(null);

/** The attestation opener of the workspace (see AttestationProvider). */
export function useAttest(): Attest {
  const attest = use(AttestContext);
  if (!attest) throw Error("useAttest needs an AttestationProvider");
  return attest;
}

/** Makes `attest` the workspace's useAttest(). */
export function AttestProvider({
  attest,
  children,
}: {
  attest: Attest;
  children: ReactNode;
}) {
  return <AttestContext value={attest}>{children}</AttestContext>;
}

/**
 * The workspace's attestation state: `attest` opens the dialog, and `dialog`
 * renders it. The command runs through `act` with the attestation added; the
 * dialog shows its failure, so the command reports nowhere else.
 */
export function useAttestation(
  engagement: Engagement | null | undefined,
  act: WorkspaceAct,
) {
  const [request, setRequest] = useState<Request | null>(null);
  const attest: Attest = (op, values) =>
    setRequest((previous) => ({ op, values, run: (previous?.run ?? 0) + 1 }));
  const dialog = request && engagement && (
    <AttestationDialog
      key={request.run}
      engagement={engagement}
      op={request.op}
      values={request.values}
      onClose={() => setRequest(null)}
      onConfirm={(attestation) =>
        act(request.op, { ...request.values, attestation }, undefined, {
          quiet: true,
        })
      }
    />
  );
  return { attest, dialog, open: !!request };
}

/** What the dialog sends as `data.attestation`. */
export type AttestationPayload = {
  rationale: string;
  revision: number;
  digest: string;
};

function AttestationDialog({
  engagement,
  op,
  values,
  onClose,
  onConfirm,
}: {
  engagement: Engagement;
  op: AttestedOp;
  values: Record<string, unknown>;
  onClose: () => void;
  onConfirm: (attestation: AttestationPayload) => Promise<unknown>;
}) {
  // The subject as the dialog opened: a refresh behind it does not change
  // what the person reviews; the server refuses it if it went stale.
  const [subject] = useState(() => attestationSubject(engagement, op, values));
  const [digest, setDigest] = useState(""),
    [rationale, setRationale] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (subject)
      void attestationDigest(subject).then((d) => {
        if (active) setDigest(d);
      });
    return () => {
      active = false;
    };
  }, [subject]);
  const confirm = async () => {
    if (!subject || !digest) return;
    if (!rationale.trim()) {
      setError("Give your rationale for this decision.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onConfirm({
        rationale: rationale.trim(),
        revision: subject.revision,
        digest,
      });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure, "The decision was not recorded"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="audit-dialog attestation-dialog">
        <DialogHeader>
          <DialogTitle>{attestedOps[op].title}</DialogTitle>
          <DialogDescription>
            Review what you attest to. Your statement and rationale are recorded
            in the audit trail with this decision.
          </DialogDescription>
        </DialogHeader>
        <AttestationForm
          op={op}
          subject={subject}
          digest={digest}
          rationale={rationale}
          onRationale={setRationale}
          error={error}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's body: the subject, the statement, the rationale and actions. */
export function AttestationForm({
  op,
  subject,
  digest,
  rationale,
  onRationale,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  op: AttestedOp;
  subject: AttestationSubject | null;
  digest: string;
  rationale: string;
  onRationale: (value: string) => void;
  error: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId(),
    definition = attestedOps[op];
  if (!subject)
    return (
      <div className="standard-form">
        <p className="form-error" role="alert">
          This record is no longer in the engagement. Reload and try again.
        </p>
        <div className="row-actions">
          <Button type="button" variant="outline" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  return (
    <form
      className="standard-form attestation-form"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <fieldset disabled={busy} className="form-grid">
        <dl className="attestation-subject">
          <dt>Record</dt>
          <dd>{subject.label}</dd>
          <dt>Revision</dt>
          <dd>{subject.revision}</dd>
          <dt>Change</dt>
          <dd>{subject.change}</dd>
          <dt>SHA-256</dt>
          <dd>
            <code className="attestation-digest">{digest || "Computing…"}</code>
          </dd>
        </dl>
        <p className="attestation-statement" id={id + "-statement"}>
          {definition.statement}
        </p>
        <label htmlFor={id + "-rationale"}>
          Rationale
          <Textarea
            id={id + "-rationale"}
            name="rationale"
            required
            aria-required
            aria-describedby={id + "-statement"}
            maxLength={2000}
            value={rationale}
            onChange={(event) => onRationale(event.target.value)}
            placeholder="What you checked and why it supports this decision"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span className="subtle">
            Recorded with your name and the time in the audit trail.
          </span>
          <div className="row-actions">
            <Button type="submit" disabled={busy || !digest}>
              {busy ? "Recording…" : definition.action}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
