/** Jest config for @smart-sneaker/ingest-api (ts-jest, Node environment).
 * data-contracts is resolved to its TypeScript source so tests need no build step. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
  },
};
