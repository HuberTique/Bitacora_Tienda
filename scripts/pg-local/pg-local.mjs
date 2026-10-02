// Base de datos local para ensayar migraciones y permisos antes de tocar
// producción. Usa el PostgreSQL portable instalado en la carpeta del usuario.
//
//   node scripts/pg-local/pg-local.mjs encender
//   node scripts/pg-local/pg-local.mjs apagar
//   node scripts/pg-local/pg-local.mjs reiniciar   (borra la base y aplica todas las migraciones)
//   node scripts/pg-local/pg-local.mjs sql archivo.sql
//
// No tiene datos reales ni se conecta a Supabase.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PG = process.env.PG_LOCAL_DIR ?? join(homedir(), "pg-local");
const BIN = join(PG, "pgsql", "bin");
const DATOS = join(PG, "data");
const PUERTO = "54329";
const BASE = "bitacora";

const exe = (nombre) => join(BIN, `${nombre}.exe`);

function encendida() {
  return spawnSync(exe("pg_isready"), ["-h", "127.0.0.1", "-p", PUERTO]).status === 0;
}

function encender() {
  if (encendida()) return console.log("La base local ya estaba encendida.");
  execFileSync(exe("pg_ctl"), ["-D", DATOS, "-l", join(PG, "server.log"), "-w", "start"], { stdio: "inherit" });
}

function apagar() {
  if (!encendida()) return console.log("La base local ya estaba apagada.");
  execFileSync(exe("pg_ctl"), ["-D", DATOS, "-m", "fast", "-w", "stop"], { stdio: "inherit" });
}

function psql(args, base = BASE) {
  const r = spawnSync(
    exe("psql"),
    ["-h", "127.0.0.1", "-p", PUERTO, "-U", "postgres", "-d", base, "-v", "ON_ERROR_STOP=1", "-q", ...args],
    { stdio: "inherit", env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning" } },
  );
  if (r.status !== 0) {
    console.error(`\nFalló: psql ${args.join(" ")}`);
    process.exit(1);
  }
}

function reiniciar() {
  encender();
  psql(["-c", `drop database if exists ${BASE} with (force)`], "postgres");
  psql(["-c", `create database ${BASE}`], "postgres");
  psql(["-f", join(AQUI, "base-supabase.sql")]);
  const dir = join(RAIZ, "supabase", "migrations");
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of archivos) {
    console.log(`  ${f}`);
    psql(["-f", join(dir, f)]);
  }
  console.log(`\nListo: ${archivos.length} migraciones aplicadas en la base local "${BASE}".`);
}

const [orden, arg] = process.argv.slice(2);
if (orden === "encender") encender();
else if (orden === "apagar") apagar();
else if (orden === "reiniciar") reiniciar();
else if (orden === "sql" && arg) {
  encender();
  psql(["-f", arg]);
} else {
  console.log("Uso: node scripts/pg-local/pg-local.mjs encender | apagar | reiniciar | sql <archivo.sql>");
  process.exit(1);
}
