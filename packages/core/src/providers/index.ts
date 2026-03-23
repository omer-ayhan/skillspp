export type {
  HostProvider,
  ProviderMatch,
  RemoteSkill,
  WellKnownFetchOptions,
  WellKnownProvider,
  RemoteSkillsProvider,
} from "./types";
export {
  registry,
  registerProvider,
  findProvider,
  getProviders,
  getProviderById,
} from "./registry";
export { SecureWellKnownProvider, wellKnownProvider } from "./wellknown";
export { HttpCatalogProvider, catalogProvider } from "./catalog";

import { registerProvider } from "./registry";
import { wellKnownProvider } from "./wellknown";
import { catalogProvider } from "./catalog";

let initialized = false;

export function initializeProviders(): void {
  if (initialized) {
    return;
  }
  registerProvider(wellKnownProvider);
  registerProvider(catalogProvider);
  initialized = true;
}
