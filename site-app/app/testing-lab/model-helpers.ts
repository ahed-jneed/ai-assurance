// What a registered model version can do here, and the lab's file exports.
import type { Model } from "@/lib/domain";

export function modelCapability(m: Model) {
  return m.format === "Prediction file" &&
    m.status === "registered" &&
    m.task !== "Classical NLP"
    ? "Saved predictions ready"
    : m.task === "Classical NLP"
      ? "Define a classification task to evaluate predictions"
      : "External adapter required";
}
/** Saves a JSON value, or Markdown text, as a file in the browser. */
export function download(name: string, value: unknown, markdown = false) {
  const url = URL.createObjectURL(
      new Blob([markdown ? String(value) : JSON.stringify(value, null, 2)], {
        type: markdown ? "text/markdown" : "application/json",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function modelMarkdown(m: Model) {
  const source = m.card?.source;
  const sourceText = source
    ? "\n\n## Source\n\nKind: " +
      source.kind +
      (source.kind === "huggingface"
        ? "\n\nRepository: " +
          source.repoId +
          "\n\nCommit: " +
          source.revision +
          "\n\nFile: " +
          source.filename
        : "")
    : "";
  return (
    "# " +
    m.name +
    "\n\nVersion: " +
    m.version +
    "\n\nTask: " +
    m.task +
    "\n\n## Intended use\n\n" +
    m.intendedPurpose +
    "\n\n" +
    (m.card
      ? Object.entries(m.card)
          .filter(([key]) => !["schemaVersion", "source"].includes(key))
          .map(
            ([key, v]) => "## " + key.replace(/([A-Z])/g, " $1") + "\n\n" + v,
          )
          .join("\n\n")
      : "Legacy card; additional declarations not recorded.") +
    sourceText +
    "\n\n## Evidence pin\n\nArtifact: " +
    m.artifactId +
    "\n\nSHA-256: " +
    (m.sourceSha256 ?? "Not captured at registration") +
    "\n\nProvider declarations require independent corroboration.\n"
  );
}
