export default {
    preset: 'ts-jest/presets/default-esm',
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    setupFiles: [],
    testEnvironment: 'node',
    testMatch: [ '**/?(*.)+(spec|test).ts' ],
    transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', {
            useESM: true
        }]
    },
    transformIgnorePatterns: [ '<rootDir>/node_modules/' ],
    moduleNameMapper: {
        '^(\\.\\.?\\/.+)\\.js$': '$1'
    },
    extensionsToTreatAsEsm: ['.ts']
};
