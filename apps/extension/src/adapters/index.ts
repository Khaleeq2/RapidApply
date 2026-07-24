import type { SiteAdapter } from "./types";
import { linkedinObserverAdapter } from "./linkedin/observer";

export const siteAdapters: readonly SiteAdapter[] = [linkedinObserverAdapter];

export function findSiteAdapter(url: URL): SiteAdapter | null {
  return siteAdapters.find((adapter) => adapter.matches(url)) ?? null;
}

export type {
  AdapterObservation,
  AdapterPageType,
  ApplicationStepKind,
  ObservedAction,
  ObservedField,
  SiteAdapter,
} from "./types";
