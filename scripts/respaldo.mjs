// Copia de seguridad completa del proyecto de Supabase enlazado (producción).
//
//   node scripts/respaldo.mjs
//
// Guarda, FUERA del repositorio (son datos personales reales):
//   - base.dump     estructura + datos de public, auth y storage (formato pg_dump -Fc)
//   - public.sql    lo mismo de public en texto, para poder leerlo o buscar en él
//   - archivos/     todo lo subido a Storage (fotos, evidencias)
//   - resumen.json  cuántas filas tenía cada tabla al momento de la copia
//
// Usa el pg_dump del PostgreSQL local (scripts/pg-local) y el acceso temporal
// que entrega la CLI de Supabase; no necesita Docker ni la clave de la base.
// Para restaurar: pg_restore sobre una base vacía (ver scripts/pg-local).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(process.env.PG_LOCAL_DIR ?? join(homedir(), "pg-local"), "pgsql", "bin");
const DESTINO_BASE =
  process.env.RESPALDOS_DIR ?? join(homedir(), "Documents", "HUBER", "Respaldos_Bitacora");
const CONSERVAR = 8; // copias que se guardan; las más viejas se borran

function leerEnv() {
  const env = {};
  for (const linea of readFileSync(join(RAIZ, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function fallar(msg) {
  console.error(`\nNO SE HIZO LA COPIA: ${msg}`);
  process.exit(1);
}

// La CLI crea un rol de acceso temporal; con --dry-run lo entrega sin ejecutar nada.
function accesoTemporal() {
  const r = spawnSync("npx supabase db dump --linked --dry-run", {
    cwd: RAIZ,
    encoding: "utf8",
    shell: true,
  });
  const texto = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const leer = (k) => texto.match(new RegExp(`export ${k}="([^"]*)"`))?.[1];
  const acceso = {
    PGHOST: leer("PGHOST"),
    PGPORT: leer("PGPORT"),
    PGUSER: leer("PGUSER"),
    PGPASSWORD: leer("PGPASSWORD"),
    PGDATABASE: leer("PGDATABASE"),
  };
  if (Object.values(acceso).some((v) => !v)) fallar("la CLI de Supabase no entregó el acceso a la base.");
  return acceso;
}

function pg(programa, args, acceso) {
  const r = spawnSync(join(BIN, `${programa}.exe`), args, {
    encoding: "utf8",
    env: { ...process.env, ...acceso, PGCLIENTENCODING: "UTF8", PGSSLMODE: "require" },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) fallar(`${programa}: ${(r.stderr || r.error?.message || "").trim().slice(0, 600)}`);
  return r.stdout;
}

async function copiarArchivos(env, carpeta) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const cab = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY };
  const pedir = async (ruta, cuerpo) => {
    const r = await fetch(`${base}/storage/v1/${ruta}`, {
      method: cuerpo ? "POST" : "GET",
      headers: { ...cab, "Content-Type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (!r.ok) fallar(`Storage ${ruta}: ${r.status}`);
    return r.json();
  };
  let total = 0;
  const recorrer = async (bucket, prefijo) => {
    for (let desde = 0; ; desde += 100) {
      const items = await pedir(`object/list/${bucket}`, { prefix: prefijo, limit: 100, offset: desde });
      for (const it of items) {
        const ruta = prefijo ? `${prefijo}/${it.name}` : it.name;
        if (it.id === null) {
          await recorrer(bucket, ruta); // carpeta
        } else {
          const r = await fetch(`${base}/storage/v1/object/${bucket}/${ruta.split("/").map(encodeURIComponent).join("/")}`, { headers: cab });
          if (!r.ok) fallar(`descargando ${bucket}/${ruta}: ${r.status}`);
          const destino = join(carpeta, bucket, ...ruta.split("/"));
          mkdirSync(dirname(destino), { recursive: true });
          writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
          total++;
        }
      }
      if (items.length < 100) break;
    }
  };
  for (const b of await pedir("bucket")) await recorrer(b.id, "");
  return total;
}

const env = leerEnv();
if (!env.SUPABASE_SERVICE_ROLE_KEY) fallar("falta SUPABASE_SERVICE_ROLE_KEY en .env.local");
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const sello = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const raizProyecto = join(DESTINO_BASE, ref);
const carpeta = join(raizProyecto, sello);
mkdirSync(carpeta, { recursive: true });

console.log(`Copia de seguridad de ${ref} → ${carpeta}`);
const acceso = accesoTemporal();

const esquemas = ["--schema=public", "--schema=auth", "--schema=storage"];
pg("pg_dump", ["--role=postgres", "-Fc", "--no-owner", ...esquemas, "-f", join(carpeta, "base.dump")], acceso);
pg("pg_dump", ["--role=postgres", "--no-owner", "--schema=public", "-f", join(carpeta, "public.sql")], acceso);

const filas = pg(
  "psql",
  ["-At", "-F", "\t", "-c",
    `set role postgres; select table_schema || '.' || table_name,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
       from information_schema.tables
      where table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema, table_name) in (('auth','users'), ('storage','objects')))
      order by 1`],
  acceso,
);
const conteo = Object.fromEntries(filas.trim().split(/\r?\n/).map((l) => { const [t, n] = l.split("\t"); return [t, Number(n)]; }));

const archivos = await copiarArchivos(env, join(carpeta, "archivos"));

// Comprobación: el archivo se puede leer y trae las tablas.
const indice = pg("pg_restore", ["-l", join(carpeta, "base.dump")], {});
const tablasConDatos = (indice.match(/TABLE DATA public /g) ?? []).length;
if (tablasConDatos === 0) fallar("el archivo base.dump no trae datos de public.");

const resumen = {
  proyecto: ref,
  fecha: new Date().toISOString(),
  tamano_base_dump_kb: Math.round(statSync(join(carpeta, "base.dump")).size / 1024),
  tablas_public_con_datos: tablasConDatos,
  archivos_storage: archivos,
  filas: conteo,
};
writeFileSync(join(carpeta, "resumen.json"), JSON.stringify(resumen, null, 2));

const copias = readdirSync(raizProyecto).sort();
for (const vieja of copias.slice(0, Math.max(0, copias.length - CONSERVAR))) {
  rmSync(join(raizProyecto, vieja), { recursive: true, force: true });
}

console.log(`Listo. base.dump ${resumen.tamano_base_dump_kb} KB · ${tablasConDatos} tablas · ${archivos} archivos de Storage`);
console.log(`Filas: personal ${conteo["public.personal"]}, usuarios ${conteo["auth.users"]}`);
