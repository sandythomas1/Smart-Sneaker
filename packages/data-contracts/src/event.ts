import { z } from 'zod';

/**
 * Firebase Auth UID shape (also used for our own IDs). Bounding the charset
 * keeps IDs safe to embed in Firestore document paths and storage object
 * names — no separator or traversal characters.
 */
export const UserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, {
  message: 'must be 1-128 characters of A-Za-z0-9_-',
});

/**
 * A storage object path as passed between services. Charset-bounded and
 * traversal-free (defense in depth — consumers hand this to a storage read).
 */
export const BlobPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_\-/.]+$/, { message: 'must contain only A-Za-z0-9_-/. characters' })
  .refine((path) => !path.split('/').includes('..') && !path.startsWith('/'), {
    message: 'must be a relative path without .. segments',
  });

/**
 * The session-processing event: published by the ingest API (Req. 14),
 * consumed by the session worker (Req. 17). Lives in data-contracts because
 * it crosses a service boundary — the worker treats a delivered event as
 * untrusted input and validates it against this schema before acting on it.
 */
export const SessionReceivedEventSchema = z.object({
  sessionId: z.uuid(),
  ownerAthleteId: UserIdSchema,
  /** Where the ingest API stored the raw session blob. */
  blobPath: BlobPathSchema,
  /** Traces the session across upload → event → worker (Observability NFR). */
  correlationId: z.uuid(),
});
export type SessionReceivedEvent = z.infer<typeof SessionReceivedEventSchema>;
