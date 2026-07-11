/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import plugin from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [plugin()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@core": path.resolve(__dirname, "./src/core"),
            "@infra": path.resolve(__dirname, "./src/infrastructure"),
            "@presentation": path.resolve(__dirname, "./src/presentation"),
        },
    },
    server: {
        port: 63437,
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
    },
})
