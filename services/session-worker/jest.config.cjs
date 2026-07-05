/** Jest config for @smart-sneaker/session-worker (ts-jest, Node environment).
 * Shared packages resolve to their TypeScript source so tests need no build step. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/insights-engine$': '<rootDir>/../../packages/insights-engine/src/index.ts',
  },
};
