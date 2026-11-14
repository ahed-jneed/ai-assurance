// The Test catalog tab: every testing capability and where it runs.
import { tests } from "@/lib/evaluation";

export function TestCatalog() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Testing capabilities</h2>
      </div>
      {tests.map((t) => (
        <div className="ml-capability" key={t.id}>
          <div>
            <b>{t.label}</b>
            <p className="subtle">{t.requires}</p>
            <small className="subtle">{t.tasks.join(" · ")}</small>
          </div>
          <span className="badge neutral">
            {t.mode === "interactive"
              ? "Available here"
              : t.mode === "external"
                ? "External Python runner"
                : "Integration required"}
          </span>
        </div>
      ))}
    </section>
  );
}
