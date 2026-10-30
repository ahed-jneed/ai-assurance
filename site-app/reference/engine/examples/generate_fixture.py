"""Regenerate synthetic, non-personal example CSVs; never used in production."""
import csv
from pathlib import Path


def generate() -> None:
    directory = Path(__file__).resolve().parent
    rows = []
    for group in ("A", "B"):
        for i in range(40):
            actual = int(i < 20)
            if group == "A":
                predicted = int(i < 18 or 20 <= i < 24)
            else:
                predicted = int(i < 16 or 20 <= i < 22)
            rows.append({"actual": actual, "predicted": predicted, "score": 0.85 if predicted else 0.15, "group": group, "feature_age": 20+(i % 20)})
    with (directory / "predictions.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (directory / "reference.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["feature_age"])
        writer.writeheader()
        writer.writerows({"feature_age": row["feature_age"]} for row in rows)


if __name__ == "__main__":
    generate()

