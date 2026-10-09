"use client";

// Subir el horario descargado de GeoVictoria (semanal o mensual). Pasos:
//   1. Se lee el PDF y se une cada persona con la planta por su cédula.
//   2. Quien no está en la planta se puede registrar, validándolo uno a uno
//      (CM y rol), con claves temporales como en "Cargar planta".
//   3. Se muestra cómo cambia el presupuesto de cada persona (antes/después).
//   4. Al confirmar: se guardan los turnos (reemplazan esos días) y se aplica
//      el nuevo reparto desde hoy; lo pasado queda congelado.

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTienda } from "@/lib/tienda-config";
import { tiendaActualId } from "@/lib/planta";
import { downloadBlob } from "@/lib/pdfs";
import { diasEntre } from "@/lib/mes-retail";
import { claveTemporal, excelClaves } from "@/lib/planta-excel";
import { leerHorarioGeoVictoria } from "@/lib/geovictoria-pdf";
import { rolDesdeCargoGeo, type FilaGeo, type HorarioGeo } from "@/lib/geovictoria";
import {
  aplicarEfecto,
  calcularEfecto,
  emparejar,
  guardarHorarios,
  hoyBogota,
  registrarCarga,
  type EfectoMes,
  type Emparejamiento,
} from "@/lib/geovictoria-carga";
import { fmtMoney, rolDeAcceso, ROL_JERARQUICO_LABEL, type Persona, type RolJerarquico } from "@/lib/types";

type Modo = "semanal" | "mensual";
type Nueva = { fila: FilaGeo; incluir: boolean; codigo: string; rol: RolJerarquico; nombre: string };
type Creado = { nombre: string; usuario: string; clave: string; rol: string };

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const corta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function mensajeDeFuncion(error: unknown, data: unknown): Promise<string> {
  const d = (data as { error?: string } | null)?.error;
  if (d) return d;
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* no era JSON */
    }
  }
  return error instanceof Error ? error.message : "No se pudo crear.";
}

