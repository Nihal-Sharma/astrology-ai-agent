import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,

    environment: "node",

    include: ["tests/**/*.test.ts"],

    /*
     * Integration/e2e tests boot a real in-memory MongoDB
     * (mongodb-memory-server downloads/starts a real mongod)
     * and a real Fastify app — give them more room than unit
     * tests need.
     */
    testTimeout: 30_000,

    hookTimeout: 30_000,
  },
});
