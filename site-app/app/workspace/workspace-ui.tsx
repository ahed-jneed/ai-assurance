"use client";
// Small presentational pieces shared by the workspace views and forms.
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { humanLabel } from "@/lib/presentation";

export function Badge({ value }: { value: string }) {
  const color = [
    "signed",
    "approved",
    "accepted",
    "pass",
    "closed",
    "succeeded",
  ].includes(value)
    ? "green"
    : ["fail", "Critical", "High", "Prohibited", "failed"].includes(value)
      ? "red"
      : ["in_review", "reviewed", "running", "queued"].includes(value)
        ? "blue"
        : [
              "inconclusive",
              "quarantined",
              "provisional",
              "Medium",
              "unverified",
            ].includes(value)
          ? "amber"
          : "neutral";
  return <span className={"badge " + color}>{value.replaceAll("_", " ")}</span>;
}
export function Choice({
  value,
  onChange,
  values,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  values: ({ value: string; label: string } | string)[];
  label: string;
  disabled?: boolean;
}) {
  return (
    // Always controlled: "" shows the placeholder, and passing undefined for
    // an empty value would switch the Select from uncontrolled to controlled
    // when the first value is chosen.
    <Select disabled={disabled} value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue placeholder={"Choose " + label.toLowerCase()} />
      </SelectTrigger>
      <SelectContent>
        {values.map((v) =>
          typeof v === "string" ? (
            <SelectItem key={v} value={v}>
              {v.includes("_") ? humanLabel(v) : v}
            </SelectItem>
          ) : (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}
export function Empty({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  text: string;
  /** A way on from the empty state, such as a link to a directory. */
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
/** Saves a value as a pretty-printed JSON file. */
export function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
