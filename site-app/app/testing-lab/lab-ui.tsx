// Small presentational pieces the testing lab's views and dialogs share.
export function State({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (["succeeded", "registered", "pass"].includes(value)
          ? "green"
          : ["failed", "fail"].includes(value)
            ? "red"
            : "neutral")
      }
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <label className="ml-field">
      <span>{label}</span>
      {children}
      {help && <small className="subtle">{help}</small>}
    </label>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: {
    value: string;
    label: string;
  }[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
