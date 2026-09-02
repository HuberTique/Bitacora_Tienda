"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  MOTIVOS_BAJA,
  type MotivoBaja,
  type Persona,
  type Rol,
} from "@/lib/types";

export default function PersonalPage() {
  const router = useRouter();
  const { loading, session, persona: currentPersona } = useSession();
  const [roster, setRoster] = useState<Persona[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [givingBaja, setGivingBaja] = useState<Persona | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Persona | null>(null);

  const loadRoster = useCallback(async () => {
    const { data, error } = await supabase
      .from("personal")
      .select("*")
      .order("nombre");
    if (error) {
      setFetchError(error.message);
      return;
    }
    setFetchError(null);
    setRoster((data as Persona[] | null) ?? []);
  }, []);

  // Guard + carga inicial
  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (currentPersona && currentPersona.rol !== "jefatura") {
      router.replace("/mis-pendientes");
      return;
    }
    if (currentPersona?.rol === "jefatura") {
      loadRoster();
    }
  }, [loading, session, currentPersona, router, loadRoster]);

  if (loading || !currentPersona || currentPersona.rol !== "jefatura") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const sorted = [...roster].sort((a, b) => {
    if (a.activo !== b.activo) return a.activo ? -1 : 1;
    return a.nombre.localeCompare(b.nombre);
  });

  async function reactivar(p: Persona) {
    const { error } = await supabase
      .from("personal")
      .update({ activo: true, motivo_baja: null, fecha_baja: null })
      .eq("id", p.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadRoster();
  }

  return (
    <AppShell persona={currentPersona}>
      <div className="mx-auto max-w-[1100px] px-8 py-7 w-full">
        <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-[17px] font-display font-semibold m-0 mb-1">
              Personal
            </h2>
            <p className="text-muted text-[13px] max-w-xl">
              Personal de toda la tienda, incluyendo jefatura. Los cambios de
              tienda o salidas de la compañía se gestionan aquí.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
          >
            + Registrar ingreso
          </button>
        </div>

        {fetchError && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-4">
            {fetchError}
          </div>
        )}

        <div className="bg-panel border border-line rounded-[10px] p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left border-b border-line">
                <Th>Nombre</Th>
                <Th>ID</Th>
                <Th>Cédula</Th>
                <Th>Cargo</Th>
                <Th>Rol</Th>
                <Th>Estado</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="border-b border-line/60 last:border-0">
                  <td className="py-3 pr-3">{p.nombre}</td>
                  <td className="py-3 pr-3 font-mono text-xs">
                    {p.codigo || "—"}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs">
                    {p.cedula || "—"}
                  </td>
                  <td className="py-3 pr-3">{p.cargo}</td>
                  <td className="py-3 pr-3">
                    <RolBadge rol={p.rol} />
                  </td>
                  <td className="py-3 pr-3">
                    <EstadoBadge activo={p.activo} />
                    {!p.activo && p.motivo_baja && (
                      <div className="text-[11px] text-muted mt-0.5">
                        {p.motivo_baja}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap space-x-1">
                    <TableBtn onClick={() => setEditing(p)}>Editar</TableBtn>
                    <TableBtn
                      onClick={() => setResetting(p)}
                      disabled={!p.auth_user_id}
                      title={
                        !p.auth_user_id
                          ? "Esta persona no tiene usuario de auth enlazado."
                          : ""
                      }
                    >
                      Restablecer clave
                    </TableBtn>
                    {p.activo ? (
                      <TableBtn
                        variant="danger"
                        onClick={() => setGivingBaja(p)}
                        disabled={p.id === currentPersona.id}
                        title={
                          p.id === currentPersona.id
                            ? "No puedes darte de baja tú mismo."
                            : ""
                        }
                      >
                        Dar de baja
                      </TableBtn>
                    ) : (
                      <TableBtn onClick={() => reactivar(p)}>Reactivar</TableBtn>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No hay personas registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModal
          persona={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadRoster();
          }}
        />
      )}
      {givingBaja && (
        <BajaModal
          persona={givingBaja}
          onClose={() => setGivingBaja(null)}
          onSaved={() => {
            setGivingBaja(null);
            loadRoster();
          }}
        />
      )}
      {creating && (
        <IngresoModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            loadRoster();
          }}
        />
      )}
      {resetting && (
        <ResetClaveModal
          persona={resetting}
          onClose={() => setResetting(null)}
          onDone={() => setResetting(null)}
        />
      )}
    </AppShell>
  );
}

