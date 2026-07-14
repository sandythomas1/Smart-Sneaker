/** Jest config for @smart-sneaker/demo-web (ts-jest, jsdom for component tests).
 * Workspace packages resolve to their TypeScript source so tests need no build
 * step; the app tsconfig targets Vite (ESNext/bundler), so ts-jest overrides
 * module settings for the CommonJS test runtime. */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@smart-sneaker/data-contracts$': '<rootDir>/../../packages/data-contracts/src/index.ts',
    '^@smart-sneaker/insights-engine$': '<rootDir>/../../packages/insights-engine/src/index.ts',
    '^@smart-sneaker/design-system$': '<rootDir>/../../packages/design-system/src/index.ts',
    '\\.css$': '<rootDir>/test/mocks/style.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          jsx: 'react-jsx',
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
