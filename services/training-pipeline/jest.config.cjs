/** Jest config for @smart-sneaker/training-pipeline (ts-jest, Node environment).
 * Workspace packages resolve to their TypeScript source so tests need no build step. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/insights-engine$': '<rootDir>/../../packages/insights-engine/src/index.ts',
    '^@smart-sneaker/dataset-store$': '<rootDir>/../dataset-store/src/index.ts',
  },
};
