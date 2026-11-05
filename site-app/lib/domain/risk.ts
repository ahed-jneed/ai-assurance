// Finding risk: likelihood times impact, banded into a severity.
export function risk(likelihood: number, impact: number) {
  const score = likelihood * impact;
  return {
    riskScore: score,
    severity:
      score >= 20
        ? "Critical"
        : score >= 12
          ? "High"
          : score >= 6
            ? "Medium"
            : "Low",
  };
}
