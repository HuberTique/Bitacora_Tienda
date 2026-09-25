"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Nombre y ciudad de la tienda: viven en la tabla `tienda_config` (editable
// desde Personal → Datos de la tienda). Estos valores son el respaldo
// mientras carga o si la tabla aún no existe.
export const NOMBRE_TIENDA = "Outlet de las Américas";
export const CIUDAD_TIENDA = "Bogotá, Colombia";

export type Tienda = { nombre: string; ciudad: string };

const DEFAULT: Tienda = { nombre: NOMBRE_TIENDA, ciudad: CIUDAD_TIENDA };

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
    supabase.from("tienda_config").select("nombre, ciudad").maybeSingle(),
  ).then(({ data }) => {
    const d = data as Tienda | null;
    if (d?.nombre) setTiendaCache({ nombre: d.nombre, ciudad: d.ciudad || CIUDAD_TIENDA });
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
