/** Jest config for @smart-sneaker/dashboard (ts-jest, Node environment).
 * Workspace packages resolve to their TypeScript source so tests need no build step. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/ingest-api$': '<rootDir>/../../services/ingest-api/src/index.ts',
  },
};
