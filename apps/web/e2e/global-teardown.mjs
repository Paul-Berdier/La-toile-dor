import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalTeardown() {
  const e2eDir = dirname(fileURLToPath(import.meta.url));
  const pidFile = join(e2eDir, "..", ".next", "e2e-server.pid");
  if (!existsSync(pidFile)) return;

  const pid = Number(readFileSync(pidFile, "utf8"));
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
    }
  }

  try {
    unlinkSync(pidFile);
  } catch {
    // Le serveur a pu supprimer son PID pendant son arrêt.
  }
}
