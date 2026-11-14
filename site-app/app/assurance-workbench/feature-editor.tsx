"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyFeature, type FeatureRow } from "./types";

/** The ordered feature contract of the system registration form. */
export function FeatureEditor({
  features,
  setFeatures,
  onDirty,
}: {
  features: FeatureRow[];
  setFeatures: (features: FeatureRow[]) => void;
  onDirty: () => void;
}) {
  return (
    <section className="feature-editor">
      <h4>Ordered feature contract</h4>
      {features.map((f, i) => (
        <div className="feature-row" key={i}>
          <Input
            aria-label={"Feature " + (i + 1) + " name"}
            placeholder="Column name"
            required
            value={f.name}
            onChange={(ev) =>
              setFeatures(
                features.map((x, j) =>
                  j === i ? { ...x, name: ev.target.value } : x,
                ),
              )
            }
          />
          <select
            aria-label={"Feature " + (i + 1) + " type"}
            value={f.type}
            onChange={(ev) =>
              setFeatures(
                features.map((x, j) =>
                  j === i ? { ...x, type: ev.target.value } : x,
                ),
              )
            }
          >
            {["number", "integer", "category", "text", "boolean"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <Input
            aria-label={"Feature " + (i + 1) + " unit"}
            placeholder="Units"
            value={f.unit}
            onChange={(ev) =>
              setFeatures(
                features.map((x, j) =>
                  j === i ? { ...x, unit: ev.target.value } : x,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            disabled={features.length === 1}
            onClick={() => setFeatures(features.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setFeatures([...features, emptyFeature()]);
          onDirty();
        }}
      >
        Add feature
      </Button>
      <p className="subtle">
        This input contract rejects nulls. Portable native adapters currently
        accept complete numeric preprocessed columns; text and nullable
        pipelines require validated adapters.
      </p>
    </section>
  );
}
