"use client";

import { supabase } from "./supabase";

/**
 * Tienda en la que está parada la sesión. Hace falta para listar la planta:
 * los permisos dejan ver además la PROPIA fila, y quien está de reemplazo o es
 * administrador dentro de otra tienda aparecería en una planta que no es la suya.
 */
export async function tiendaActualId(): Promise<string | null> {
  const { data } = await supabase.rpc("current_tienda_id");
  return (data as string | null) ?? null;
}
