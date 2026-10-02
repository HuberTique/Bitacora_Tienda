"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fechaCorta, problemaClave, type Ambito } from "@/lib/ambito";
import { isoDe } from "@/lib/recurrentes";

const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm text-ink";
const etiqueta = "block text-[10.5px] text-muted uppercase tracking-wider mb-1";

/**
 * Franja bajo el encabezado: avisa cuando la persona está de reemplazo o
 * esperando un traslado (o cuando su solicitud aún no ha sido aceptada).
 */
export function BarraMovimiento({ ambito, onCambio }: { ambito: Ambito; onCambio: () => void }) {
  const m = ambito.movimiento;
  const [ocupado, setOcupado] = useState(false);
  if (!m) return null;

  async function terminar() {
    if (!m) return;
    const pregunta = m.estado === "solicitado"
      ? "¿Cancelar la solicitud?"
      : m.tipo === "traslado"
        ? "¿Cancelar el traslado y volver a tu tienda?"
        : "¿Terminar el reemplazo y volver a tu tienda?";
    if (!window.confirm(pregunta)) return;
    setOcupado(true);
    const { error } = await supabase.rpc("terminar_movimiento", { p_id: m.id });
    setOcupado(false);
    if (error) window.alert(error.message);
    else onCambio();
  }

  const tienda = `${m.destino.numero} · ${m.destino.nombre}`;
  const texto =
    m.estado === "solicitado"
      ? `Pediste entrar a la tienda ${tienda} por ${m.tipo}. Falta que su jefatura lo acepte; mientras tanto sigues en tu tienda.`
      : m.tipo === "reemplazo"
        ? `Estás de REEMPLAZO en la tienda ${tienda} hasta el ${fechaCorta(m.hasta)}. Lo que registres o cambies aquí queda marcado con tu nombre.`
        : `Estás en la tienda ${tienda} por TRASLADO. Pasas a su planta cuando tu tienda de origen confirme la baja; hasta entonces lo que registres queda marcado con tu nombre.`;

  return (
    <div
      className={
        "px-4 sm:px-7 py-2 text-[12.5px] flex items-center gap-3 flex-wrap border-b " +
        (m.estado === "solicitado"
          ? "bg-amber-50 text-[#8A5A16] border-amber-300"
          : "bg-warn-soft text-warn border-warn-border")
      }
    >
      <span className="flex-1 min-w-[200px]">{texto}</span>
      <button
        type="button"
        onClick={terminar}
        disabled={ocupado}
        className="px-2.5 py-1 rounded-md border border-current text-xs font-semibold disabled:opacity-50"
      >
        {m.estado === "solicitado" ? "Cancelar solicitud" : m.tipo === "traslado" ? "Cancelar traslado" : "Terminar reemplazo"}
      </button>
    </div>
  );
}

type TiendaOpcion = { id: string; numero: number; nombre: string; ciudad: string };

