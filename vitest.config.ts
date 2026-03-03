import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        clearMocks: true,
        environment: 'node',
        include: ['**/?(*.)+(spec|test).ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage'
        }
    }
});