export function SubirGeoVictoriaModal({
  subidoPor,
  onClose,
  onGuardado,
}: {
  subidoPor: string;
  onClose: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const tienda = useTienda();
  const input = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<Modo>("semanal");
  const [archivo, setArchivo] = useState("");
  const [horario, setHorario] = useState<HorarioGeo | null>(null);
  const [emp, setEmp] = useState<Emparejamiento | null>(null);
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  const [creados, setCreados] = useState<Creado[]>([]);
  const [efectos, setEfectos] = useState<EfectoMes[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctx = {
    factores: { jefe: tienda.factor_jefe ?? 0.25, subjefe: tienda.factor_subjefe ?? 1 / 3, cajero: tienda.factor_cajero ?? 0.5 },
    pctAccesorios: tienda.pct_accesorios ?? 8,
    pctRopa: tienda.pct_ropa ?? 4,
    vendeRopa: tienda.vende_ropa !== false,
  };

  async function cargarPlanta(): Promise<Persona[]> {
    const [{ data, error: e }, tid] = await Promise.all([supabase.from("personal").select("*").order("nombre"), tiendaActualId()]);
    if (e) throw new Error(e.message);
    return ((data as Persona[] | null) ?? []).filter((p) => !tid || p.tienda_id === tid);
  }

  async function preparar(h: HorarioGeo) {
    const pl = await cargarPlanta();
    const em = emparejar(h, pl);
    setEmp(em);
    setEfectos(await calcularEfecto(h, em.emparejadas, ctx));
    return em;
  }

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setHorario(null);
    setEmp(null);
    setEfectos(null);
    setCreados([]);
    setTrabajando("Leyendo el horario…");
    try {
      if (!/\.pdf$/i.test(f.name)) throw new Error("Por ahora se lee el PDF de GeoVictoria. Descárgalo en PDF.");
      const h = await leerHorarioGeoVictoria(await f.arrayBuffer());
      setArchivo(f.name);
      setHorario(h);
      const em = await preparar(h);
      setNuevas(
        em.nuevas.map((fila) => ({
          fila,
          incluir: false,
          codigo: "",
          rol: rolDesdeCargoGeo(fila.cargo),
          nombre: fila.nombre,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrabajando(null);
    }
  }

  async function registrarNuevas() {
    if (!horario) return;
    const elegidas = nuevas.filter((n) => n.incluir);
    const malas = elegidas.filter((n) => !/^\d{4,10}$/.test(n.codigo.trim()) || n.rol === "jefe_tienda" || n.rol === "subjefe");
    if (malas.length) {
      setError("Revisa las personas marcadas: cada una necesita su ID de empleado (CM) y un rol de asesor, cajero, full time o part time.");
      return;
    }
    if (!confirm(`Vas a registrar ${elegidas.length} persona(s) en ${tienda.nombre}. ¿Continuar?`)) return;
    setError(null);
    setTrabajando("Registrando personas…");
    const ok: Creado[] = [];
    const mal: string[] = [];
    for (const n of elegidas) {
      const clave = claveTemporal(n.rol);
      const { data, error: e } = await supabase.functions.invoke("crear-persona", {
        body: {
          nombre: n.nombre.trim(),
          codigo: n.codigo.trim(),
          cedula: n.fila.cedula,
          cargo: n.fila.cargo || ROL_JERARQUICO_LABEL[n.rol],
          rol: rolDeAcceso(n.rol),
          rol_jerarquico: n.rol,
          correo: null,
          clave,
        },
      });
      if (e || (data as { error?: string } | null)?.error) mal.push(`${n.nombre}: ${await mensajeDeFuncion(e, data)}`);
      else ok.push({ nombre: n.nombre, usuario: n.codigo.trim(), clave, rol: ROL_JERARQUICO_LABEL[n.rol] });
    }
    setCreados((c) => [...c, ...ok]);
    try {
      const em = await preparar(horario);
      setNuevas((l) => l.filter((n) => em.nuevas.some((f) => f.cedula === n.fila.cedula)));
    } catch (err) {
      mal.push(err instanceof Error ? err.message : String(err));
    }
    if (mal.length) setError(mal.join(" · "));
    setTrabajando(null);
  }

  async function guardar() {
    if (!horario || !emp) return;
    if (emp.emparejadas.length === 0) {
      setError("Nadie del archivo está en la planta de esta tienda.");
      return;
    }
    if (creados.length > 0 && !confirm("¿Ya descargaste los accesos de las personas registradas? Las claves no se vuelven a mostrar.")) return;
    setError(null);
    setTrabajando("Guardando…");
    try {
      // Se recalcula justo antes de guardar, con lo que haya en ese momento.
      const ef = await calcularEfecto(horario, emp.emparejadas, ctx);
      const turnos = await guardarHorarios(horario, emp.emparejadas);
      for (const m of ef) await aplicarEfecto(m, ctx, subidoPor);
      await registrarCarga(horario, archivo, modo, emp.emparejadas.length, subidoPor);
      const recalculados = ef.map((m) => m.nombre);
      onGuardado(
        `✓ Horario de GeoVictoria guardado: ${turnos} turnos de ${emp.emparejadas.length} personas, del ${corta(horario.desde)} al ${corta(horario.hasta)}.` +
          (recalculados.length ? ` Presupuesto recalculado: ${recalculados.join(", ")}.` : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTrabajando(null);
    }
  }

  // ---------- Avisos ----------
  const avisos: string[] = [];
  if (horario) {
    const dias = (new Date(horario.hasta + "T12:00:00Z").getTime() - new Date(horario.desde + "T12:00:00Z").getTime()) / 86400000 + 1;
    if (modo === "semanal" && dias !== 7) avisos.push(`El archivo es de ${dias} días y elegiste semanal.`);
    if (modo === "mensual" && dias < 28) avisos.push(`El archivo es de ${dias} días y elegiste mensual.`);
    if (horario.grupo && tienda.nombre && !norm(horario.grupo).includes(norm(tienda.nombre))) {
      avisos.push(`El archivo es de "${horario.grupo}" y estás en ${tienda.nombre}. Verifica que sea la tienda correcta.`);
    }
    if (horario.hasta < hoyBogota()) avisos.push("Este horario ya pasó: se guarda, pero el presupuesto de días pasados no cambia.");
    avisos.push(...horario.avisos);
    for (const i of emp?.inactivas ?? []) avisos.push(`${i.persona.nombre} está dada de baja: su horario no se guarda.`);
  }

  const fechas = horario ? diasEntre(horario.desde, horario.hasta).map((d) => d.fecha) : [];
  const conDias = fechas.length > 0 && fechas.length <= 7;
  const etiqueta = "block text-xs text-muted uppercase tracking-wider mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-3 z-50">
      <div className="bg-panel rounded-[10px] p-5 w-full max-w-5xl relative shadow-xl max-h-[calc(100vh-1.5rem)] overflow-y-auto">
        <button type="button" onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none" aria-label="Cerrar">
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Subir horario de GeoVictoria</h3>
        <p className="text-muted text-[12.5px] mb-4 max-w-3xl">
          Descarga el horario en PDF desde GeoVictoria. La app toma las horas de cada día (sin el almuerzo), reemplaza esos días
          en Horarios y proyecta el presupuesto de cada semana con ese horario; las semanas ya cerradas no cambian. Antes de
          guardar ves cómo cambia el presupuesto de cada persona.
        </p>

        <div className="flex gap-3 flex-wrap items-end mb-4">
          <div>
            <span className={etiqueta}>Horario</span>
            <div className="inline-flex rounded-md border border-line overflow-hidden text-sm">
              {(["semanal", "mensual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={"px-3 py-2 " + (modo === m ? "bg-brand text-white font-semibold" : "bg-white text-ink hover:bg-paper")}
                >
                  {m === "semanal" ? "Semanal" : "Mensual"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!trabajando}
            className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
          >
            {horario ? "Elegir otro PDF" : "Elegir PDF de GeoVictoria"}
          </button>
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={leer} />
          {trabajando && <span className="text-sm text-muted">{trabajando}</span>}
        </div>

        {error && <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">{error}</div>}

        {horario && emp && (
          <>
            <div className="text-sm mb-2">
              <strong>{horario.grupo ?? "Horario"}</strong> · del {corta(horario.desde)} al {corta(horario.hasta)} ·{" "}
              {horario.filas.length} personas en el archivo · {emp.emparejadas.length} en la planta
            </div>
            {avisos.length > 0 && (
              <ul className="mb-3 bg-ventas/10 text-ventas border border-ventas/30 rounded-md px-3 py-2 text-[12.5px] list-disc pl-6">
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}

            {/* Turnos leídos */}
            <div className="overflow-x-auto border border-line rounded-md mb-4">
              <table className="w-full text-[12px]">
                <thead className="bg-paper text-left">
                  <tr>
                    <th className="px-2 py-1.5">Persona</th>
                    <th className="px-2 py-1.5">Cédula</th>
                    {conDias &&
                      fechas.map((f) => (
                        <th key={f} className="px-2 py-1.5 text-center whitespace-nowrap">
                          {DIAS[new Date(f + "T12:00:00Z").getUTCDay()]} {f.slice(8, 10)}
                        </th>
                      ))}
                    {!conDias && <th className="px-2 py-1.5 text-right">Días con turno</th>}
                    <th className="px-2 py-1.5 text-right">Horas</th>
                    <th className="px-2 py-1.5">En la app</th>
                  </tr>
                </thead>
                <tbody>
                  {horario.filas.map((f) => {
                    const en = emp.emparejadas.find((e) => e.fila === f);
                    const baja = emp.inactivas.find((e) => e.fila === f);
                    return (
                      <tr key={f.cedula} className="border-t border-line/60">
                        <td className="px-2 py-1.5">
                          {f.nombre}
                          <div className="text-[10.5px] text-muted">{f.cargo}</div>
                        </td>
                        <td className="px-2 py-1.5 font-mono">{f.cedula}</td>
                        {conDias &&
                          fechas.map((fe) => {
                            const t = f.turnos.find((x) => x.fecha === fe);
                            return (
                              <td key={fe} className="px-2 py-1.5 text-center whitespace-nowrap">
                                {!t ? "" : t.tipo === "trabajo" ? (
                                  <>
                                    {t.entrada}–{t.salida}
                                    <div className="text-[10.5px] text-muted">{t.horas} h</div>
                                  </>
                                ) : (
                                  <span className="text-muted">{t.tipo === "descanso" ? "Descanso" : (t.nota ?? "Libre")}</span>
                                )}
                              </td>
                            );
                          })}
                        {!conDias && <td className="px-2 py-1.5 text-right">{f.turnos.filter((t) => t.tipo === "trabajo").length}</td>}
                        <td className="px-2 py-1.5 text-right font-semibold">{f.totalCalculado} h</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {en ? (
                            <span className="text-operaciones">✓ {en.persona.nombre.split(" ")[0]}</span>
                          ) : baja ? (
                            <span className="text-warn">Dada de baja</span>
                          ) : (
                            <span className="text-ventas font-semibold">No está en la planta</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Personas nuevas */}
            {nuevas.length > 0 && (
              <div className="border border-ventas/40 rounded-md p-3 mb-4">
                <div className="font-semibold text-sm mb-1">No están en la planta de {tienda.nombre}</div>
                <p className="text-[12px] text-muted mb-2">
                  Marca a quién registrar y escribe su ID de empleado (CM): con él entra a la app. Se crea con una clave temporal
                  que debe cambiar al entrar. Jefes y subjefes se registran desde Personal (necesitan correo). Quien no registres,
                  no se guarda.
                </p>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {nuevas.map((n, i) => {
                      const set = (c: Partial<Nueva>) => setNuevas((l) => l.map((x, k) => (k === i ? { ...x, ...c } : x)));
                      const mando = n.rol === "jefe_tienda" || n.rol === "subjefe";
                      return (
                        <tr key={n.fila.cedula} className="border-t border-line/60">
                          <td className="py-1.5 pr-2">
                            <input type="checkbox" checked={n.incluir} disabled={mando} onChange={(e) => set({ incluir: e.target.checked })} />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input value={n.nombre} onChange={(e) => set({ nombre: e.target.value })} className="w-full px-2 py-1 border border-line rounded bg-white" />
                            <div className="text-[10.5px] text-muted">
                              Cédula {n.fila.cedula} · {n.fila.cargo}
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 w-32">
                            <input
                              value={n.codigo}
                              onChange={(e) => set({ codigo: e.target.value.replace(/\D/g, "") })}
                              placeholder="ID (CM)"
                              inputMode="numeric"
                              className="w-full px-2 py-1 border border-line rounded bg-white font-mono"
                            />
                          </td>
                          <td className="py-1.5 w-40">
                            <select value={n.rol} onChange={(e) => set({ rol: e.target.value as RolJerarquico })} className="w-full px-2 py-1 border border-line rounded bg-white">
                              {(["cajero", "full_time", "part_time", "subjefe", "jefe_tienda"] as RolJerarquico[]).map((r) => (
                                <option key={r} value={r}>
                                  {ROL_JERARQUICO_LABEL[r]}
                                </option>
                              ))}
                            </select>
                            {mando && <div className="text-[10.5px] text-ventas">Regístralo desde Personal.</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={registrarNuevas}
                  disabled={!!trabajando || !nuevas.some((n) => n.incluir)}
                  className="mt-2 px-3 py-1.5 rounded-md border border-brand text-brand bg-white text-sm font-semibold hover:bg-brand/5 disabled:opacity-50"
                >
                  Registrar marcadas
                </button>
              </div>
            )}
            {creados.length > 0 && (
              <div className="mb-4 bg-emerald-50 text-operaciones border border-emerald-200 rounded-md px-3 py-2 text-[12.5px] flex items-center gap-3 flex-wrap">
                Se registraron {creados.length} persona(s). Descarga sus accesos ahora: las claves temporales no se vuelven a mostrar.
                <button
                  type="button"
                  onClick={async () => downloadBlob(await excelClaves(creados, tienda.nombre), `Accesos_${tienda.nombre.replace(/\s+/g, "_")}.xlsx`)}
                  className="px-3 py-1 rounded-md bg-operaciones text-white text-xs font-semibold"
                >
                  ⬇ Descargar accesos (Excel)
                </button>
              </div>
            )}

            {/* Efecto en el presupuesto */}
            <div className="mb-4">
              <div className="font-semibold text-sm mb-1">Cómo cambia el presupuesto</div>
              {efectos && efectos.length === 0 && (
                <p className="text-[12.5px] text-muted">
                  No hay presupuesto cargado para estas fechas: el horario se guarda y se usará cuando cargues el presupuesto.
                </p>
              )}
              {efectos?.map((m) => (
                <div key={`${m.anio}-${m.mes}`} className="mb-3">
                  <div className="text-[12.5px] text-muted mb-1">
                    {m.nombre} {m.anio}
                    {" · presupuesto proyectado por semana con este horario; las semanas ya cerradas no cambian"}
                  </div>
                  <div className="overflow-x-auto border border-line rounded-md">
                    <table className="w-full text-[12px]">
                      <thead className="bg-paper text-left">
                        <tr>
                          <th className="px-2 py-1.5">Persona</th>
                          <th className="px-2 py-1.5 text-right">Horas del mes</th>
                          <th className="px-2 py-1.5 text-right">Antes</th>
                          <th className="px-2 py-1.5 text-right">Después</th>
                          <th className="px-2 py-1.5 text-right">Cambio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...m.filas]
                          .sort((a, b) => b.presupuesto - a.presupuesto)
                          .map((f) => {
                            const dif = f.presupuesto - f.presupuestoAntes;
                            return (
                              <tr key={f.persona_id} className="border-t border-line/60">
                                <td className="px-2 py-1.5">
                                  {f.nombre}
                                  {f.manual && <span className="text-[10.5px] text-muted"> · fijado a mano</span>}
                                </td>
                                <td className="px-2 py-1.5 text-right">{Math.round(f.horas)} h</td>
                                <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.presupuestoAntes)}</td>
                                <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmtMoney(f.presupuesto)}</td>
                                <td className={"px-2 py-1.5 text-right font-mono " + (dif > 0 ? "text-operaciones" : dif < 0 ? "text-warn" : "text-muted")}>
                                  {dif === 0 ? "—" : (dif > 0 ? "+" : "") + fmtMoney(dif)}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper">
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardar}
                disabled={!!trabajando || emp.emparejadas.length === 0}
                className="px-4 py-2 rounded-md bg-operaciones text-white text-sm font-semibold hover:bg-operaciones/90 disabled:opacity-50"
              >
                Guardar horario{efectos?.length ? " y aplicar el reparto" : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
