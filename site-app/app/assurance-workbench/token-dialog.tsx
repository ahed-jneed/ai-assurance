"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/** The one-time runner credential of an enrolled runner. */
export function TokenDialog({
  token,
  onClose,
}: {
  token: { workerId: string; token: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!token}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="audit-dialog">
        <DialogHeader>
          <DialogTitle>Runner credential</DialogTitle>
          <DialogDescription>
            This scoped credential is shown once. Store it outside source and
            browser storage.
          </DialogDescription>
        </DialogHeader>
        <p>Worker: {token?.workerId}</p>
        <Input
          aria-label="Runner token"
          readOnly
          type="password"
          value={token?.token ?? ""}
        />
        <Button
          onClick={() => void navigator.clipboard.writeText(token?.token ?? "")}
        >
          <Copy size={15} />
          Copy credential
        </Button>
        <p className="subtle">
          Set ASSURANCE_WORKER_TOKEN on the service. Private Site dispatch
          access uses a separately provisioned platform credential. No service
          has been launched by enrollment.
        </p>
      </DialogContent>
    </Dialog>
  );
}
