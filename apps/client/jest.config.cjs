/** Jest config for @smart-sneaker/client (ts-jest, Node environment).
 * Workspace packages resolve to their TypeScript source so tests need no build
 * step. `react-native` is mapped to a lightweight host-component mock so
 * screen tests run under plain react-test-renderer without the Metro/Babel
 * toolchain — the real module is only needed on-device. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/insights-engine$': '<rootDir>/../../packages/insights-engine/src/index.ts',
    '^react-native$': '<rootDir>/test/mocks/react-native.ts',
  },
};
