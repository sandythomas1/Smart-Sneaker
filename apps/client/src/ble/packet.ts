import {
  SensorSample,
  SensorSampleSchema,
  validateContract,
  ValidationResult,
} from '@smart-sneaker/data-contracts';

/**
 * Wire format for one sample packet. PLACEHOLDER: UTF-8 JSON of the T1
 * SensorSample contract, chosen so T9 could proceed while the firmware packet
 * format is an open spec question. This module is the single seam to swap for
 * the real (binary, compact) format once the firmware spec pins it down —
 * re-validate the parser then, per tasks.md.
 *
 * Note for the RN adapter: Hermes needs a TextEncoder/TextDecoder polyfill;
 * moot once the format goes binary.
 */

export function encodeSamplePacket(sample: SensorSample): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sample));
}

/**
 * Decode one packet off the radio — untrusted input, validated like any other
 * boundary (constitution Security Bar): a corrupt or hostile packet yields a
 * validation failure for the caller to count and drop, never an exception
 * mid-stream.
 */
export function decodeSamplePacket(packet: Uint8Array): ValidationResult<SensorSample> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(packet);
  } catch {
    return { ok: false, issues: [{ path: '(root)', message: 'packet is not valid UTF-8' }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '(root)', message: 'packet is not valid JSON' }] };
  }
  return validateContract(SensorSampleSchema, parsed);
}
