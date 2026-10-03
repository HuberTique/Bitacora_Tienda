"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import type { RolJerarquico } from "@/lib/types";
import { Modal } from "../ui";
import { tiendaActualId } from "@/lib/planta";

type Fila = { persona_id: string; nombre: string; rol_jerarquico: RolJerarquico; unidades: number | null; trx: string };

const esMando = (r: RolJerarquico) => r === "jefe_tienda" || r === "subjefe";

/**
 * Transacciones (TRX) por persona, escritas a mano, para calcular el UPT
 * (unidades ÷ TRX). Cuando llegue un ejemplo del reporte de Xstore se podrá
 * leer automáticamente; esto queda como respaldo.
 */
export function TrxModal({
  anio,
  mes,
  subidoPor,
  onClose,
  onGuardado,
}: {
  anio: number;
  mes: number;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    tiendaActualId().then((tid) => Promise.all([
      supabase.from("personal").select("id, nombre, rol_jerarquico").eq("activo", true).eq("tienda_id", tid ?? "").order("nombre"),
      supabase.from("kpis_mensuales").select("persona_id, unidades, trx").eq("anio", anio).eq("mes", mes),
    ])).then(([p, k]) => {
      if (!vivo) return;
      const kp = new Map(((k.data as { persona_id: string; unidades: number | null; trx: number | null }[] | null) ?? []).map((x) => [x.persona_id, x]));
      const lista = ((p.data as { id: string; nombre: string; rol_jerarquico: RolJerarquico }[] | null) ?? []).map((x) => ({
        persona_id: x.id,
        nombre: x.nombre,
        rol_jerarquico: x.rol_jerarquico,
        unidades: kp.get(x.id)?.unidades ?? null,
        trx: kp.get(x.id)?.trx != null ? String(kp.get(x.id)!.trx) : "",
      }));
      // Equipo de ventas primero; jefe y subjefes al final.
      lista.sort((a, b) => Number(esMando(a.rol_jerarquico)) - Number(esMando(b.rol_jerarquico)) || a.nombre.localeCompare(b.nombre));
      setFilas(lista);
    });
    return () => {
      vivo = false;
    };
  }, [anio, mes]);

  const n = (s: string) => {
    const v = Number(s.replace(/[^0-9]/g, ""));
    return s.trim() && Number.isFinite(v) ? v : null;
  };

  async function guardar() {
    if (!filas) return;
    setError(null);
    const conTrx = filas.filter((f) => n(f.trx) != null);
    if (conTrx.length === 0) return setError("Escribe la TRX de al menos una persona.");
    setGuardando(true);
    const { error: e } = await supabase.from("kpis_mensuales").upsert(
      filas.map((f) => {
        const trx = n(f.trx);
        return {
          persona_id: f.persona_id,
          anio,
          mes,
          trx,
          upt: trx && trx > 0 && f.unidades != null ? Math.round((f.unidades / trx) * 100) / 100 : null,
          subido_por: subidoPor,
        };
      }),
      { onConflict: "persona_id,anio,mes" },
    );
    if (e) {
      setGuardando(false);
      return setError(e.message);
    }
    await supabase.from("cargas_datos").update({ vigente: false }).eq("anio", anio).eq("mes", mes).eq("tipo", "transacciones").eq("vigente", true);
    await supabase.from("cargas_datos").insert({
      anio,
      mes,
      tipo: "transacciones",
      origen: "manual",
      archivo: null,
      cargado_por: subidoPor,
      resumen: { personas: conTrx.length, total_trx: conTrx.reduce((a, f) => a + (n(f.trx) ?? 0), 0) },
    });
    setGuardando(false);
    onGuardado();
  }

  return (
    <Modal titulo={`Transacciones (TRX) — ${NOMBRES_MES[mes - 1]} ${anio}`} onClose={onClose} ancho="max-w-2xl">
      <p className="text-[12.5px] text-muted mb-3">
        Escribe las transacciones de cada persona en el mes (reporte de Xstore). Con las unidades de las ventas
        consolidadas se calcula el UPT.
      </p>
      {!filas ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : (
        <div className="bg-white border border-line rounded-md overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                <th className="px-3 py-2">Persona</th>
                <th className="px-2 py-2 text-right">Unidades</th>
                <th className="px-2 py-2 text-right">TRX</th>
                <th className="px-2 py-2 text-right">UPT</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const trx = n(f.trx);
                const upt = trx && trx > 0 && f.unidades != null ? (f.unidades / trx).toFixed(2) : "—";
                return (
                  <tr key={f.persona_id} className={"border-b border-line/60 last:border-0 " + (esMando(f.rol_jerarquico) ? "bg-paper/60" : "")}>
                    <td className="px-3 py-1.5">
                      {f.nombre}
                      {esMando(f.rol_jerarquico) && <span className="text-muted text-[11px]"> · no compite</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{f.unidades ?? "—"}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        inputMode="numeric"
                        value={f.trx}
                        onChange={(e) => setFilas((l) => l!.map((x, j) => (j === i ? { ...x, trx: e.target.value } : x)))}
                        className="w-20 px-2 py-1 border border-line rounded text-right font-mono bg-white"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{upt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || !filas}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar TRX y calcular UPT"}
      </button>
    </Modal>
  );
}
