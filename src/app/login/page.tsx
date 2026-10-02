"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Modo = "jefatura" | "asesor";

/** Saca el mensaje real de una Edge Function que respondió con error. */
async function mensajeDeFuncion(error: unknown, data: unknown): Promise<string> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* la respuesta no era JSON */
    }
  }
  return "No se pudo ingresar. Revisa tu conexión e intenta de nuevo.";
}

/**
 * Ingreso sin lista de personas: jefatura y DSM con correo y clave; asesores
 * con su CM y PIN. La validación la hace la función `ingresar`, que bloquea
 * tras varios intentos fallidos.
 */
export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("jefatura");
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ayuda, setAyuda] = useState(false);

  // Si ya hay sesión, salir directo a la Bitácora.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/bitacora");
    });
  }, [router]);

  function cambiarModo(m: Modo) {
    setModo(m);
    setUsuario("");
    setClave("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !clave) return;
    setError(null);
    setLoading(true);
    const { data, error: fnErr } = await supabase.functions.invoke("ingresar", {
      body: { usuario: usuario.trim(), clave },
    });
    if (fnErr) {
      setLoading(false);
      setError(await mensajeDeFuncion(fnErr, data));
      return;
    }
    const tokens = data as { access_token?: string; refresh_token?: string } | null;
    if (!tokens?.access_token || !tokens.refresh_token) {
      setLoading(false);
      setError("No se pudo ingresar. Intenta de nuevo.");
      return;
    }
    const { error: sesErr } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    setLoading(false);
    if (sesErr) {
      setError(sesErr.message);
      return;
    }
    router.replace("/bitacora");
  }

  const esAsesor = modo === "asesor";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <div className="bg-panel border border-line rounded-[10px] p-9 max-w-[420px] w-full shadow-sm">
        <span className="inline-block -rotate-[3deg] border-2 border-warn text-warn font-mono text-[11px] tracking-widest px-2.5 py-0.5 rounded uppercase mb-3.5">
          Uso interno
        </span>
        <h1 className="text-[22px] mb-1 font-display font-semibold">Bitácora Digital</h1>
        <p className="text-muted text-[13px] mb-6">
          Gestión de pendientes, seguimiento por área y trazabilidad de turno.
        </p>

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mb-3.5">
            {error}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <RoleBtn active={!esAsesor} onClick={() => cambiarModo("jefatura")}>
            Jefatura / DSM
          </RoleBtn>
          <RoleBtn active={esAsesor} onClick={() => cambiarModo("asesor")}>
            Asesor
          </RoleBtn>
        </div>

        <form onSubmit={onSubmit}>
          <Field label={esAsesor ? "ID de empleado (CM)" : "Correo (o tu ID de empleado si aún no tienes correo registrado)"}>
            <input
              // "text" y no "email": una jefatura sin correo registrado entra con su CM.
              type="text"
              inputMode={esAsesor ? "numeric" : "email"}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder={esAsesor ? "Ej: 981702" : "correo o ID de empleado"}
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field label={esAsesor ? "PIN" : "Clave"}>
            <input
              type="password"
              inputMode={esAsesor ? "numeric" : undefined}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="••••••"
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="current-password"
            />
          </Field>

          <button
            type="submit"
            disabled={loading || !usuario.trim() || !clave}
            className="w-full py-3 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setAyuda((v) => !v)}
          className="w-full text-center text-[12.5px] text-brand hover:underline mt-3"
        >
          ¿Olvidaste tu clave o no puedes entrar?
        </button>

        {ayuda && (
          <div className="text-[12px] text-muted mt-3 border-t border-dashed border-line pt-3 space-y-1.5">
            {esAsesor ? (
              <p>
                Pídele a una jefatura de tu tienda que te restablezca el PIN (Personal → Restablecer
                clave). Te dará un PIN temporal y la app te pedirá cambiarlo al entrar.
              </p>
            ) : (
              <>
                <p>
                  Pídele a otra jefatura de tu tienda, o al administrador, que te restablezca la
                  clave. Te dará una clave temporal y la app te pedirá cambiarla al entrar.
                </p>
                <p>
                  Si aún no te han registrado un correo, entra escribiendo tu ID de empleado (CM) en
                  lugar del correo.
                </p>
              </>
            )}
            <p>Tras 5 intentos fallidos el ingreso se bloquea 15 minutos.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function RoleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 py-2.5 border rounded-md text-[13px] font-medium transition-colors " +
        (active ? "bg-brand text-white border-brand" : "bg-white border-line hover:bg-paper")
      }
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[12px] text-muted mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
