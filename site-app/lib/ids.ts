// Identifiers, timestamps and SHA-256 digests. Dependency-free, so pure modules
// and unit tests can use them without loading the Worker bindings.
export async function sha256(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 12);
}
export function now() {
  return new Date().toISOString();
}
