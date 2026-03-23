export type ExperimentalFeature = "catalog";

export function assertExperimentalFeatureEnabled(
  feature: ExperimentalFeature,
  enabled: boolean
): void {
  if (enabled) {
    return;
  }

  if (feature === "catalog") {
    throw new Error(
      "Catalog source is experimental and requires explicit experimental mode."
    );
  }
}
