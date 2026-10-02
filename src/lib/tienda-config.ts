"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { normalizarFormato, type FormatoTienda } from "./magia";

// Nombre, ciudad y formato de la tienda: viven en la tabla `tienda_config`
// (editable desde Personal → Datos de la tienda). Estos valores son el respaldo
// mientras carga o si la tabla aún no existe.
export const NOMBRE_TIENDA = "Outlet de las Américas";
export const CIUDAD_TIENDA = "Bogotá, Colombia";

// `formato` (Concept u Outlet) define, por ahora, qué plantilla de "Magia con
// una sonrisa" se usa; otras dinámicas que varíen por formato leen de aquí.
export type Tienda = { nombre: string; ciudad: string; formato: FormatoTienda };

const DEFAULT: Tienda = { nombre: NOMBRE_TIENDA, ciudad: CIUDAD_TIENDA, formato: "concept" };

// Caché de módulo: se comparte entre login, header y PDFs sin repetir consultas.
let cache: Tienda = DEFAULT;
let pendiente: Promise<Tienda> | null = null;
const oyentes = new Set<(t: Tienda) => void>();

export function nombreTiendaActual(): string {
  return cache.nombre;
}

export function cargarTienda(forzar = false): Promise<Tienda> {
  if (pendiente && !forzar) return pendiente;
  pendiente = Promise.resolve(
    supabase.from("tienda_config").select("nombre, ciudad, formato").maybeSingle(),
  ).then(({ data }) => {
    const d = data as { nombre?: string; ciudad?: string; formato?: string } | null;
    if (d?.nombre) {
      setTiendaCache({
        nombre: d.nombre,
        ciudad: d.ciudad || CIUDAD_TIENDA,
        formato: normalizarFormato(d.formato),
      });
    }
    return cache;
  });
  return pendiente;
}

export function setTiendaCache(t: Tienda) {
  cache = t;
  oyentes.forEach((f) => f(t));
}

export function useTienda(): Tienda {
  const [t, setT] = useState<Tienda>(cache);
  useEffect(() => {
    oyentes.add(setT);
    cargarTienda();
    return () => {
      oyentes.delete(setT);
    };
  }, []);
  return t;
}
