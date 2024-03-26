export default {
    preset: 'ts-jest',
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    setupFiles: [],
    testEnvironment: 'node',
    testMatch: [ '**/?(*.)+(spec|test).ts' ],
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest'
    },
    transformIgnorePatterns: [ '<rootDir>/node_modules/' ]
};
