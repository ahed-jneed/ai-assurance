// The placeholder a view shows while its first assurance read is in flight
// (#63), so an empty register is never shown for records that are still
// loading. Like the panel placeholders, it is a labelled status region.
import { Skeleton } from "@/components/ui/skeleton";

export function ViewLoading({
  label,
  rows = 1,
}: {
  /** What is loading, read out by assistive technology. */
  label: string;
  rows?: number;
}) {
  return (
    <div className="loading-grid" role="status" aria-label={label}>
      {/* Live regions announce their text, not their label. */}
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}
