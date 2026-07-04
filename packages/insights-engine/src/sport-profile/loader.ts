import {
  SportProfile,
  SportProfileSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';

/** Requested profile id doesn't exist in the registry. */
export class SportProfileNotFoundError extends Error {
  constructor(profileId: string, knownIds: readonly string[]) {
    super(
      `unknown sport profile "${profileId}"; known profiles: ${knownIds.length > 0 ? knownIds.join(', ') : '(none)'}`,
    );
    this.name = 'SportProfileNotFoundError';
  }
}

/** A profile config entry failed contract validation — a build/config bug, not a runtime condition to swallow. */
export class SportProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SportProfileConfigError';
  }
}

export type SportProfileRegistry = ReadonlyMap<string, SportProfile>;

/**
 * Build a registry from raw config entries, validating each against the
 * SportProfile contract. Supporting a new sport means adding one config entry
 * here (Req. 12) — this function and the loader never change per sport.
 */
export function createSportProfileRegistry(configs: readonly unknown[]): SportProfileRegistry {
  const registry = new Map<string, SportProfile>();
  configs.forEach((config, index) => {
    const result = validateContract(SportProfileSchema, config);
    if (!result.ok) {
      const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
      throw new SportProfileConfigError(`sport profile config at index ${index} is invalid — ${detail}`);
    }
    if (registry.has(result.data.profileId)) {
      throw new SportProfileConfigError(
        `duplicate sport profile id "${result.data.profileId}" at index ${index}`,
      );
    }
    registry.set(result.data.profileId, result.data);
  });
  return registry;
}

/**
 * Resolve a profile id to its full, validated profile. Throws
 * SportProfileNotFoundError for unknown ids — never falls back to a default,
 * so a typo can't silently run the wrong sport's pipeline.
 */
export function loadSportProfile(
  profileId: string,
  registry: SportProfileRegistry,
): SportProfile {
  const profile = registry.get(profileId);
  if (!profile) {
    throw new SportProfileNotFoundError(profileId, [...registry.keys()]);
  }
  return profile;
}
