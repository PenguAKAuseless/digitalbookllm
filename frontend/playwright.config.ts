import { defineConfig } from "@playwright/test"

/**
 * E2E suite runs against a fully deployed stack (frontend + backend + DB).
 * Set PLAYWRIGHT_BASE_URL to point at a local dev server or a staging
 * deployment; see docs/test-scenarios.md for the scenario -> spec mapping.
 */
export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30000,
    fullyParallel: false,
    retries: 0,
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
        trace: "retain-on-failure",
    },
})
