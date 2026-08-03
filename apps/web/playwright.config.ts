import { defineConfig } from "@playwright/test";

/**
 * Les tests e2e tournent contre un BUILD DE PRODUCTION (npm run build au
 * préalable) : c'est indispensable pour vérifier la non-fuite des données
 * confidentielles — le mode dev de React streame des données de débogage.
 */
export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.mjs",
  timeout: 60_000,
  retries: 0,
  workers: 1, // les tests partagent la base : exécution séquentielle
  use: {
    baseURL: "http://localhost:3100",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/start-production.mjs",
    url: "http://localhost:3100/connexion",
    reuseExistingServer: true,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
  },
});