function ResetClaveModal({
  persona,
  onClose,
  onDone,
}: {
  persona: Persona;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clave, setClave] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const hint =
    persona.rol === "jefatura"
      ? "Mínimo 8 caracteres, con letras y números."
      : "PIN numérico de 6 a 8 dígitos.";

  async function save() {
    setError(null);
    setOkMsg(null);
    if (!clave) {
      setError("Escribe la nueva clave.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("resetear-clave", {
      body: { persona_id: persona.id, clave },
    });
    setSaving(false);
    if (error) {
      const msg =
        (data as { error?: string } | null)?.error ??
        error.message ??
        "No se pudo restablecer la clave.";
      setError(msg);
      return;
    }
    if ((data as { error?: string } | null)?.error) {
      setError((data as { error: string }).error);
      return;
    }
    setOkMsg("Clave restablecida. Guárdala y compártela con la persona.");
    setTimeout(onDone, 1200);
  }

  return (
    <Modal onClose={onClose} title={`Restablecer clave — ${persona.nombre}`}>
      <p className="text-muted text-[12.5px] mb-3">
        La clave se actualiza inmediatamente. Compártela por un canal seguro con
        la persona.
      </p>
      <ModalField label="Nueva clave" full>
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          autoComplete="new-password"
        />
        <p className="text-[11.5px] text-muted mt-1">{hint}</p>
      </ModalField>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="mt-3 bg-emerald-50 text-operaciones border border-emerald-200 rounded-md px-3 py-2 text-xs">
          {okMsg}
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving || !!okMsg}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </Modal>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-3 font-semibold text-xs uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}

function RolBadge({ rol }: { rol: Rol }) {
  return (
    <span
      className={
        "inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full text-white uppercase tracking-wider " +
        (rol === "jefatura" ? "bg-brand" : "bg-otros")
      }
    >
      {rol === "jefatura" ? "Jefatura" : "Asesor"}
    </span>
  );
}

function EstadoBadge({ activo }: { activo: boolean }) {
  return (
    <span
      className={
        "inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider " +
        (activo
          ? "bg-emerald-50 text-operaciones"
          : "bg-warn-soft text-warn")
      }
    >
      {activo ? "Activo" : "Sin acceso"}
    </span>
  );
}

function TableBtn({
  children,
  onClick,
  disabled,
  title,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "danger";
}) {
  const base =
    "text-xs px-2 py-1 border rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const style =
    variant === "danger"
      ? " border-warn text-warn bg-white hover:bg-warn-soft"
      : " border-line bg-white hover:bg-paper";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={base + style}
    >
      {children}
    </button>
  );
}

