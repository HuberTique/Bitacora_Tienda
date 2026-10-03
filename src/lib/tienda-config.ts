"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { normalizarFormato, type FormatoTienda } from "./magia";

// Nombre, ciudad y formato de la tienda en la que está parada la sesión: viven
// en la tabla `tiendas` y llegan con mi_ambito() (editable desde Personal →
// Datos de la tienda). Estos valores son el respaldo mientras carga o cuando
// todavía no hay sesión (pantalla de ingreso).
export const NOMBRE_TIENDA = "Digital Logbook";
export const CIUDAD_TIENDA = "Bogotá, Colombia";

// `formato` (Concept u Outlet) define, por ahora, qué plantilla de "Magia con
// una sonrisa" se usa; otras dinámicas que varíen por formato leen de aquí.
export type Tienda = {
  id?: string;
  numero?: number;
  nombre: string;
  ciudad: string;
  formato: FormatoTienda;
  /** Algunas tiendas no venden ropa: no llevan metas ni columnas de ropa. */
  vende_ropa?: boolean;
  /** Mezcla fija por categoría (%), para pasar el presupuesto a unidades. */
  mezcla_calzado?: number | null;
  mezcla_accesorios?: number | null;
  mezcla_ropa?: number | null;
};

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
  pendiente = Promise.resolve(supabase.rpc("mi_ambito")).then(({ data }) => {
    const d = (
      data as {
        tienda?: {
          id?: string;
          numero?: number;
          nombre?: string;
          ciudad?: string;
          formato?: string;
          vende_ropa?: boolean;
          mezcla_calzado?: number | null;
          mezcla_accesorios?: number | null;
          mezcla_ropa?: number | null;
        } | null;
      } | null
    )?.tienda;
    if (d?.nombre) {
      setTiendaCache({
        id: d.id,
        numero: d.numero,
        nombre: d.nombre,
        ciudad: d.ciudad || CIUDAD_TIENDA,
        formato: normalizarFormato(d.formato),
        vende_ropa: d.vende_ropa ?? true,
        mezcla_calzado: d.mezcla_calzado ?? null,
        mezcla_accesorios: d.mezcla_accesorios ?? null,
        mezcla_ropa: d.mezcla_ropa ?? null,
      });
    } else {
      // Sin sesión (o sin tienda elegida) no hay nada que guardar: se deja
      // libre para volver a consultar cuando la persona ya haya ingresado.
      pendiente = null;
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
