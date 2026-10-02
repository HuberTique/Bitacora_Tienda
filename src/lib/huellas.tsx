"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

// Huella de reemplazo: lo que crea o cambia en esta tienda alguien que está de
// reemplazo (o esperando un traslado) queda registrado en la base. Aquí se lee
// para marcarlo en pantalla con un asterisco rojo.

export type Huella = {
  tabla: string;
  registro_id: string | null;
  accion: "creo" | "cambio" | "borro";
  persona_nombre: string;
  persona_codigo: string | null;
  tienda_origen: number | null;
  creado_at: string;
};

const VERBO: Record<Huella["accion"], string> = { creo: "Lo creó", cambio: "Lo modificó", borro: "Lo borró" };

/** Texto de la huella: "Lo creó Ana Pérez (CM 123), de reemplazo desde la tienda 690, el 02/10". */
export function describirHuella(h: Huella): string {
  const d = new Date(h.creado_at);
  const fecha = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return (
    `${VERBO[h.accion]} ${h.persona_nombre}` +
    (h.persona_codigo ? ` (CM ${h.persona_codigo})` : "") +
    `, de reemplazo` +
    (h.tienda_origen ? ` desde la tienda ${h.tienda_origen}` : "") +
    `, el ${fecha}`
  );
}

/** Agrupa las huellas por registro, de la más antigua a la más reciente. */
export function indexarHuellas(huellas: Huella[]): Map<string, Huella[]> {
  const mapa = new Map<string, Huella[]>();
  for (const h of [...huellas].sort((a, b) => a.creado_at.localeCompare(b.creado_at))) {
    if (!h.registro_id) continue;
    const k = `${h.tabla}:${h.registro_id}`;
    const lista = mapa.get(k);
    if (lista) lista.push(h);
    else mapa.set(k, [h]);
  }
  return mapa;
}

/**
 * Huellas de la tienda actual para una tabla. Devuelve una función que, dado
 * el id de un registro, entrega sus huellas (o undefined si no tiene).
 */
export function useHuellas(tabla: string): (id: string | null | undefined) => Huella[] | undefined {
  const [mapa, setMapa] = useState<Map<string, Huella[]>>(new Map());
  useEffect(() => {
    let vivo = true;
    supabase
      .from("huellas_reemplazo")
      .select("tabla, registro_id, accion, persona_nombre, persona_codigo, tienda_origen, creado_at")
      .eq("tabla", tabla)
      .order("creado_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        // Si la tabla aún no existe o la persona no puede leerla, queda vacío.
        if (vivo && data) setMapa(indexarHuellas(data as Huella[]));
      });
    return () => {
      vivo = false;
    };
  }, [tabla]);
  return useCallback((id) => (id ? mapa.get(`${tabla}:${id}`) : undefined), [mapa, tabla]);
}

/** Asterisco rojo: el registro lo creó o modificó alguien que estaba de reemplazo. */
export function MarcaReemplazo({ huellas }: { huellas: Huella[] | undefined }) {
  if (!huellas || huellas.length === 0) return null;
  const detalle = huellas.map(describirHuella).join("\n");
  return (
    <span
      className="text-red-600 font-bold text-base leading-none cursor-help"
      title={detalle}
      aria-label={`Gestionado por personal de reemplazo. ${detalle}`}
    >
      *
    </span>
  );
}
