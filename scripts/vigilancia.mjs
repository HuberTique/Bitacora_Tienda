// Vigilancia diaria de los proyectos de Supabase (plan gratis).
//
// Hace una consulta real a la base de cada proyecto. Sirve para dos cosas:
//   1. Cuenta como actividad, así el proyecto no se pausa por una semana sin uso.
//   2. Si el proyecto está pausado o caído, termina con error: GitHub Actions
//      marca la corrida en rojo y le manda un correo al dueño del repositorio.
//
// Solo usa la clave publicable (la misma que ya va en el navegador). No lee
// datos: las consultas van sin sesión y las políticas RLS devuelven vacío.
//
//   node --env-file=.env.local scripts/vigilancia.mjs      (local)
//   .github/workflows/vigilancia.yml                        (todos los días)

const proyectos = [
  {
    nombre: "Bitácora (tiendas)",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    clave: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    obligatorio: true,
  },
  {
    nombre: "Feedbacks (módulo de las DSM)",
    url: process.env.DEMO_SUPABASE_URL,
    clave: process.env.DEMO_SUPABASE_PUBLISHABLE_KEY,
    obligatorio: false,
  },
];

// Devuelve 200 si el servicio contestó. Un rechazo por permisos que viene de
// PostgreSQL (código 42501) también prueba que la base está viva: se cuenta
// como 200. Un proyecto pausado contesta otra cosa (o no contesta).
async function pedir(url, clave) {
  const r = await fetch(url, { headers: { apikey: clave }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 401 || r.status === 403) {
    const cuerpo = await r.json().catch(() => null);
    if (cuerpo?.code === "42501") return 200;
  }
  return r.status;
}

async function revisar(p) {
  if (!p.url || !p.clave) {
    return p.obligatorio ? "faltan la URL o la clave en la configuración" : null;
  }
  const base = p.url.replace(/\/$/, "");
  // Dos intentos: un proyecto gratis puede tardar en responder la primera vez.
  for (let intento = 1; ; intento++) {
    try {
      const datos = await pedir(`${base}/rest/v1/personal?select=id&limit=1`, p.clave);
      const ingreso = await pedir(`${base}/auth/v1/health`, p.clave);
      if (datos === 200 && ingreso === 200) return null;
      if (intento === 2) return `la base respondió ${datos} y el ingreso ${ingreso} (se esperaba 200)`;
    } catch (e) {
      if (intento === 2) return `no respondió (${e.message})`;
    }
    await new Promise((ok) => setTimeout(ok, 20_000));
  }
}

let fallas = 0;
for (const p of proyectos) {
  const problema = await revisar(p);
  if (problema === null && (!p.url || !p.clave)) {
    console.log(`—  ${p.nombre}: sin configurar, no se revisa`);
  } else if (problema === null) {
    console.log(`OK ${p.nombre}: activo`);
  } else {
    fallas++;
    console.error(`ALERTA ${p.nombre}: ${problema}`);
  }
}

if (fallas > 0) {
  console.error(
    "\nUn proyecto de Supabase no responde. Puede estar PAUSADO por inactividad o caído.\n" +
      "Entrar a https://supabase.com/dashboard y, si aparece pausado, pulsar «Restore project».",
  );
  process.exit(1);
}
