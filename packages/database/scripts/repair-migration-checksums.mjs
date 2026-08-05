/**
 * Réaligne les empreintes des migrations DÉJÀ APPLIQUÉES sur le contenu actuel
 * de leurs fichiers.
 *
 * Pourquoi : Prisma empreinte chaque migration au moment où il l'applique. Si
 * le fichier change ensuite — fin de ligne réécrite par `core.autocrlf` sous
 * Windows, BOM retiré à la main — Prisma considère qu'une migration appliquée
 * a été modifiée et propose un `migrate reset`, c'est-à-dire la destruction de
 * la base. Ce script est l'alternative non destructive : il ne touche QUE la
 * colonne `checksum` de `_prisma_migrations`, jamais le schéma ni les données.
 *
 * À n'utiliser qu'après avoir vérifié que le schéma en base correspond bien au
 * SQL des fichiers (`prisma migrate status` → « Database schema is up to date »).
 *
 * Usage : node scripts/repair-migration-checksums.mjs [--apply]
 * Sans `--apply`, le script se contente d'énumérer les écarts.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/client/index.js";

const APPLY = process.argv.includes("--apply");
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
);

let drifted = 0;
for (const row of rows) {
  const file = path.join(MIGRATIONS_DIR, row.migration_name, "migration.sql");
  if (!existsSync(file)) {
    console.log(`⚠ ${row.migration_name} : appliquée en base mais absente du dépôt — ignorée.`);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual === row.checksum) continue;

  drifted += 1;
  console.log(`≠ ${row.migration_name}`);
  console.log(`    enregistré : ${row.checksum}`);
  console.log(`    fichier    : ${actual}`);
  if (APPLY) {
    await prisma.$executeRawUnsafe(
      `UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2`,
      actual,
      row.migration_name,
    );
    console.log("    → empreinte réalignée.");
  }
}

if (drifted === 0) {
  console.log("Toutes les empreintes correspondent.");
} else if (!APPLY) {
  console.log(`\n${drifted} écart(s). Relancer avec --apply pour les réaligner.`);
}

// Rappel : le dossier des migrations peut contenir des migrations non encore
// appliquées ; elles ne sont pas concernées et seront jouées normalement.
const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const applied = new Set(rows.map((r) => r.migration_name));
const pending = onDisk.filter((name) => !applied.has(name));
if (pending.length > 0) {
  console.log(`\nMigrations en attente d'application : ${pending.join(", ")}`);
}

await prisma.$disconnect();
