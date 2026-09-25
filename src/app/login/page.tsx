"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useTienda } from "@/lib/tienda-config";
import { emailFor, type Rol, type RosterPublico } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const tienda = useTienda();
  const [rol, setRol] = useState<Rol>("jefatura");
  const [roster, setRoster] = useState<RosterPublico[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [recuperarOpen, setRecuperarOpen] = useState(false);

  // Si ya hay sesión, salir directo a la Bitácora.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/bitacora");
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
    router.replace("/bitacora");
  }

  const hint =
    rol === "jefatura"
      ? "Clave de jefatura: mínimo 8 caracteres, con letras y números."
      : "PIN numérico de 6 a 8 dígitos.";

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
          TIENDA: {tienda.nombre}
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

        <button
          type="button"
          onClick={() => setRecuperarOpen(true)}
          className="w-full text-center text-[12.5px] text-brand hover:underline mt-3"
        >
          ¿Olvidaste tu clave?
        </button>

        <p className="text-[11.5px] text-muted mt-4 border-t border-dashed border-line pt-3">
          {hint}
        </p>
      </div>

      {recuperarOpen && (
        <RecuperarClaveModal
          rolInicial={rol}
          roster={roster}
          onClose={() => setRecuperarOpen(false)}
          onListo={(personaIdRecuperada, rolRecuperado) => {
            setRecuperarOpen(false);
            setRol(rolRecuperado);
            setPersonaId(personaIdRecuperada);
            setClave("");
          }}
        />
      )}
    </main>
  );
}

function RecuperarClaveModal({
  rolInicial,
  roster,
  onClose,
  onListo,
}: {
  rolInicial: Rol;
  roster: RosterPublico[];
  onClose: () => void;
  onListo: (personaId: string, rol: Rol) => void;
}) {
  const [rol, setRol] = useState<Rol>(rolInicial);
  const [personaId, setPersonaId] = useState("");
  const [cedula, setCedula] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [claveConfirma, setClaveConfirma] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = roster.filter((p) => p.rol === rol);

  useEffect(() => {
    if (filtered.length === 0) {
      setPersonaId("");
      return;
    }
    if (!filtered.find((p) => p.id === personaId)) {
      setPersonaId(filtered[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol, roster]);

  const hint =
    rol === "jefatura"
      ? "Mínimo 8 caracteres, con letras y números."
      : "PIN numérico de 6 a 8 dígitos.";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!personaId) return;
    if (!cedula.trim()) {
      setError("Escribe tu cédula tal como está registrada en Personal.");
      return;
    }
    if (!claveNueva) {
      setError("Escribe la nueva clave.");
      return;
    }
    if (claveNueva !== claveConfirma) {
      setError("Las claves no coinciden.");
      return;
    }
    setSaving(true);
    const { data, error: fnErr } = await supabase.functions.invoke("recuperar-clave", {
      body: { persona_id: personaId, cedula: cedula.trim(), clave: claveNueva },
    });
    setSaving(false);
    if (fnErr) {
      // Supabase envuelve errores no-2xx en FunctionsHttpError sin exponer
      // el body por default; lo leemos de context.response para el mensaje real.
      let bodyErr: string | null = null;
      try {
        const ctx = (fnErr as unknown as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const bodyText = await ctx.response.text();
          try {
            bodyErr = JSON.parse(bodyText)?.error ?? bodyText;
          } catch {
            bodyErr = bodyText;
          }
        }
      } catch {
        // ignora, quedamos con fnErr.message
      }
      const msg =
        bodyErr ??
        (data as { error?: string } | null)?.error ??
        fnErr.message ??
        "No se pudo restablecer la clave.";
      setError(msg);
      return;
    }
    if ((data as { error?: string } | null)?.error) {
      setError((data as { error: string }).error);
      return;
    }
    setOkMsg("Clave actualizada. Ya puedes entrar con tu nueva clave.");
    setTimeout(() => onListo(personaId, rol), 1200);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-[10px] p-6 max-w-md w-full relative shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none"
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-1 pr-8">
          Recuperar clave
        </h3>
        <p className="text-muted text-[12.5px] mb-4">
          Verifica tu identidad con tu cédula (la misma que está registrada
          en Personal) para definir una nueva clave, sin necesitar que otra
          persona te la restablezca.
        </p>

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
                <option>Sin personas registradas para este rol.</option>
              ) : (
                filtered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — {p.cargo}
                  </option>
                ))
              )}
            </select>
          </Field>

          <Field label="Cédula">
            <input
              type="text"
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              placeholder="Como está registrada en Personal"
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="off"
            />
          </Field>

          <Field label="Nueva clave">
            <input
              type="password"
              value={claveNueva}
              onChange={(e) => setClaveNueva(e.target.value)}
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted mt-1">{hint}</p>
          </Field>

          <Field label="Confirmar nueva clave">
            <input
              type="password"
              value={claveConfirma}
              onChange={(e) => setClaveConfirma(e.target.value)}
              className="w-full px-3 py-2.5 border border-line rounded-md bg-white text-sm"
              autoComplete="new-password"
            />
          </Field>

          {error && (
            <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mb-3.5">
              {error}
            </div>
          )}
          {okMsg && (
            <div className="bg-emerald-50 text-operaciones border border-emerald-200 rounded-md px-3 py-2 text-xs mb-3.5">
              {okMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !!okMsg || filtered.length === 0}
            className="w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
          >
            {saving ? "Guardando…" : "Restablecer clave"}
          </button>
        </form>
      </div>
    </div>
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
