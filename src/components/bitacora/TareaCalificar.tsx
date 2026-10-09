"use client";

// Tarea automática del sistema (Huber, 8-oct-2026): del día 1 al 5 de cada mes la
// jefatura califica Puntualidad, Trabajo en equipo e Iniciativa del mes anterior
// para el mejor vendedor. Después del día 5 queda vencida hasta que se haga. No es
// una tarea recurrente: aparece sola en todas las tiendas.

import { useEffect, useState } from "react";
import Link from "next/link";
import { NOMBRES_MES } from "@/lib/horarios";
import { cargarTareaCalificacion, type TareaCalificacion } from "@/lib/calificaciones";

export function TareaCalificar() {
  const [tarea, setTarea] = useState<TareaCalificacion | null>(null);
  useEffect(() => {
    let vivo = true;
    cargarTareaCalificacion().then((t) => {
      if (vivo) setTarea(t);
    });
    return () => {
      vivo = false;
    };
  }, []);
  if (!tarea) return null;
  const vencida = tarea.estado === "vencida";
  return (
    <div
      className={
        "bg-panel border border-line rounded-lg p-3.5 border-l-4 mb-4 flex items-center gap-3 flex-wrap " +
        (vencida ? "border-l-warn" : "border-l-[#E0A526]")
      }
    >
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold text-sm">
          🏅 Calificaciones para mejor vendedor · {NOMBRES_MES[tarea.mes - 1]} {tarea.anio}
        </div>
        <div className="text-[12.5px] text-muted mt-0.5">
          Puntualidad, Trabajo en equipo e Iniciativa (faltan {tarea.faltan}). Cada una suma al ranking del mes.
        </div>
      </div>
      <span
        className={
          "text-[11.5px] font-semibold px-2 py-0.5 rounded-full " +
          (vencida ? "bg-warn-soft text-warn" : "bg-amber-50 text-[#8A5A16] border border-amber-300")
        }
      >
        {vencida ? `Vencida hace ${tarea.diasDeAtraso} día(s)` : tarea.diasRestantes === 1 ? "Vence hoy" : `Vence el ${tarea.vence}`}
      </span>
      <Link
        href="/ranking?calificar=1"
        className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light"
      >
        Calificar
      </Link>
    </div>
  );
}
