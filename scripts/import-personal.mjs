// scripts/import-personal.mjs
//
// Bulk import de personal desde un CSV con columnas:
//   nombre,codigo,cedula,cargo,rol,activo,motivoBaja
//
// Reglas:
//  - Match por cédula (si el CSV la trae) → UPDATE de nombre, codigo, cargo, rol.
//  - Match por nombre (case-insensitive) sin match por cédula → SKIP con warning.
//  - Sin match → INSERT. Si activo, además crea auth user con clave default
//    (Tienda2026 para jefatura, 123456 para asesor).
//  - Inactivos NO reciben auth user (bloqueados en login). Al reactivar en el
//    futuro se corre resetear-clave desde /personal.
//
// Uso:
//   node --env-file=.env.local scripts/import-personal.mjs \
//     --csv "C:\\Users\\Personal\\Downloads\\personal_2026-08-28.csv" [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const CLAVE_JEFATURA = "Tienda2026";
const CLAVE_ASESOR   = "123456";

const { values } = parseArgs({
  options: {
    csv:       { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.csv) {
  console.error("Falta --csv <ruta al csv>.");
  console.error("Uso: node --env-file=.env.local scripts/import-personal.mjs --csv <path> [--dry-run]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- CSV parse (simple; asume que ningún campo contiene comas ni saltos de línea) ----------
const raw = readFileSync(values.csv, "utf8").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
const [header, ...lines] = raw.split("\n");
const cols = header.split(",").map(c => c.trim());
const rows = lines
  .filter(l => l.trim())
  .map(l => {
    const parts = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, (parts[i] ?? "").trim()]));
  });

console.log(`\n→ ${rows.length} filas leídas del CSV`);
if (values["dry-run"]) console.log("  (dry-run: no se escribirá en la BD)\n"); else console.log();

// ---------- Snapshot de lo que ya existe ----------
const { data: existing, error: exErr } = await admin
  .from("personal")
  .select("id, nombre, cedula, codigo, cargo, rol, activo");
if (exErr) { console.error("Error leyendo personal existente:", exErr.message); process.exit(1); }

const byCedula = new Map();
const byNombre = new Map();
for (const p of existing) {
  if (p.cedula) byCedula.set(p.cedula, p);
  byNombre.set(p.nombre.toLowerCase(), p);
}

// ---------- Import ----------
let created = 0, updated = 0, skipped = 0, authCreated = 0;
const problems = [];

for (const row of rows) {
  const nombre = row.nombre;
  if (!nombre) { problems.push("fila sin nombre — omitida"); continue; }

  const cedula = row.cedula || null;
  const codigo = row.codigo || null;
  const cargo  = row.cargo  || "—";
  const rol    = row.rol;
  const activo = row.activo === "true";
  const motivoBaja = activo ? null : (row.motivoBaja || null);

  if (rol !== "jefatura" && rol !== "asesor") {
    problems.push(`${nombre}: rol inválido "${rol}"`);
    continue;
  }

  const matchByCedula = cedula ? byCedula.get(cedula) : null;
  const matchByNombre = byNombre.get(nombre.toLowerCase()) || null;

  if (matchByCedula) {
    // UPDATE en su lugar
    if (values["dry-run"]) {
      console.log(`  UPDATE (dry-run) ${matchByCedula.nombre} → ${nombre}`);
    } else {
      const { error: upErr } = await admin
        .from("personal")
        .update({ nombre, codigo, cargo, rol })
        .eq("id", matchByCedula.id);
      if (upErr) { problems.push(`${nombre}: error actualizando (${upErr.message})`); continue; }
    }
    console.log(`  ~ ${nombre} — actualizado desde CSV (cc ${cedula})`);
    updated++;
    continue;
  }

  if (matchByNombre) {
    console.log(`  ? ${nombre} — ya existe con ese nombre pero sin cédula que coincida, se omite (revísalo manualmente)`);
    skipped++;
    continue;
  }

  // INSERT
  if (values["dry-run"]) {
    console.log(`  NEW (dry-run) ${activo ? "+" : "·"} ${nombre} (${rol}, ${cargo})${cedula ? " cc " + cedula : ""}`);
    created++;
    continue;
  }

  const { data: persona, error: insErr } = await admin
    .from("personal")
    .insert({
      nombre, cedula, codigo, cargo, rol,
      activo,
      motivo_baja: motivoBaja,
      fecha_baja: activo ? null : new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (insErr) { problems.push(`${nombre}: error insertando (${insErr.message})`); continue; }

  created++;

  if (!activo) {
    console.log(`  · ${nombre} (${rol}, inactivo: ${motivoBaja || "sin motivo"})`);
    continue;
  }

  // Activo: crear auth user + link
  const email = `${persona.id}@bitacora-tienda.local`;
  const password = rol === "jefatura" ? CLAVE_JEFATURA : CLAVE_ASESOR;

  const { data: authRes, error: aErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (aErr) {
    problems.push(`${nombre}: fila creada pero fallo creando auth (${aErr.message})`);
    continue;
  }
  const { error: linkErr } = await admin
    .from("personal")
    .update({ auth_user_id: authRes.user.id })
    .eq("id", persona.id);
  if (linkErr) {
    problems.push(`${nombre}: fila+auth creados pero fallo enlazando (${linkErr.message})`);
    continue;
  }
  authCreated++;
  console.log(`  + ${nombre} (${rol}, ${cargo})`);
}

console.log(`\n---`);
console.log(`  ${created} filas nuevas`);
console.log(`  ${updated} actualizadas`);
console.log(`  ${skipped} omitidas (ya existían por nombre)`);
console.log(`  ${authCreated} usuarios de auth creados`);
if (problems.length) {
  console.log(`\n  ${problems.length} problemas:`);
  problems.forEach(p => console.log(`    ! ${p}`));
}
if (!values["dry-run"] && authCreated > 0) {
  console.log("\nClaves iniciales por rol:");
  console.log(`  jefatura → ${CLAVE_JEFATURA}`);
  console.log(`  asesor   → ${CLAVE_ASESOR}`);
  console.log("\nCámbialas por persona desde /personal → Restablecer clave.");
}