/** La persona pide entrar a otra tienda: reemplazo temporal o traslado. */
export function IrAOtraTiendaModal({ onClose, onPedido }: { onClose: () => void; onPedido: () => void }) {
  const [tiendas, setTiendas] = useState<TiendaOpcion[] | null>(null);
  const [tienda, setTienda] = useState("");
  const [tipo, setTipo] = useState<"reemplazo" | "traslado">("reemplazo");
  const [hasta, setHasta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const hoy = isoDe(new Date());

  useEffect(() => {
    supabase.rpc("tiendas_para_movimiento").then(({ data, error: e }) => {
      if (e) setError(e.message);
      setTiendas((data as TiendaOpcion[] | null) ?? []);
    });
  }, []);

  async function pedir() {
    setError(null);
    if (!tienda) return setError("Elige la tienda a la que llegas.");
    if (tipo === "reemplazo" && !hasta) return setError("Indica hasta qué día dura el reemplazo.");
    setEnviando(true);
    const { error: e } = await supabase.rpc("solicitar_movimiento", {
      p_tienda: tienda,
      p_tipo: tipo,
      p_hasta: tipo === "reemplazo" ? hasta : null,
      p_motivo: motivo.trim(),
    });
    setEnviando(false);
    if (e) return setError(e.message);
    onPedido();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-panel text-ink rounded-[10px] p-6 w-full max-w-md relative shadow-xl max-h-[90vh] overflow-y-auto"
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
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Voy a otra tienda</h3>
        <p className="text-muted text-[12.5px] mb-4">
          Úsalo cuando vayas a trabajar en una tienda que no es la tuya. La jefatura de esa tienda debe
          aceptar la solicitud; hasta entonces sigues viendo solo tu tienda.
        </p>

        <label className={etiqueta}>Tienda a la que llegas</label>
        <select value={tienda} onChange={(e) => setTienda(e.target.value)} className={campo}>
          <option value="">{tiendas === null ? "Cargando…" : tiendas.length === 0 ? "No hay otras tiendas registradas" : "— Elige —"}</option>
          {(tiendas ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.numero} · {t.nombre}
              {t.ciudad ? ` (${t.ciudad})` : ""}
            </option>
          ))}
        </select>

        <label className={etiqueta + " mt-3"}>¿A qué vas?</label>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="radio" checked={tipo === "reemplazo"} onChange={() => setTipo("reemplazo")} className="mt-1" />
            <span>
              <strong>Reemplazo temporal.</strong> Sigues siendo de tu tienda. Mientras dura ves solo la
              tienda que te recibe y lo que hagas allí queda marcado con tu nombre.
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="radio" checked={tipo === "traslado"} onChange={() => setTipo("traslado")} className="mt-1" />
            <span>
              <strong>Traslado.</strong> Quedas fijo en la otra tienda. Pasas a su planta cuando tu tienda
              de origen confirme la baja por traslado.
            </span>
          </label>
        </div>

        {tipo === "reemplazo" && (
          <>
            <label className={etiqueta + " mt-3"}>Hasta qué día</label>
            <input type="date" min={hoy} value={hasta} onChange={(e) => setHasta(e.target.value)} className={campo} />
          </>
        )}

        <label className={etiqueta + " mt-3"}>Motivo (opcional)</label>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={300}
          placeholder="Ej.: cubrir vacaciones del subjefe"
          className={campo}
        />

        {error && (
          <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={pedir}
          disabled={enviando}
          className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
        >
          {enviando ? "Enviando…" : "Enviar solicitud"}
        </button>
      </div>
    </div>
  );
}

/** Bloquea la app hasta que la persona reintegrada cambie su clave. */
export function CambioClaveObligatorio({ rol, onListo }: { rol: string; onListo: () => void }) {
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const esPin = rol === "asesor";

  async function guardar() {
    const problema = problemaClave(rol, clave, repetida);
    if (problema) return setError(problema);
    setError(null);
    setGuardando(true);
    const { error: e1 } = await supabase.auth.updateUser({ password: clave });
    if (e1) {
      setGuardando(false);
      return setError(e1.message);
    }
    const { error: e2 } = await supabase.rpc("confirmar_cambio_clave");
    setGuardando(false);
    if (e2) return setError(e2.message);
    onListo();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]">
      <div className="bg-panel text-ink rounded-[10px] p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-display font-semibold text-base mb-1">Cambia tu clave para continuar</h3>
        <p className="text-muted text-[12.5px] mb-4">
          Tu acceso fue reactivado. Por seguridad debes definir una clave nueva antes de usar la bitácora.
        </p>
        <label className={etiqueta}>{esPin ? "PIN nuevo (6 a 8 dígitos)" : "Clave nueva"}</label>
        <input
          type="password"
          inputMode={esPin ? "numeric" : undefined}
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className={campo}
          autoComplete="new-password"
        />
        <label className={etiqueta + " mt-3"}>Repítela</label>
        <input
          type="password"
          inputMode={esPin ? "numeric" : undefined}
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          className={campo}
          autoComplete="new-password"
        />
        {!esPin && <p className="text-[11.5px] text-muted mt-1.5">Mínimo 8 caracteres, con letras y números.</p>}
        {error && (
          <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar clave nueva"}
        </button>
      </div>
    </div>
  );
}
