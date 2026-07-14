/** Jest config for @smart-sneaker/e2e (ts-jest, Node environment).
 * Workspace packages resolve to their TypeScript source so tests need no build step. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/insights-engine$': '<rootDir>/../../packages/insights-engine/src/index.ts',
    '^@smart-sneaker/ingest-api$': '<rootDir>/../../services/ingest-api/src/index.ts',
    '^@smart-sneaker/session-worker$': '<rootDir>/../../services/session-worker/src/index.ts',
    '^@smart-sneaker/dataset-store$': '<rootDir>/../../services/dataset-store/src/index.ts',
    '^@smart-sneaker/training-pipeline$': '<rootDir>/../../services/training-pipeline/src/index.ts',
    '^@smart-sneaker/dashboard$': '<rootDir>/../../apps/dashboard/src/index.ts',
    '^@smart-sneaker/design-system$': '<rootDir>/../../packages/design-system/src/index.ts',
  },
};
