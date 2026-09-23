import type { Config } from "./config.js";
import type { JevBackend } from "./jev.js";
import type { Store } from "./store.js";
import type { DatacenterList } from "./datacenterRanges.js";
import type { LimitsStore } from "./limitsStore.js";
import type { ManifestStore } from "./manifest.js";
import type { ScoringStore } from "./scoringStore.js";
import type { WeightStore } from "./weightStore.js";

export type Route = "judge" | "vote" | "usage" | "health" | "export" | "stats" | "clients" | "weights" | "scoring" | "manifest" | "adminManifest" | "tuner" | "simulate" | "limits" | "devices";

/** Everything a request handler needs, built once per server instance. */
export interface Ctx {
  config: Config;
  store: Store;
  weights: WeightStore;
  scoring: ScoringStore;
  /** The default per-install daily and per-IP hourly limits (live-editable); an install can override them. */
  limits: LimitsStore;
  manifest: ManifestStore;
  datacenter: DatacenterList;
  jev: JevBackend | null;
  criteriaVersion: string;
  version: string;
}
