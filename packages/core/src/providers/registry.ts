import type { HostProvider } from "./types";

class ProviderRegistry {
  private providers: HostProvider[] = [];

  register(provider: HostProvider): void {
    if (this.providers.some((item) => item.id === provider.id)) {
      throw new Error(`Provider with id '${provider.id}' already registered`);
    }
    this.providers.push(provider);
  }

  findProvider(url: string): HostProvider | null {
    for (const provider of this.providers) {
      if (provider.match(url).matches) {
        return provider;
      }
    }
    return null;
  }

  getProviders(): HostProvider[] {
    return [...this.providers];
  }

  getProviderById(id: string): HostProvider | null {
    return this.providers.find((item) => item.id === id) || null;
  }
}

export const registry = new ProviderRegistry();

export function registerProvider(provider: HostProvider): void {
  registry.register(provider);
}

export function findProvider(url: string): HostProvider | null {
  return registry.findProvider(url);
}

export function getProviders(): HostProvider[] {
  return registry.getProviders();
}

export function getProviderById(id: string): HostProvider | null {
  return registry.getProviderById(id);
}
