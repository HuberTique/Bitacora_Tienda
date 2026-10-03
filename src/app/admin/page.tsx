"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CIUDADES_COLOMBIA } from "@/lib/ciudades-colombia";
import { FORMATOS_TIENDA, labelFormato, type FormatoTienda } from "@/lib/magia";

type TiendaResumen = {
  id: string;
  numero: number;
  nombre: string;
  ciudad: string;
  formato: FormatoTienda;
  vende_ropa: boolean;
  activa: boolean;
  distrito_id: string;
  distrito_numero: number;
  personas: number;
  jefaturas: number;
  jefes: string | null;
};
type Distrito = { id: string; numero: number; nombre: string };

const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm";
const etiqueta = "block text-xs text-muted uppercase tracking-wider mb-1";

async function mensajeDeFuncion(error: unknown, data: unknown): Promise<string> {
  const d = (data as { error?: string } | null)?.error;
  if (d) return d;
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* la respuesta no era JSON */
    }
  }
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

/**
 * Administración (solo el administrador): crear tiendas y distritos, registrar
 * al jefe de cada tienda y entrar a cualquier tienda para validar lo que ven.
 * El jefe de tienda carga y aprueba su propia planta desde Personal.
 */
export default function AdminPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();
  const [tiendas, setTiendas] = useState<TiendaResumen[]>([]);
  const [distritos, setDistritos] = useState<Distrito[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<TiendaResumen | "nueva" | null>(null);
  const [jefePara, setJefePara] = useState<TiendaResumen | null>(null);
  const [nuevoDistrito, setNuevoDistrito] = useState(false);

  const cargar = useCallback(async () => {
    const [t, d] = await Promise.all([
      supabase.rpc("admin_resumen_tiendas"),
      supabase.from("distritos").select("id, numero, nombre").order("numero"),
    ]);
    if (t.error) return setError(t.error.message);
    setTiendas((t.data as TiendaResumen[] | null) ?? []);
    setDistritos((d.data as Distrito[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona && !persona.es_admin) return router.replace("/bitacora");
    if (persona?.es_admin) cargar();
  }, [loading, session, persona, router, cargar]);

  async function entrar(t: TiendaResumen) {
    const { error: e } = await supabase.rpc("entrar_tienda", { p_tienda: t.id });
    if (e) return setError(e.message);
    // Todo lo que hay en pantalla depende de la tienda: se recarga la app.
    window.location.assign(window.location.pathname.replace(/\/admin\/?$/, "/bitacora/"));
  }

  if (loading || !persona || !persona.es_admin) {
    return <div className="min-h-screen flex items-center justify-center text-muted text-sm">Cargando…</div>;
  }

  const porDistrito = distritos.map((d) => ({ d, lista: tiendas.filter((t) => t.distrito_id === d.id) }));

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-7 w-full">
        <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-[22px] font-display font-bold m-0">Administración</h2>
            <p className="text-muted text-[13px] max-w-2xl">
              Tiendas y distritos. Al crear una tienda registras a su jefe; él carga y aprueba su planta desde
              Personal. Con «Entrar» ves la tienda como la ven ellos.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setNuevoDistrito(true)}
              className="px-3 py-2 rounded-md border border-line bg-white text-sm font-semibold hover:bg-paper"
            >
              Nuevo distrito
            </button>
            <button
              type="button"
              onClick={() => setEditando("nueva")}
              className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light"
            >
              + Nueva tienda
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-4">{error}</div>
        )}

        <div className="space-y-5">
          {porDistrito.map(({ d, lista }) => (
            <div key={d.id}>
              <div className="text-[12px] text-muted font-semibold uppercase tracking-wider mb-2">
                {d.nombre || `Distrito ${d.numero}`} · {lista.length} tienda{lista.length === 1 ? "" : "s"}
              </div>
              {lista.length === 0 ? (
                <div className="bg-panel border border-line rounded-[10px] p-4 text-[13px] text-muted">
                  Sin tiendas todavía.
                </div>
              ) : (
                <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[760px]">
                    <thead>
                      <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                        <th className="px-3 py-2">Tienda</th>
                        <th className="px-2 py-2">Formato</th>
                        <th className="px-2 py-2">Jefe de tienda</th>
                        <th className="px-2 py-2 text-center">Personas</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((t) => (
                        <tr key={t.id} className={"border-b border-line/60 last:border-0 " + (t.activa ? "" : "opacity-50")}>
                          <td className="px-3 py-2">
                            <strong>{t.numero}</strong> · {t.nombre}
                            <div className="text-[11.5px] text-muted">
                              {t.ciudad || "—"}
                              {!t.activa && " · inactiva"}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-[12.5px]">
                            {labelFormato(t.formato)} · {t.vende_ropa ? "con ropa" : "sin ropa"}
                          </td>
                          <td className="px-2 py-2 text-[12.5px]">
                            {t.jefes ?? <span className="text-warn">Sin jefe registrado</span>}
                          </td>
                          <td className="px-2 py-2 text-center font-mono">{t.personas}</td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setJefePara(t)}
                              className="text-brand text-xs font-semibold hover:underline mr-3"
                            >
                              Registrar jefe
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditando(t)}
                              className="text-brand text-xs font-semibold hover:underline mr-3"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => entrar(t)}
                              className="px-2.5 py-1 rounded-md border border-brand text-brand text-xs font-semibold hover:bg-brand/5"
                            >
                              Entrar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {editando && (
        <TiendaModal
          tienda={editando === "nueva" ? null : editando}
          distritos={distritos}
          onClose={() => setEditando(null)}
          onGuardada={(nueva) => {
            setEditando(null);
            cargar().then(() => {
              // Recién creada: el siguiente paso es registrar a su jefe.
              if (nueva) setJefePara(nueva);
            });
          }}
        />
      )}
      {jefePara && (
        <JefeModal
          tienda={jefePara}
          onClose={() => setJefePara(null)}
          onCreado={() => {
            setJefePara(null);
            cargar();
          }}
        />
      )}
      {nuevoDistrito && (
        <DistritoModal
          onClose={() => setNuevoDistrito(false)}
          onGuardado={() => {
            setNuevoDistrito(false);
            cargar();
          }}
        />
      )}
    </AppShell>
  );
}

function Ventana({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-panel text-ink rounded-[10px] p-6 w-full max-w-lg relative shadow-xl max-h-[90vh] overflow-y-auto"
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
        <h3 className="font-display font-semibold text-base mb-3 pr-8">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function TiendaModal({
  tienda,
  distritos,
  onClose,
  onGuardada,
}: {
  tienda: TiendaResumen | null;
  distritos: Distrito[];
  onClose: () => void;
  onGuardada: (nueva: TiendaResumen | null) => void;
}) {
  const [numero, setNumero] = useState(tienda ? String(tienda.numero) : "");
  const [nombre, setNombre] = useState(tienda?.nombre ?? "");
  const [ciudad, setCiudad] = useState(tienda?.ciudad ?? "");
  const [formato, setFormato] = useState<FormatoTienda>(tienda?.formato ?? "concept");
  const [distrito, setDistrito] = useState(tienda?.distrito_id ?? distritos[0]?.id ?? "");
  const [vendeRopa, setVendeRopa] = useState(tienda?.vende_ropa ?? true);
  const [activa, setActiva] = useState(tienda?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    const n = parseInt(numero, 10);
    if (!n || n <= 0) return setError("Escribe el número de la tienda.");
    if (!nombre.trim()) return setError("Escribe el nombre de la tienda.");
    if (!distrito) return setError("Elige el distrito.");
    setGuardando(true);
    const { data, error: e } = await supabase.rpc("admin_guardar_tienda", {
      p_id: tienda?.id ?? null,
      p_numero: n,
      p_nombre: nombre.trim(),
      p_ciudad: ciudad.trim(),
      p_formato: formato,
      p_distrito: distrito,
      p_vende_ropa: vendeRopa,
      p_activa: activa,
    });
    setGuardando(false);
    if (e) return setError(e.message);
    const d = distritos.find((x) => x.id === distrito);
    onGuardada(
      tienda
        ? null
        : {
            id: data as string,
            numero: n,
            nombre: nombre.trim(),
            ciudad: ciudad.trim(),
            formato,
            vende_ropa: vendeRopa,
            activa,
            distrito_id: distrito,
            distrito_numero: d?.numero ?? 0,
            personas: 0,
            jefaturas: 0,
            jefes: null,
          },
    );
  }

  return (
    <Ventana titulo={tienda ? `Editar tienda ${tienda.numero}` : "Nueva tienda"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={etiqueta}>Número</label>
          <input inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className={campo} placeholder="Ej: 691" />
        </div>
        <div>
          <label className={etiqueta}>Distrito</label>
          <select value={distrito} onChange={(e) => setDistrito(e.target.value)} className={campo}>
            {distritos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre || `Distrito ${d.numero}`}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className={etiqueta}>Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} placeholder="Ej: CENTRO MAYOR" />
        </div>
        <div className="col-span-2">
          <label className={etiqueta}>Ciudad</label>
          <input list="ciudades-admin" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className={campo} placeholder="Escribe para buscar" />
          <datalist id="ciudades-admin">
            {CIUDADES_COLOMBIA.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="col-span-2">
          <label className={etiqueta}>Formato</label>
          <div className="flex gap-2 max-w-xs">
            {FORMATOS_TIENDA.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormato(f.id)}
                className={
                  "flex-1 py-2 border rounded-md text-sm font-medium transition-colors " +
                  (formato === f.id ? "bg-brand text-white border-brand" : "bg-white border-line hover:bg-paper")
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-[13px] cursor-pointer">
          <input type="checkbox" checked={vendeRopa} onChange={(e) => setVendeRopa(e.target.checked)} />
          Vende ropa
        </label>
        {tienda && (
          <label className="col-span-2 flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            Tienda activa (si la desactivas, deja de aparecer para elegirla)
          </label>
        )}
      </div>
      <p className="text-[11.5px] text-muted mt-3">
        La mezcla del presupuesto por categoría la define después el jefe en Personal → Datos de la tienda. La tienda
        arranca con los parámetros de horarios y ranking por defecto de la compañía.
      </p>
      {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
      >
        {guardando ? "Guardando…" : tienda ? "Guardar cambios" : "Crear tienda y registrar a su jefe →"}
      </button>
    </Ventana>
  );
}

function JefeModal({ tienda, onClose, onCreado }: { tienda: TiendaResumen; onClose: () => void; onCreado: () => void }) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cedula, setCedula] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    setError(null);
    if (!nombre.trim()) return setError("Escribe el nombre del jefe de tienda.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) return setError("Escribe el correo con el que va a ingresar.");
    if (!(clave.length >= 8 && /[A-Za-z]/.test(clave) && /[0-9]/.test(clave))) {
      return setError("La clave temporal debe tener mínimo 8 caracteres, con letras y números.");
    }
    setGuardando(true);
    const { data, error: e } = await supabase.functions.invoke("crear-persona", {
      body: {
        tienda_id: tienda.id,
        nombre: nombre.trim(),
        codigo: codigo.trim() || null,
        cedula: cedula.trim(),
        cargo: "Jefe de tienda",
        rol: "jefatura",
        rol_jerarquico: "jefe_tienda",
        correo: correo.trim().toLowerCase(),
        clave,
      },
    });
    setGuardando(false);
    if (e || (data as { error?: string } | null)?.error) return setError(await mensajeDeFuncion(e, data));
    setOk(`Listo. ${nombre.trim()} entra con ${correo.trim().toLowerCase()} y la clave temporal; la app le pedirá cambiarla.`);
  }

  return (
    <Ventana titulo={`Jefe de tienda — ${tienda.numero} · ${tienda.nombre}`} onClose={onClose}>
      {ok ? (
        <>
          <div className="bg-emerald-50 text-operaciones border border-emerald-200 rounded-md px-3 py-2 text-[13px]">{ok}</div>
          <p className="text-[12.5px] text-muted mt-3">
            Envíale el enlace de la app, su correo y la clave temporal por un canal seguro. Al entrar verá su tienda vacía
            y desde Personal cargará su planta.
          </p>
          <button type="button" onClick={onCreado} className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm">
            Listo
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={etiqueta}>Nombre completo</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>ID de empleado (CM)</label>
              <input inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Cédula</label>
              <input value={cedula} onChange={(e) => setCedula(e.target.value)} className={campo} />
            </div>
            <div className="col-span-2">
              <label className={etiqueta}>Correo de ingreso</label>
              <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className={campo} autoComplete="off" />
            </div>
            <div className="col-span-2">
              <label className={etiqueta}>Clave temporal</label>
              <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className={campo} autoComplete="new-password" />
              <p className="text-[11.5px] text-muted mt-1">Mínimo 8 caracteres, con letras y números. Se cambia en el primer ingreso.</p>
            </div>
          </div>
          {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
          <button
            type="button"
            onClick={crear}
            disabled={guardando}
            className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
          >
            {guardando ? "Registrando…" : "Registrar jefe de tienda"}
          </button>
        </>
      )}
    </Ventana>
  );
}

function DistritoModal({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [numero, setNumero] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    const n = parseInt(numero, 10);
    if (!n || n <= 0) return setError("Escribe el número del distrito.");
    const { error: e } = await supabase.rpc("admin_guardar_distrito", { p_numero: n, p_nombre: nombre.trim() });
    if (e) return setError(e.message);
    onGuardado();
  }

  return (
    <Ventana titulo="Nuevo distrito" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={etiqueta}>Número</label>
          <input inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Nombre (opcional)</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} placeholder="Distrito 72" />
        </div>
      </div>
      {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
      <button type="button" onClick={guardar} className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm">
        Guardar distrito
      </button>
    </Ventana>
  );
}
