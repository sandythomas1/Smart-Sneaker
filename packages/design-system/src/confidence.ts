/**
 * Confidence presentation logic. Maps the engine's 0–1 confidence +
 * `reliable` flag (data-contracts InsightResult) to a display level with an
 * icon glyph and label, so meaning never rides on color alone.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unreliable';

export interface ConfidenceDisplay {
  level: ConfidenceLevel;
  /** Glyph paired with the label — the non-color channel. */
  icon: string;
  label: string;
  /** Rounded percentage, e.g. 92. Absent for unreliable insights. */
  percent?: number;
}

export const HIGH_CONFIDENCE_MIN = 0.85;
export const MEDIUM_CONFIDENCE_MIN = 0.6;

export function describeConfidence(confidence: number, reliable: boolean): ConfidenceDisplay {
  if (!reliable) {
    return { level: 'unreliable', icon: '⊘', label: 'Not reliable this session' };
  }
  const clamped = Math.min(1, Math.max(0, confidence));
  const percent = Math.round(clamped * 100);
  if (clamped >= HIGH_CONFIDENCE_MIN) {
    return { level: 'high', icon: '●', label: `High confidence · ${percent}%`, percent };
  }
  if (clamped >= MEDIUM_CONFIDENCE_MIN) {
    return { level: 'medium', icon: '◐', label: `Medium confidence · ${percent}%`, percent };
  }
  return { level: 'low', icon: '○', label: `Low confidence · ${percent}%`, percent };
}
