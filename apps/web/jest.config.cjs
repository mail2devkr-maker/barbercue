// CommonJS is intentional for this Jest configuration and its Next.js factory.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createJestConfig = require('next/jest')({ dir: __dirname });
// Reuses repository Jest + react-test-renderer; no browser/production API needed for flow tests.
module.exports = createJestConfig({ testEnvironment: 'node', testMatch: ['**/__tests__/*.test.jsx'] });
