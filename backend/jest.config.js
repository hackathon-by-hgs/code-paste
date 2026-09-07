const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }] },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

  clearMocks: true,
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    { ...base, displayName: 'contract', testMatch: ['<rootDir>/test/contract/**/*.spec.ts'] },
    { ...base, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'] },
    { ...base, displayName: 'security', testMatch: ['<rootDir>/test/security/**/*.spec.ts'] },
    { ...base, displayName: 'e2e', testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'] },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
};
