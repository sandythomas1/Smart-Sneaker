/**
 * Typed mirror of tokens.css for logic that needs token values (charts,
 * canvas, inline SVG). Keep in sync with tokens.css — that file is the source
 * of truth for the rendered UI.
 */
export const tokens = {
  color: {
    bg: '#0c0e12',
    surface: '#161b22',
    surfaceRaised: '#1e2530',
    border: '#2a3342',
    text: '#f2f5f8',
    textMuted: '#9aa7b8',
    textOnAccent: '#0c0e12',
    accent: '#c6f135',
    /** Per-foot data series — validated categorical pair for the dark surface.
     * Never encode foot by color alone; always pair with an L/R label. */
    footLeft: '#3987e5',
    footRight: '#d95926',
    statusGood: '#4ade80',
    statusWarn: '#ffc53d',
    statusBad: '#ff6b6b',
    statusInfo: '#7dd3fc',
  },
} as const;

export type Tokens = typeof tokens;
