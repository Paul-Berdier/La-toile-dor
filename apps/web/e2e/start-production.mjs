import { cpSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const e2eDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(e2eDir, "..");
const standaloneAppDir = join(appDir, ".next", "standalone", "apps", "web");
const pidFile = join(appDir, ".next", "e2e-server.pid");

// `next build` n'inclut pas automatiquement ces assets dans la sortie
// standalone. Le conteneur de production les copie lui aussi avant démarrage.
cpSync(join(appDir, ".next", "static"), join(standaloneAppDir, ".next", "static"), {
  recursive: true,
  force: true,
});

const publicDir = join(appDir, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, join(standaloneAppDir, "public"), { recursive: true, force: true });
}

process.env.PORT ??= "3100";
process.env.HOSTNAME ??= "127.0.0.1";

writeFileSync(pidFile, String(process.pid), "utf8");
process.on("exit", () => {
  try {
    unlinkSync(pidFile);
  } catch {
    // Le teardown global peut avoir retiré le fichier avant l'arrêt.
  }
});

await import(pathToFileURL(join(standaloneAppDir, "server.js")).href);
