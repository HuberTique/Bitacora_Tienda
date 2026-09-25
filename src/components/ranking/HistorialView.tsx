"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import type { FilaRanking, HistorialRanking } from "@/lib/ranking";
import { Avatar } from "./ui";

const MEDALLA = ["🥇", "🥈", "🥉"];

/**
 * Historial de podios: foto fija del ranking al cerrar cada mes. Muestra
 * quién ganó cada mes y cuántas veces ha sido "Gran maestro".
 */
export function HistorialView({
  historial,
  filasActuales,
  anio,
  mes,
  fotos,
  esJefatura,
  onGuardado,
}: {
  historial: HistorialRanking[];
  filasActuales: FilaRanking[];
  anio: number;
  mes: number;
  fotos: Record<string, string>;
  esJefatura: boolean;
  onGuardado: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const meses = useMemo(() => {
    const m = new Map<string, HistorialRanking[]>();
    historial.forEach((h) => {
      const k = `${h.anio}-${String(h.mes).padStart(2, "0")}`;
      m.set(k, [...(m.get(k) ?? []), h]);
    });
    return [...m.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([k, filas]) => ({ k, anio: filas[0].anio, mes: filas[0].mes, filas: filas.sort((a, b) => a.puesto - b.puesto) }));
  }, [historial]);

  const maestros = useMemo(() => {
    const c = new Map<string, { nombre: string; id: string; veces: number }>();
    historial
      .filter((h) => h.puesto === 1)
      .forEach((h) => {
        const a = c.get(h.persona_id) ?? { nombre: h.nombre, id: h.persona_id, veces: 0 };
        a.veces += 1;
        c.set(h.persona_id, a);
      });
    return [...c.values()].sort((a, b) => b.veces - a.veces);
  }, [historial]);

  const yaCerrado = historial.some((h) => h.anio === anio && h.mes === mes);
  const conPuntaje = filasActuales.filter((f) => f.puntaje != null);

  async function cerrarMes() {
    if (conPuntaje.length === 0) {
      setMsg("Aún no hay puntajes este mes.");
      return;
    }
    if (
      yaCerrado &&
      !confirm(`${NOMBRES_MES[mes - 1]} ${anio} ya está cerrado. ¿Reemplazar el podio guardado con el ranking actual?`)
    )
      return;
    setGuardando(true);
    setMsg(null);
    const rows = conPuntaje.map((f, i) => ({
      anio,
      mes,
      persona_id: f.persona.id,
      nombre: f.persona.nombre,
      puesto: i + 1,
      puntaje: f.puntaje,
    }));
    const { error } = await supabase
      .from("ranking_historial")
      .upsert(rows, { onConflict: "anio,mes,persona_id" });
    setGuardando(false);
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    setMsg("✓ Mes cerrado: el podio quedó guardado en el historial.");
    onGuardado();
  }

  return (
    <div className="space-y-4">
      {esJefatura && (
        <div className="bg-panel border border-line rounded-[10px] p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12.5px] text-muted flex-1 min-w-[240px]">
            Al terminar el mes, ciérralo para guardar el podio en el historial. También alimenta el
            bonus de constancia de los meses siguientes.
          </p>
          <button
            type="button"
            onClick={cerrarMes}
            disabled={guardando}
            className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
          >
            {guardando
              ? "Guardando…"
              : `${yaCerrado ? "Actualizar" : "Cerrar"} ${NOMBRES_MES[mes - 1]} ${anio}`}
          </button>
          {msg && <span className="text-xs w-full">{msg}</span>}
        </div>
      )}

      {maestros.length > 0 && (
        <div className="bg-panel border-2 border-[#E0A526]/70 rounded-[12px] p-4">
          <h4 className="font-display font-bold text-[17px] m-0 mb-2">Gran maestro del mes</h4>
          <div className="flex flex-wrap gap-3">
            {maestros.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-white border border-line rounded-lg px-3 py-2">
                <Avatar nombre={m.nombre} url={fotos[m.id]} tam={36} anillo="oro" />
                <div>
                  <div className="text-[13px] font-semibold">{m.nombre}</div>
                  <div className="text-[11px] text-muted">
                    {m.veces} {m.veces === 1 ? "vez" : "veces"} en el primer puesto
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {meses.length === 0 ? (
        <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
          Aún no hay meses cerrados.
        </div>
      ) : (
        meses.map((m) => (
          <div key={m.k} className="bg-panel border border-line rounded-[10px] p-4">
            <h4 className="text-sm font-semibold mb-2 capitalize">
              {NOMBRES_MES[m.mes - 1]} {m.anio}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {m.filas.slice(0, 3).map((h, i) => (
                <div key={h.id} className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 bg-white">
                  <span className="text-xl" aria-hidden>
                    {MEDALLA[i]}
                  </span>
                  <Avatar nombre={h.nombre} url={fotos[h.persona_id]} tam={34} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{h.nombre}</div>
                    <div className="text-[11px] text-muted">{Math.round(Number(h.puntaje))} pts</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
