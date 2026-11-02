// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Dependency injection container
 */

type Class<T = any> = new (...args: any[]) => T;
type Factory<T = any> = (...args: any[]) => T;

interface Registration<T = any> {
  instance?: T;
  factory?: Factory<T>;
  class?: Class<T>;
  singleton: boolean;
  dependencies?: string[];
}

export class DIContainer {
  private registrations = new Map<string, Registration>();
  private instances = new Map<string, any>();

  /**
   * Register a singleton
   */
  registerSingleton<T>(token: string, instance: T): void;
  registerSingleton<T>(token: string, factory: Factory<T>, dependencies?: string[]): void;
  registerSingleton<T>(token: string, classDef: Class<T>, dependencies?: string[]): void;
  registerSingleton<T>(
    token: string,
    arg: T | Factory<T> | Class<T>,
    dependencies?: string[]
  ): void {
    if (typeof arg === 'function') {
      if (arg.prototype && arg.prototype.constructor) {
        this.registrations.set(token, {
          class: arg as Class<T>,
          singleton: true,
          dependencies,
        });
      } else {
        this.registrations.set(token, {
          factory: arg as Factory<T>,
          singleton: true,
          dependencies,
        });
      }
    } else {
      this.registrations.set(token, {
        instance: arg,
        singleton: true,
      });
    }
  }

  /**
   * Register a transient (a new instance is created each time)
   */
  registerTransient<T>(token: string, factory: Factory<T>, dependencies?: string[]): void;
  registerTransient<T>(token: string, classDef: Class<T>, dependencies?: string[]): void;
  registerTransient<T>(
    token: string,
    arg: Factory<T> | Class<T>,
    dependencies?: string[]
  ): void {
    if (typeof arg === 'function') {
      if (arg.prototype && arg.prototype.constructor) {
        this.registrations.set(token, {
          class: arg as Class<T>,
          singleton: false,
          dependencies,
        });
      } else {
        this.registrations.set(token, {
          factory: arg as Factory<T>,
          singleton: false,
          dependencies,
        });
      }
    }
  }

  /**
   * Get an instance
   */
  get<T>(token: string): T {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new Error(`No registration found for token: ${token}`);
    }

    // If an instance already exists, return it directly
    if (registration.singleton && registration.instance) {
      return registration.instance as T;
    }

    // Resolve dependencies
    const deps = registration.dependencies?.map(dep => this.get(dep)) || [];

    // Create the instance
    let instance: T;
    if (registration.factory) {
      instance = registration.factory(...deps);
    } else if (registration.class) {
      instance = new registration.class(...deps);
    } else {
      instance = registration.instance as T;
    }

    // If it is a singleton, cache the instance
    if (registration.singleton) {
      registration.instance = instance;
    }

    return instance;
  }

  /**
   * Check whether a token is registered
   */
  has(token: string): boolean {
    return this.registrations.has(token);
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.registrations.clear();
    this.instances.clear();
  }

  /**
   * Get all registered tokens
   */
  getTokens(): string[] {
    return Array.from(this.registrations.keys());
  }
}

// Export singleton instance
export const diContainer = new DIContainer();
