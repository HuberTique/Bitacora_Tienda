"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  MOTIVOS_BAJA,
  ROL_JERARQUICO_LABEL,
  type MotivoBaja,
  type Persona,
  type PersonalCodigoAlterno,
  type Rol,
  type RolJerarquico,
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
                <Th>Nivel</Th>
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
                  <td className="py-3 pr-3 text-xs">
                    {ROL_JERARQUICO_LABEL[p.rol_jerarquico]}
                  </td>
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
                  <td colSpan={8} className="py-8 text-center text-muted">
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
  const [rolJerarquico, setRolJerarquico] = useState<RolJerarquico>(
    persona.rol_jerarquico,
  );
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
        rol_jerarquico: rolJerarquico,
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
        <ModalField label="Cargo (texto libre)" full>
          <ModalInput value={cargo} onChange={setCargo} placeholder="Ej: FULL-TIME TEMPORAL" />
        </ModalField>
        <ModalField label="Rol jerárquico (usado en horarios)" full>
          <select
            value={rolJerarquico}
            onChange={(e) => setRolJerarquico(e.target.value as RolJerarquico)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            <option value="jefe_tienda">Jefe de tienda (nivel 5)</option>
            <option value="subjefe">Subjefe (nivel 4)</option>
            <option value="cajero">Cajero (nivel 4)</option>
            <option value="full_time">Full-time (nivel 3)</option>
            <option value="part_time">Part-time (nivel 2)</option>
          </select>
        </ModalField>
        <ModalField label="Rol de acceso" full>
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

      <div className="mt-5 pt-4 border-t border-line">
        <CodigosAlternosSection persona={persona} />
      </div>
    </Modal>
  );
}

// ---------- Sección Códigos alternos ----------

function CodigosAlternosSection({ persona }: { persona: Persona }) {
  const [codigos, setCodigos] = useState<PersonalCodigoAlterno[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({
    codigo: "",
    distribucion_pct: 100,
    motivo: "",
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("personal_codigos_alternos")
      .select("*")
      .eq("persona_id", persona.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (!error) setCodigos((data as PersonalCodigoAlterno[] | null) ?? []);
  }, [persona.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function agregar() {
    setSaveError(null);
    const cod = nuevo.codigo.trim();
    if (!cod) {
      setSaveError("El código no puede quedar vacío.");
      return;
    }
    const pct = nuevo.distribucion_pct / 100;
    if (pct <= 0 || pct > 1) {
      setSaveError("La distribución debe ser entre 1% y 100%.");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("personal_codigos_alternos").insert({
      persona_id: persona.id,
      codigo: cod,
      distribucion_pct: pct,
      motivo: nuevo.motivo.trim() || null,
      estado: "aprobado",
      aprobado_at: new Date().toISOString(),
    });
    setCreating(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setNuevo({ codigo: "", distribucion_pct: 100, motivo: "" });
    load();
  }

  async function quitar(id: string) {
    if (!confirm("¿Eliminar este código alterno?")) return;
    const { error } = await supabase.from("personal_codigos_alternos").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  return (
    <div>
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
        Códigos alternos
        <span
          className="text-[10px] font-normal text-muted normal-case tracking-normal"
          title="Códigos temporales (DSM, jefe, subjefe) que esta persona usa mientras le llega el suyo. Al leer el PDF de ventas, la venta de este código se suma automáticamente."
        >
          (por qué)
        </span>
      </h4>
      <p className="text-[11.5px] text-muted mb-3">
        Cuando un asesor usa un código que no es el suyo (típicamente DSM o
        Jefe mientras le asignan el propio), agrégalo acá. Si varios asesores
        comparten el mismo código, define el porcentaje que le corresponde a
        cada uno — la venta del código se distribuye automáticamente.
      </p>

      {loading ? (
        <div className="text-muted text-xs py-2">Cargando…</div>
      ) : codigos.length === 0 ? (
        <div className="text-muted text-xs italic mb-3">
          Sin códigos alternos registrados.
        </div>
      ) : (
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="border-b border-line text-left text-muted uppercase tracking-wider">
              <th className="pb-1 pr-2 font-semibold">Código</th>
              <th className="pb-1 pr-2 font-semibold text-right">Distrib.</th>
              <th className="pb-1 pr-2 font-semibold">Motivo</th>
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {codigos.map((c) => (
              <tr key={c.id} className="border-b border-line/60 last:border-0">
                <td className="py-1.5 pr-2 font-mono">{c.codigo}</td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {Math.round(c.distribucion_pct * 100)}%
                </td>
                <td className="py-1.5 pr-2 text-[11px]">{c.motivo ?? "—"}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => quitar(c.id)}
                    className="text-warn hover:underline text-[11px]"
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="bg-paper border border-line rounded-md p-3">
        <div className="text-[11px] font-semibold mb-2 uppercase tracking-wider text-muted">
          Añadir código alterno
        </div>
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-2">
            <label className="block text-[10px] text-muted mb-0.5">Código</label>
            <input
              type="text"
              value={nuevo.codigo}
              onChange={(e) => setNuevo((n) => ({ ...n, codigo: e.target.value }))}
              placeholder="981001"
              className="w-full px-2 py-1 border border-line rounded text-xs bg-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-0.5">
              % Distribución
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={nuevo.distribucion_pct}
              onChange={(e) =>
                setNuevo((n) => ({
                  ...n,
                  distribucion_pct: parseInt(e.target.value, 10) || 100,
                }))
              }
              className="w-full px-2 py-1 border border-line rounded text-xs bg-white font-mono"
            />
          </div>
          <div className="col-span-3">
            <label className="block text-[10px] text-muted mb-0.5">Motivo (opcional)</label>
            <input
              type="text"
              value={nuevo.motivo}
              onChange={(e) => setNuevo((n) => ({ ...n, motivo: e.target.value }))}
              placeholder="Código de DSM mientras llega el propio"
              className="w-full px-2 py-1 border border-line rounded text-xs bg-white"
            />
          </div>
        </div>
        {saveError && (
          <div className="mt-2 bg-warn-soft text-warn border border-warn-border rounded px-2 py-1 text-[11px]">
            {saveError}
          </div>
        )}
        <button
          type="button"
          onClick={agregar}
          disabled={creating}
          className="mt-2 w-full py-1.5 bg-operaciones text-white rounded text-xs font-semibold disabled:opacity-50"
        >
          {creating ? "Guardando…" : "Añadir código"}
        </button>
      </div>
    </div>
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
  const [rolJerarquico, setRolJerarquico] = useState<RolJerarquico>("full_time");
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
        rol_jerarquico: rolJerarquico,
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
        <ModalField label="Cargo (texto libre)" full>
          <ModalInput value={cargo} onChange={setCargo} placeholder="Ej: FULL-TIME TEMPORAL" />
        </ModalField>
        <ModalField label="Rol jerárquico (usado en horarios)" full>
          <select
            value={rolJerarquico}
            onChange={(e) => setRolJerarquico(e.target.value as RolJerarquico)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            <option value="jefe_tienda">Jefe de tienda (nivel 5)</option>
            <option value="subjefe">Subjefe (nivel 4)</option>
            <option value="cajero">Cajero (nivel 4)</option>
            <option value="full_time">Full-time (nivel 3)</option>
            <option value="part_time">Part-time (nivel 2)</option>
          </select>
        </ModalField>
        <ModalField label="Rol de acceso" full>
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
