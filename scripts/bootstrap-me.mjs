// scripts/bootstrap-me.mjs
// Crea UN usuario en Supabase Auth y su fila en public.personal, con auth_user_id enlazado.
// Uso local (nunca subir la SERVICE_ROLE_KEY):
//
//   node --env-file=.env.local scripts/bootstrap-me.mjs \
//     --cedula 1234567890 --clave MiClaveSegura2026
//
// Nombre/cargo/rol vienen hardcoded desde ROSTER_SEED del artifact original.
// Los sobreescribes con --nombre / --cargo / --rol si lo necesitas.

import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    nombre: { type: "string" },
    cedula: { type: "string" },
    cargo:  { type: "string" },
    rol:    { type: "string" },
    codigo: { type: "string" },
    clave:  { type: "string" },
  },
});

const nombre = values.nombre || "Huber Tique";
const cargo  = values.cargo  || "SUBJEFE";
const rol    = values.rol    || "jefatura";
const codigo = values.codigo || null;
const cedula = values.cedula || null;
const clave  = values.clave;

if (!clave) {
  console.error("Falta --clave.");
  console.error("");
  console.error("Ejemplo:");
  console.error("  node --env-file=.env.local scripts/bootstrap-me.mjs \\");
  console.error("    --clave MiClaveSegura2026 [--cedula 1234567890]");
  process.exit(1);
}

if (rol === "jefatura") {
  if (!(clave.length >= 8 && /[A-Za-z]/.test(clave) && /[0-9]/.test(clave))) {
    console.error("Clave de jefatura: mínimo 8 caracteres, con letras y números.");
    process.exit(1);
  }
} else if (rol === "asesor") {
  if (!/^[0-9]{6,8}$/.test(clave)) {
    console.error("Clave de asesor: PIN numérico de 6 a 8 dígitos.");
    process.exit(1);
  }
} else {
  console.error(`Rol inválido: ${rol}. Usa 'jefatura' o 'asesor'.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  console.error("Consíguelas en Supabase dashboard → Settings → API.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`\n→ Creando persona: ${nombre} (${rol}, ${cargo})…`);
const { data: persona, error: pErr } = await admin
  .from("personal")
  .insert({ nombre, cedula, cargo, rol, codigo, activo: true })
  .select()
  .single();

if (pErr) {
  console.error("Error insertando fila en public.personal:", pErr.message);
  if (pErr.code === "23505") {
    console.error("  → Ya existe una persona con esa cédula. Revisa el dashboard de Supabase.");
  }
  process.exit(1);
}
console.log(`  ✓ personal.id = ${persona.id}`);

const email = `${persona.id}@bitacora-tienda.local`;

console.log(`→ Creando auth user: ${email}…`);
const { data: authRes, error: aErr } = await admin.auth.admin.createUser({
  email,
  password: clave,
  email_confirm: true,
});

if (aErr) {
  console.error("Error creando auth user:", aErr.message);
  console.error("Rollback: borrando fila en public.personal…");
  await admin.from("personal").delete().eq("id", persona.id);
  process.exit(1);
}
console.log(`  ✓ auth.users.id = ${authRes.user.id}`);

console.log(`→ Enlazando persona.auth_user_id…`);
const { error: linkErr } = await admin
  .from("personal")
  .update({ auth_user_id: authRes.user.id })
  .eq("id", persona.id);

if (linkErr) {
  console.error("Error enlazando auth_user_id:", linkErr.message);
  process.exit(1);
}

console.log("\n✓ Listo.");
console.log(`  Nombre : ${nombre}`);
console.log(`  Rol    : ${rol}`);
console.log(`  Cargo  : ${cargo}`);
console.log(`  Cédula : ${cedula}`);
console.log(`  Clave  : (la que enviaste — guárdala)`);
console.log("");
console.log("Ya puedes hacer login desde http://localhost:3000/login (una vez construyamos la UI).");
