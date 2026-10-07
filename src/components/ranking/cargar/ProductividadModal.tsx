"use client";

// Subir el informe "Productividad de empleado" de Xstore (PDF o foto): TRX y
// UPT de cada asesor del mes. Cada carga REEMPLAZA la TRX del mes; el UPT sale
// del mismo informe (columna Artículos de "Datos de media"). La jefatura revisa
// y corrige antes de guardar. Reglas de Huber, 7-oct-2026.

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import type { MesRetail } from "@/lib/mes-retail";
import { tiendaActualId } from "@/lib/planta";
import { ajustarRangoInforme } from "@/lib/ventas-pdf";
import { IDS_NO_PERSONA, leerProductividad, type InformeProductividad } from "@/lib/productividad";
import type { Persona } from "@/lib/types";
import { Modal } from "../ui";

type Fila = { id: string; nombre: string; trx: string; upt: string; ventas: number | null; personaId: string };

const soloDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(v) ? v : null;
};

export function ProductividadModal({
  anio,
  mes,
  mesInfo,
  subidoPor,
  onClose,
  onGuardado,
}: {
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState("");
  const [informe, setInforme] = useState<InformeProductividad | null>(null);
  const [planta, setPlanta] = useState<Persona[]>([]);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!fs.length) return;
    setError(null);
    setLeyendo(true);
    setInforme(null);
    try {
      const [inf, perRes, tid] = await Promise.all([
        leerProductividad(fs, (hechas, total) => setAvance({ hechas, total })),
        supabase.from("personal").select("*").order("nombre"),
        tiendaActualId(),
      ]);
      const pl = ((perRes.data as Persona[] | null) ?? []).filter((p) => !tid || p.tienda_id === tid);
      setPlanta(pl);
      setArchivo(fs.map((f) => f.name).join(", "));
      setInforme(inf);
      setFilas(
        inf.filas.map((f) => ({
          id: f.id,
          nombre: f.nombre,
          trx: f.trx != null ? String(f.trx) : "",
          upt: f.upt != null ? String(f.upt) : "",
          ventas: f.ventas,
          personaId: IDS_NO_PERSONA[f.id] ? "" : (pl.find((p) => soloDigitos(p.codigo) === f.id)?.id ?? ""),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLeyendo(false);
      setAvance(null);
    }
  }

  // Validaciones del informe.
  const { rango, invertido } = ajustarRangoInforme(informe?.rango ?? null, mesInfo?.inicio, mesInfo?.fin);
  const graves: string[] = [];
  const avisos: string[] = [];
  if (informe) {
    const t = (informe.titulo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (!t.includes("productividad")) graves.push(`El archivo no parece ser "Productividad de empleado" (título leído: ${informe.titulo ?? "ninguno"}).`);
    const codigo = soloDigitos(mesInfo?.tienda);
    if (codigo && informe.tienda && !soloDigitos(informe.tienda).includes(codigo))
      graves.push(`La tienda del informe (${informe.tienda}) no es la ${codigo}.`);
    if (!rango) avisos.push("No pude leer el rango de fechas del informe.");
    else if (mesInfo) {
      if (invertido) avisos.push(`Las fechas venían mes-día (${informe.rangoTexto}); se tomaron como ${rango[0]} a ${rango[1]}.`);
      if (rango[1] < mesInfo.inicio || rango[1] > mesInfo.fin)
        graves.push(`El rango del informe (${rango[0]} a ${rango[1]}) no es del mes ${mesInfo.inicio} a ${mesInfo.fin}.`);
      else if (rango[0] !== mesInfo.inicio)
        avisos.push(`El informe empieza el ${rango[0]} y el mes el ${mesInfo.inicio}: como reemplaza la TRX del mes, debería empezar el primer día.`);
    }
  }
  const asignadas = filas.filter((f) => f.personaId);
  const repetidas = asignadas.length !== new Set(asignadas.map((f) => f.personaId)).size;

  async function guardar() {
    if (graves.length && !confirmado) return setError("Hay advertencias graves: marca la casilla si aun así quieres guardar.");
    if (repetidas) return setError("Hay una persona asignada a más de una fila.");
    if (!asignadas.length) return setError("No hay filas asignadas a personas de la tienda.");
    if (asignadas.some((f) => num(f.trx) == null)) return setError("Falta la TRX de alguna persona asignada.");
    setGuardando(true);
    setError(null);
    // Reemplaza: primero se borra la TRX y el UPT del mes, luego se escribe lo del informe.
    const { error: e1 } = await supabase.from("kpis_mensuales").update({ trx: null, upt: null }).eq("anio", anio).eq("mes", mes);
    const { error: e2 } = e1
      ? { error: e1 }
      : await supabase.from("kpis_mensuales").upsert(
          asignadas.map((f) => ({ persona_id: f.personaId, anio, mes, trx: num(f.trx), upt: num(f.upt), subido_por: subidoPor })),
          { onConflict: "persona_id,anio,mes" },
        );
    if (e2) {
      setGuardando(false);
      return setError(e2.message);
    }
    await supabase.from("cargas_datos").update({ vigente: false }).eq("anio", anio).eq("mes", mes).eq("tipo", "transacciones").eq("vigente", true);
    await supabase.from("cargas_datos").insert({
      anio,
      mes,
      tipo: "transacciones",
      origen: "xstore",
      archivo,
      cargado_por: subidoPor,
      resumen: {
        desde: rango?.[0] ?? null,
        hasta: rango?.[1] ?? null,
        personas: asignadas.length,
        total_trx: asignadas.reduce((a, f) => a + (num(f.trx) ?? 0), 0),
      },
    });
    setGuardando(false);
    onGuardado();
  }

  const set = (i: number, c: Partial<Fila>) => setFilas((l) => l.map((x, k) => (k === i ? { ...x, ...c } : x)));
  const campo = "font-mono text-right border border-line rounded px-1.5 py-0.5 bg-white";

  return (
    <Modal titulo={`TRX y UPT desde Xstore — ${NOMBRES_MES[mes - 1]} ${anio}`} onClose={onClose} ancho="max-w-4xl">
      <p className="text-[12.5px] text-muted mb-3">
        Sube el informe <strong>&quot;Productividad de empleado&quot;</strong> (PDF o foto) desde el primer día del mes retail hasta la
        fecha. Reemplaza la TRX del mes de cada persona; el UPT es la columna <strong>Artículos</strong> de &quot;Datos de media&quot;.
        Revisa y corrige las cifras antes de guardar.
      </p>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={leyendo}
          className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
        >
          {informe ? "Elegir otro archivo" : "Elegir PDF o foto"}
        </button>
        <input ref={input} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={leer} />
        {leyendo && (
          <span className="text-sm text-muted">
            Leyendo con IA…{avance && avance.total > 1 ? ` (${avance.hechas} de ${avance.total} partes)` : ""}
          </span>
        )}
      </div>

      {informe && (
        <>
          <div className="text-[12.5px] mb-2">
            <strong>{informe.tienda ?? "Tienda no leída"}</strong>
            {rango ? ` · del ${rango[0]} al ${rango[1]}` : ""} · {informe.filas.length} filas
          </div>
          {graves.map((g) => (
            <div key={g} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs font-semibold">
              ⛔ {g}
            </div>
          ))}
          {graves.length > 0 && (
            <label className="mb-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              Entiendo las advertencias y quiero guardar de todos modos.
            </label>
          )}
          {avisos.map((a) => (
            <div key={a} className="mb-2 bg-ventas/10 text-ventas border border-ventas/30 rounded-md px-3 py-2 text-xs">
              ⚠ {a}
            </div>
          ))}
          <div className="overflow-x-auto border border-line rounded-md">
            <table className="w-full text-[12px]">
              <thead className="bg-paper text-left">
                <tr>
                  <th className="px-2 py-1.5">ID</th>
                  <th className="px-2 py-1.5">Nombre en el informe</th>
                  <th className="px-2 py-1.5 text-right">TRX</th>
                  <th className="px-2 py-1.5 text-right">UPT</th>
                  <th className="px-2 py-1.5 text-right">Ventas</th>
                  <th className="px-2 py-1.5">Persona</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.id}-${i}`} className="border-t border-line/60">
                    <td className="px-2 py-1.5 font-mono">{f.id}</td>
                    <td className="px-2 py-1.5">{f.nombre}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input value={f.trx} onChange={(e) => set(i, { trx: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={campo + " w-16"} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input value={f.upt} onChange={(e) => set(i, { upt: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo + " w-16"} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{f.ventas != null ? Math.round(f.ventas).toLocaleString("es-CO") : "—"}</td>
                    <td className="px-2 py-1.5">
                      {IDS_NO_PERSONA[f.id] ? (
                        <span className="text-muted">{IDS_NO_PERSONA[f.id]}</span>
                      ) : (
                        <select
                          value={f.personaId}
                          onChange={(e) => set(i, { personaId: e.target.value })}
                          className={"border rounded px-1 py-0.5 bg-white " + (f.personaId ? "border-line" : "border-warn text-warn")}
                        >
                          <option value="">— no importar —</option>
                          {planta.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.codigo ? `${p.codigo} — ` : ""}
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-muted mt-2">
            Se une con la planta por el ID (CM). La venta en línea y la cuenta de la tienda no se asignan a nadie.
          </p>
        </>
      )}

      {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}

      {informe && (
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
        >
          {guardando ? "Guardando…" : `Guardar TRX y UPT de ${asignadas.length} persona(s)`}
        </button>
      )}
    </Modal>
  );
}