// ---------- Modales ----------

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
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
        <h3 className="font-display font-semibold text-base mb-4 pr-8">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function EditModal({
  persona,
  onClose,
  onSaved,
}: {
  persona: Persona;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(persona.nombre);
  const [codigo, setCodigo] = useState(persona.codigo ?? "");
  const [cedula, setCedula] = useState(persona.cedula);
  const [cargo, setCargo] = useState(persona.cargo);
  const [rol, setRol] = useState<Rol>(persona.rol);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    const nombreTrim = nombre.trim();
    if (!nombreTrim) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("personal")
      .update({
        nombre: nombreTrim,
        codigo: codigo.trim() || null,
        cedula: cedula.trim() || null,
        cargo: cargo.trim() || "—",
        rol,
      })
      .eq("id", persona.id);
    setSaving(false);
    if (error) {
      setError(
        error.code === "23505"
          ? "Ya existe otra persona con esa cédula."
          : error.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title={`Editar — ${persona.nombre}`}>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Nombre completo" full>
          <ModalInput value={nombre} onChange={setNombre} />
        </ModalField>
        <ModalField label="ID de empleado">
          <ModalInput value={codigo} onChange={setCodigo} placeholder="Ej: 981702" />
        </ModalField>
        <ModalField label="Cédula">
          <ModalInput value={cedula} onChange={setCedula} />
        </ModalField>
        <ModalField label="Cargo" full>
          <ModalInput value={cargo} onChange={setCargo} placeholder="Ej: FULL-TIME" />
        </ModalField>
        <ModalField label="Rol" full>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as Rol)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            <option value="asesor">Asesor</option>
            <option value="jefatura">Jefatura</option>
          </select>
        </ModalField>
      </div>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {saving ? "Guardando…" : "Guardar cambios"}
      </button>
    </Modal>
  );
}

function BajaModal({
  persona,
  onClose,
  onSaved,
}: {
  persona: Persona;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoBaja>("Cambio de tienda");
  const [otro, setOtro] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    const detalle = motivo === "Otros" ? otro.trim() || "Otros" : motivo;
    const { error } = await supabase
      .from("personal")
      .update({
        activo: false,
        motivo_baja: detalle,
        fecha_baja: new Date().toISOString().slice(0, 10),
      })
      .eq("id", persona.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title={`Dar de baja — ${persona.nombre}`}>
      <p className="text-muted text-[12.5px] mb-3">
        No podrá volver a ingresar a la bitácora. Su historial se conserva.
      </p>
      <ModalField label="Motivo" full>
        <select
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as MotivoBaja)}
          className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
        >
          {MOTIVOS_BAJA.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </ModalField>
      {motivo === "Otros" && (
        <ModalField label="Especifica" full>
          <ModalInput value={otro} onChange={setOtro} />
        </ModalField>
      )}
      {error && (
        <div className="mt-1 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 w-full py-2.5 bg-warn text-white rounded-md font-semibold text-sm disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Confirmar baja"}
      </button>
    </Modal>
  );
}

function IngresoModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cedula, setCedula] = useState("");
  const [cargo, setCargo] = useState("");
  const [rol, setRol] = useState<Rol>("asesor");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hint =
    rol === "jefatura"
      ? "Mínimo 8 caracteres, con letras y números."
      : "PIN numérico de 6 a 8 dígitos.";

  async function save() {
    setError(null);
    if (!nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!clave) {
      setError("La clave inicial es obligatoria.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("crear-persona", {
      body: {
        nombre: nombre.trim(),
        codigo: codigo.trim() || null,
        cedula: cedula.trim(),
        cargo: cargo.trim() || "—",
        rol,
        clave,
      },
    });
    setSaving(false);
    if (error) {
      // Supabase envuelve errores no-2xx en FunctionsHttpError con el body en context
      const msg =
        (data as { error?: string } | null)?.error ??
        error.message ??
        "No se pudo registrar el ingreso.";
      setError(msg);
      return;
    }
    if ((data as { error?: string } | null)?.error) {
      setError((data as { error: string }).error);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title="Registrar ingreso">
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Nombre completo" full>
          <ModalInput value={nombre} onChange={setNombre} />
        </ModalField>
        <ModalField label="ID de empleado">
          <ModalInput value={codigo} onChange={setCodigo} placeholder="Ej: 981702" />
        </ModalField>
        <ModalField label="Cédula">
          <ModalInput value={cedula} onChange={setCedula} />
        </ModalField>
        <ModalField label="Cargo" full>
          <ModalInput value={cargo} onChange={setCargo} placeholder="Ej: FULL-TIME" />
        </ModalField>
        <ModalField label="Rol" full>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as Rol)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            <option value="asesor">Asesor</option>
            <option value="jefatura">Jefatura</option>
          </select>
        </ModalField>
        <ModalField label="Clave inicial" full>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
            autoComplete="new-password"
          />
          <p className="text-[11.5px] text-muted mt-1">{hint}</p>
        </ModalField>
      </div>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {saving ? "Guardando…" : "Guardar ingreso"}
      </button>
    </Modal>
  );
}

function ModalField({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-xs text-muted uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function ModalInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
    />
  );
}
