"use client";

// Calendario de la semana: lo programado (horario de GeoVictoria) y lo que de
// verdad pasó cada día (novedades). Muestra el presupuesto de cada persona
// proyectado con las horas programadas y recalculado con las horas reales; la
// jefatura cierra la semana y queda el recalculado (se puede reabrir).
// Reglas en supabase/migrations/0043_novedades_semanas.sql.

import { useCallback, useEffect, useState } from "react";
import { useTienda } from "@/lib/tienda-config";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney } from "@/lib/types";
import { NOVEDADES, type Novedad } from "@/lib/presupuesto-semanal";
import {
  calcular,
  cargarDatosMes,
  cerrarSemana,
  guardarNovedad,
  horasDeFila,
  reabrirSemana,
  type Contexto,
  type DatosMes,
  type FilaHorario,
} from "@/lib/presupuesto-semanal-datos";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const hoyBogota = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const corta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const fechasDe = (inicio: string, fin: string) => {
  const out: string[] = [];
  const d = new Date(inicio + "T12:00:00Z");
  const f = new Date(fin + "T12:00:00Z");
  while (d <= f) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

function estiloNovedad(n: Novedad | null): string {
  if (!n) return "";
  if (n === "horas_extra") return "bg-operaciones/10 text-operaciones border-operaciones/40";
  return NOVEDADES[n].justificada ? "bg-brand/10 text-brand border-brand/40" : "bg-warn-soft text-warn border-warn-border";
}

export function CalendarioNovedades({ anio, mes, personaId }: { anio: number; mes: number; personaId: string }) {
  const tienda = useTienda();
  const ctx: Contexto = {
    factores: { jefe: tienda.factor_jefe ?? 0.25, subjefe: tienda.factor_subjefe ?? 1 / 3, cajero: tienda.factor_cajero ?? 0.5 },
    pctAccesorios: tienda.pct_accesorios ?? 8,
    pctRopa: tienda.pct_ropa ?? 4,
    vendeRopa: tienda.vende_ropa !== false,
  };
  const [datos, setDatos] = useState<DatosMes | null | undefined>(undefined);
  const [semana, setSemana] = useState(1);
  const [editando, setEditando] = useState<{ personaId: string; nombre: string; fecha: string; fila: FilaHorario | null } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const d = await cargarDatosMes(anio, mes);
      setDatos(d);
      if (d) {
        const hoy = hoyBogota();
        const actual = d.semanas.find((s) => s.inicio <= hoy && hoy <= s.fin);
        setSemana((n) => (n <= d.semanas.length && n !== 1 ? n : (actual?.numero ?? 1)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [anio, mes]);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  if (datos === undefined) return <div className="text-sm text-muted py-6 text-center">Cargando calendario…</div>;
  if (datos === null) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
        Para ver el calendario con el presupuesto, primero carga el presupuesto de {NOMBRES_MES[mes - 1]} {anio} en Presupuesto y
        ranking → Cargar datos.
      </div>
    );
  }

  const r = calcular(datos, ctx);
  const s = datos.semanas[semana - 1];
  const rs = r.semanas[semana - 1];
  const fechas = fechasDe(s.inicio, s.fin);
  const hoy = hoyBogota();
  const cerrada = !!s.cerrada;
  const puedeCerrar = !cerrada && hoy >= s.fin;
  const conNovedad = [...datos.horarios.values()].some((m) => fechas.some((f) => m.get(f)?.novedad));
  const orden = [...datos.personas].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const tot = rs.filas.reduce(
    (a, f) => ({ proy: a.proy + f.proyectada, rec: a.rec + f.recalculada, hp: a.hp + f.horasProgramadas, hr: a.hr + f.horasReales }),
    { proy: 0, rec: 0, hp: 0, hr: 0 },
  );

  async function cerrar() {
    const cambios = rs.filas.filter((f) => f.recalculada !== f.proyectada).length;
    if (
      !confirm(
        `¿Cerrar la semana ${s.numero} (${corta(s.inicio)} al ${corta(s.fin)})?\n\nEl presupuesto de la semana se recalcula con las horas reales` +
          (cambios ? `: cambia el de ${cambios} persona(s).` : ". No hay novedades que lo cambien.") +
          "\nSe puede reabrir si llega una novedad tarde.",
      )
    )
      return;
    await accion(() => cerrarSemana(datos!, s.numero, ctx, personaId));
  }

  async function reabrir() {
    if (!confirm(`¿Reabrir la semana ${s.numero}? Vuelve a regir el presupuesto proyectado hasta que la cierres de nuevo.`)) return;
    await accion(() => reabrirSemana(datos!, s.numero, ctx, personaId));
  }

  async function accion(fn: () => Promise<void>) {
    setTrabajando(true);
    setError(null);
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <div className="max-w-2xl">
          <h3 className="font-display font-semibold text-sm">Calendario y novedades — {datos.mes.nombre} {anio}</h3>
          <p className="text-muted text-[12px] mt-0.5">
            Arriba de cada día, lo programado (GeoVictoria); toca un día para registrar lo que de verdad pasó. El presupuesto de la
            semana se <strong>proyecta</strong> con las horas programadas y, al <strong>cerrar la semana</strong>, se recalcula con las
            reales: lo que alguien no cubrió por una incapacidad, vacaciones, licencia o calamidad pasa a los demás de esa semana; con
            una ausencia injustificada o retardo conserva su presupuesto.
          </p>
        </div>
      </div>

      {/* Semanas */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {datos.semanas.map((x) => (
          <button
            key={x.inicio}
            type="button"
            onClick={() => setSemana(x.numero)}
            className={
              "px-3 py-1.5 rounded-md border text-[12px] " +
              (x.numero === semana ? "bg-brand text-white border-brand font-semibold" : "bg-white border-line hover:bg-paper")
            }
          >
            Semana {x.numero} · {corta(x.inicio)}–{corta(x.fin)}
            <span className="ml-1.5 opacity-80">{x.cerrada ? "✓ cerrada" : x.fin < hoy ? "· por cerrar" : ""}</span>
          </button>
        ))}
      </div>

      {error && <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">{error}</div>}

      <div className="overflow-x-auto border border-line rounded-md">
        <table className="w-full text-[12px] border-collapse">
          <thead className="bg-paper">
            <tr>
              <th className="px-2 py-1.5 text-left sticky left-0 bg-paper min-w-[160px]">Persona</th>
              {fechas.map((f) => (
                <th key={f} className={"px-1.5 py-1.5 text-center min-w-[92px] " + (f === hoy ? "text-brand" : "")}>
                  {DIAS[new Date(f + "T12:00:00Z").getUTCDay()]} {f.slice(8, 10)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Horas prog.</th>
              <th className="px-2 py-1.5 text-right">Horas reales</th>
              <th className="px-2 py-1.5 text-right">Proyectado</th>
              <th className="px-2 py-1.5 text-right">{cerrada ? "Quedó" : "Recalculado"}</th>
            </tr>
          </thead>
          <tbody>
            {orden.map((p) => {
              const f = rs.filas.find((x) => x.persona_id === p.persona_id)!;
              const dif = (cerrada ? f.vigente : f.recalculada) - f.proyectada;
              return (
                <tr key={p.persona_id} className="border-t border-line/60">
                  <td className="px-2 py-1.5 sticky left-0 bg-panel">
                    <div className="truncate max-w-[180px]">{p.nombre}</div>
                  </td>
                  {fechas.map((fe) => {
                    const fila = datos.horarios.get(p.persona_id)?.get(fe) ?? null;
                    const h = fila ? horasDeFila(fila, p.rol_jerarquico) : null;
                    return (
                      <td key={fe} className="px-1 py-1 text-center align-top">
                        <button
                          type="button"
                          disabled={cerrada || trabajando}
                          onClick={() => setEditando({ personaId: p.persona_id, nombre: p.nombre, fecha: fe, fila })}
                          title={cerrada ? "Semana cerrada: reábrela para corregir" : "Registrar lo que pasó este día"}
                          className={
                            "w-full rounded border px-1 py-1 leading-tight " +
                            (fila?.novedad ? estiloNovedad(fila.novedad) : "border-transparent hover:border-line") +
                            (cerrada ? " cursor-default" : "")
                          }
                        >
                          {!fila ? (
                            <span className="text-muted/60">sin horario</span>
                          ) : fila.tipo === "trabajo" ? (
                            <>
                              <div>{fila.entrada && fila.salida ? `${fila.entrada.slice(0, 5)}–${fila.salida.slice(0, 5)}` : "Turno"}</div>
                              <div className="text-[10.5px] text-muted">{h!.programadas} h</div>
                            </>
                          ) : (
                            <span className="text-muted">{fila.tipo === "libre" ? (fila.notas ?? "Libre") : "Descanso"}</span>
                          )}
                          {fila?.novedad && (
                            <div className="text-[10px] font-semibold mt-0.5">
                              {NOVEDADES[fila.novedad].label}
                              {h && h.reales !== h.programadas ? ` · ${h.reales} h` : ""}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right font-mono">{f.horasProgramadas}</td>
                  <td className={"px-2 py-1.5 text-right font-mono " + (f.horasReales !== f.horasProgramadas ? "font-semibold" : "")}>{f.horasReales}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.proyectada)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <div className="font-semibold">{fmtMoney(cerrada ? f.vigente : f.recalculada)}</div>
                    {dif !== 0 && (
                      <div className={"text-[10.5px] " + (dif > 0 ? "text-operaciones" : "text-warn")}>
                        {dif > 0 ? "+" : ""}
                        {fmtMoney(dif)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-paper font-semibold">
              <td className="px-2 py-1.5 sticky left-0 bg-paper">Meta de la tienda</td>
              <td colSpan={fechas.length} className="px-2 py-1.5 text-[11.5px] text-muted font-normal">
                {fmtMoney(s.meta)} esta semana · lo que no se cubre por una novedad justificada se reparte, la meta no cambia
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{Math.round(tot.hp)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{Math.round(tot.hr)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(tot.proy)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(cerrada ? rs.filas.reduce((a, x) => a + x.vigente, 0) : tot.rec)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
        <div className="text-[12px] text-muted">
          {cerrada
            ? "Semana cerrada: rige el presupuesto recalculado con las horas reales."
            : puedeCerrar
              ? conNovedad
                ? "La semana terminó y tiene novedades: al cerrarla se recalcula el presupuesto."
                : "La semana terminó. Revisa si hubo novedades y ciérrala."
              : `Rige el presupuesto proyectado. Se cierra cuando termine la semana (${corta(s.fin)}).`}
        </div>
        {cerrada ? (
          <button
            type="button"
            onClick={reabrir}
            disabled={trabajando}
            className="px-3 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper disabled:opacity-50"
          >
            Reabrir semana
          </button>
        ) : (
          <button
            type="button"
            onClick={cerrar}
            disabled={!puedeCerrar || trabajando}
            title={puedeCerrar ? "" : "Se cierra cuando termine la semana"}
            className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
          >
            {trabajando ? "Guardando…" : "Cerrar semana y recalcular"}
          </button>
        )}
      </div>

      {editando && (
        <NovedadModal
          dato={editando}
          rol={datos.personas.find((p) => p.persona_id === editando.personaId)!.rol_jerarquico}
          onClose={() => setEditando(null)}
          onGuardar={async (novedad, horasReales, nota) => {
            await guardarNovedad({
              fila: editando.fila,
              personaId: editando.personaId,
              fecha: editando.fecha,
              novedad,
              horasReales,
              nota,
              por: personaId,
            });
            setEditando(null);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

function NovedadModal({
  dato,
  rol,
  onClose,
  onGuardar,
}: {
  dato: { nombre: string; fecha: string; fila: FilaHorario | null };
  rol: Parameters<typeof horasDeFila>[1];
  onClose: () => void;
  onGuardar: (novedad: Novedad | null, horasReales: number | null, nota: string) => Promise<void>;
}) {
  const prog = dato.fila ? horasDeFila(dato.fila, rol).programadas : 0;
  const [novedad, setNovedad] = useState<Novedad | "">(dato.fila?.novedad ?? "");
  const [horas, setHoras] = useState(String(dato.fila?.horas_reales ?? prog));
  const [nota, setNota] = useState(dato.fila?.novedad_nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function elegir(n: Novedad | "") {
    setNovedad(n);
    // Horas reales sugeridas: sin trabajar en las novedades de día completo.
    if (n === "incapacidad" || n === "vacaciones" || n === "licencia" || n === "calamidad" || n === "ausencia") setHoras("0");
    else if (n === "" ) setHoras(String(prog));
  }

  async function guardar() {
    const h = Number(horas.replace(",", "."));
    if (novedad && (!Number.isFinite(h) || h < 0 || h > 24)) return setError("Escribe las horas que de verdad trabajó (0 a 24).");
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(novedad || null, novedad ? h : null, nota);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  }

  const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-panel rounded-[10px] p-6 max-w-sm w-full shadow-xl relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none" aria-label="Cerrar">
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-1 pr-8">{dato.nombre}</h3>
        <p className="text-muted text-[12.5px] mb-4">
          {DIAS[new Date(dato.fecha + "T12:00:00Z").getUTCDay()]} {corta(dato.fecha)} · programado:{" "}
          {dato.fila ? (dato.fila.tipo === "trabajo" ? `${prog} h` : "descanso") : "sin horario"}
        </p>
        <label className="block text-xs text-muted uppercase tracking-wider mb-1">¿Qué pasó?</label>
        <select value={novedad} onChange={(e) => elegir(e.target.value as Novedad | "")} className={campo}>
          <option value="">Trabajó lo programado (sin novedad)</option>
          {(Object.keys(NOVEDADES) as Novedad[]).map((n) => (
            <option key={n} value={n}>
              {NOVEDADES[n].label}
            </option>
          ))}
        </select>
        {novedad && (
          <>
            <label className="block text-xs text-muted uppercase tracking-wider mb-1 mt-3">Horas que de verdad trabajó</label>
            <input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="decimal" className={campo} />
            <p className="text-[11.5px] text-muted mt-1">
              {NOVEDADES[novedad].justificada
                ? "Novedad justificada: al cerrar la semana, lo que no cubrió pasa a los demás."
                : "Injustificada: conserva su presupuesto; su cumplimiento lo refleja."}
            </p>
            <label className="block text-xs text-muted uppercase tracking-wider mb-1 mt-3">Nota (opcional)</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Incapacidad de 3 días por la EPS" maxLength={200} className={campo} />
          </>
        )}
        {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
