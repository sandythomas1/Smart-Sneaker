/**
 * Minimal react-native stand-in for jest (see jest.config.cjs): components
 * become plain host elements react-test-renderer can render, so screen tests
 * run without the Metro/Babel toolchain. Only what the app's screens use —
 * extend as screens grow.
 */
export const View = 'View';
export const Text = 'Text';
export const ScrollView = 'ScrollView';

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};
