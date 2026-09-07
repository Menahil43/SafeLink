/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // mongodb-memory-server can take a moment to boot/download the binary on first run.
  testTimeout: 30000,
  // winston + mongoose can leave transports/handles around; keep the runner clean.
  forceExit: true,
  clearMocks: true,
  verbose: true,
};
