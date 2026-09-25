"use client";

import { AppShell } from "./AppShell";
import type { Persona } from "@/lib/types";

/**
 * Envuelve el contenido en el AppShell (encabezado y navegación) salvo que la
 * pantalla se muestre embebida como pestaña dentro de otra (p. ej. Presupuestos
 * y Mi presupuesto dentro de "Presupuesto y ranking").
 */
export function ShellCond({
  embedded,
  persona,
  children,
}: {
  embedded?: boolean;
  persona: Persona;
  children: React.ReactNode;
}) {
  if (embedded) return <>{children}</>;
  return <AppShell persona={persona}>{children}</AppShell>;
}
