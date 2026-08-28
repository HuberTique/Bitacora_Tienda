"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Ruta legacy — antes de tener /bitacora, los asesores caían aquí.
 * Ahora ambos roles usan /bitacora (que filtra vía RLS).
 */
export default function MisPendientesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/bitacora");
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center text-muted text-sm">
      Redirigiendo…
    </div>
  );
}
