import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
    css: { postcss: { plugins: [] } },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/unit/**/*.test.{ts,tsx}"],
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
})
