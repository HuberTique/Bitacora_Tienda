"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { emailFor, type Rol, type RosterPublico } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [rol, setRol] = useState<Rol>("jefatura");
  const [roster, setRoster] = useState<RosterPublico[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  // Si ya hay sesión, salir directo a la vista correspondiente.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data: persona } = await supabase
        .from("personal")
        .select("rol")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();
      router.replace(persona?.rol === "jefatura" ? "/personal" : "/mis-pendientes");
    });
  }, [router]);

  // Carga el roster público (RPC) para el dropdown.
  useEffect(() => {
    supabase.rpc("roster_publico").then(({ data, error }) => {
      setRosterLoaded(true);
      if (error) {
        setError(`No se pudo cargar el listado de personal: ${error.message}`);
        return;
      }
      setRoster((data as RosterPublico[] | null) ?? []);
    });
  }, []);

  const filtered = roster.filter((p) => p.rol === rol);

  // Sincroniza la selección cuando cambia el rol o la lista.
  useEffect(() => {
    if (filtered.length === 0) {
      setPersonaId("");
      return;
    }
    if (!filtered.find((p) => p.id === personaId)) {
      setPersonaId(filtered[0].id);
    }
  }, [filtered, personaId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!personaId) return;
    setError(null);
    setLoading(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: emailFor(personaId),
      password: clave,
    });
    setLoading(false);
    if (signErr) {
      setError(
        signErr.message === "Invalid login credentials"
          ? "Clave incorrecta."
          : signErr.message,
      );
      return;
    }
    router.replace(rol === "jefatura" ? "/personal" : "/mis-pendientes");
  }

  const hint =
    rol === "jefatura"
      ? "Clave de jefatura: mínimo 8 caracteres, con letras y números."
      : "PIN numérico de 4 a 6 dígitos.";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <div className="bg-panel border border-line rounded-[10px] p-9 max-w-[420px] w-full shadow-sm">
        <span className="inline-block -rotate-[3deg] border-2 border-warn text-warn font-mono text-[11px] tracking-widest px-2.5 py-0.5 rounded uppercase mb-3.5">
          Uso interno · tienda
        </span>
        <h1 className="text-[22px] mb-1 font-display font-semibold">
          Bitácora Digital
        </h1>
        <p className="text-brand text-xs font-semibold uppercase tracking-wider mb-1">
          TIENDA: Outlet de las Américas
        </p>
        <p className="text-muted text-[13px] mb-6">
          Gestión de pendientes, seguimiento por área y trazabilidad de turno.
        </p>

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mb-3.5">
            {error}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <RoleBtn active={rol === "jefatura"} onClick={() => setRol("jefatura")}>
            Jefatura
          </RoleBtn>
          <RoleBtn active={rol === "asesor"} onClick={() => setRol("asesor")}>
            Asesor
          </RoleBtn>
        </div>

        <form onSubmit={onSubmit}>
          <Field label="Nombre">
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              disabled={filtered.length === 0}
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm disabled:bg-paper disabled:text-muted"
            >
              {filtered.length === 0 ? (
                <option>
                  {rosterLoaded
                    ? `Aún no hay ${rol === "jefatura" ? "jefatura" : "asesores"} registrados.`
                    : "Cargando…"}
                </option>
              ) : (
                filtered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — {p.cargo}
                  </option>
                ))
              )}
            </select>
          </Field>

          <Field label="Clave personal">
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="••••••"
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="current-password"
            />
          </Field>

          <button
            type="submit"
            disabled={loading || !personaId || !clave}
            className="w-full py-3 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="text-[11.5px] text-muted mt-4 border-t border-dashed border-line pt-3">
          {hint}
        </p>
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
        (active
          ? "bg-brand text-white border-brand"
          : "bg-white border-line hover:bg-paper")
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[12px] text-muted mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}
