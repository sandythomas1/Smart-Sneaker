import { z } from 'zod';

/** One field-level problem found while validating an untrusted payload. */
export interface ValidationIssue {
  /** Dot-joined path to the offending field, or "(root)" for top-level problems. */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate an untrusted payload against a contract schema, returning
 * descriptive field-level issues instead of throwing (Req. 15's "actionable
 * error"). Every system boundary — ingest API, BLE session reconstruction,
 * worker event handling — should consume unknown input through this.
 */
export function validateContract<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  };
}
