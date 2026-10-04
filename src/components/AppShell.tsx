"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NotificationBell } from "./NotificationBell";
import { useTienda } from "@/lib/tienda-config";
import { fechaCorta, useAmbito } from "@/lib/ambito";
import {
  BarraMovimiento,
  CambioClaveObligatorio,
  IrAOtraTiendaModal,
} from "./movimientos/MovimientoPropio";
import { ConsentimientoObligatorio } from "./Consentimiento";
import { ENCARGO_LABEL, type Persona } from "@/lib/types";

type Tab = { href: string; label: string; roles: ("jefatura" | "asesor")[] };

const TABS: Tab[] = [
  { href: "/bitacora", label: "Bitácora", roles: ["jefatura", "asesor"] },
  { href: "/feedbacks", label: "Feedbacks", roles: ["jefatura"] },
  { href: "/horarios", label: "Horarios", roles: ["jefatura"] },
  { href: "/requerimientos", label: "Requerimientos", roles: ["jefatura", "asesor"] },
  { href: "/ranking", label: "Presupuesto y ranking", roles: ["asesor", "jefatura"] },
  { href: "/asistente", label: "Asistente", roles: ["asesor"] },
  { href: "/personal", label: "Personal", roles: ["jefatura"] },
];

export function AppShell({
  persona,
  children,
}: {
  persona: Persona;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tienda = useTienda();
  // Reemplazos y traslados: en qué tienda está parada la sesión y si tiene un
  // movimiento abierto.
  const { ambito, recargar: recargarAmbito } = useAmbito();
  const [pidiendoTienda, setPidiendoTienda] = useState(false);
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    setOscuro(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);
  // Tareas recurrentes de la Bitácora: al abrir la app (en cualquier módulo) y
  // cada 10 minutos mientras siga abierta se crean los pendientes que tocan
  // hoy y se mandan los recordatorios de las que tenían hora. La función es
  // idempotente: llamarla de más no duplica nada.
  useEffect(() => {
    const generar = () => {
      supabase.rpc("generar_pendientes_recurrentes").then(() => undefined);
    };
    generar();
    const cada = setInterval(generar, 10 * 60 * 1000);
    return () => clearInterval(cada);
  }, []);

  function alternarTema() {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    if (nuevo) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("tema", nuevo ? "dark" : "light");
    } catch {
      /* sin almacenamiento: el cambio vale solo para esta sesión */
    }
  }

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  const visibleTabs = [
    ...TABS.filter((t) => t.roles.includes(persona.rol)),
    // Solo el administrador: crear tiendas, registrar jefes, entrar a una tienda.
    ...(persona.es_admin ? [{ href: "/admin", label: "Administración", roles: [] }] : []),
  ];
  // El administrador está viendo una tienda que no es la suya (y no por un reemplazo).
  const enOtraTienda =
    !!ambito?.es_admin && !ambito.movimiento && !!ambito.tienda && ambito.tienda.id !== ambito.tienda_propia?.id;

  async function volverAMiTienda() {
    await supabase.rpc("entrar_tienda", { p_tienda: null });
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="bg-brand text-white flex flex-wrap items-center gap-x-3 sm:gap-x-6 px-4 sm:px-7 2xl:h-[60px] shrink-0">
        <div className="flex items-center gap-2.5 pr-4 sm:pr-5 border-r border-white/15 h-[60px] shrink-0 mr-auto 2xl:mr-0">
          <div>
            <h1 className="text-base m-0 text-white font-display font-semibold leading-tight">
              Digital Logbook
            </h1>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">
              {tienda.nombre}
            </div>
          </div>
        </div>

        {/* Las pestañas van en la misma fila del logo solo en pantallas muy anchas; si no, en una fila propia de ancho completo. */}
        <nav className="flex items-center h-[46px] 2xl:h-[60px] order-last 2xl:order-none w-[calc(100%+2rem)] sm:w-[calc(100%+3.5rem)] 2xl:w-auto 2xl:flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-2 sm:-mx-7 sm:px-5 2xl:mx-0 2xl:px-0 border-t border-white/10 2xl:border-0">
          {visibleTabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  "flex items-center px-3 xl:px-4 h-[46px] 2xl:h-[60px] text-[13.5px] font-medium border-b-[3px] whitespace-nowrap transition-colors " +
                  (active
                    ? "text-white border-white bg-white/8"
                    : "text-white/75 border-transparent hover:bg-white/6 hover:text-white")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <NotificationBell />
        <button
          type="button"
          onClick={alternarTema}
          title="Cambiar entre tema claro y oscuro"
          aria-label="Cambiar tema"
          className="text-base px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
        >
          {oscuro ? "☀️" : "🌙"}
        </button>

        {/* El administrador usa "Entrar" desde Administración; este botón es para el personal. */}
        {ambito && !ambito.movimiento && ambito.rol !== "dsm" && !ambito.es_admin && (
          <button
            type="button"
            onClick={() => setPidiendoTienda(true)}
            title="Pedir un reemplazo temporal o un traslado a otra tienda"
            className="text-xs px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
          >
            Voy a otra tienda
          </button>
        )}

        <div className="hidden sm:block text-[13px] text-white/70 truncate max-w-[180px]">
          {persona.nombre}
          <span className="text-white/50">
            {" "}
            · {persona.rol === "jefatura" ? "Jefatura" : "Asesor"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-xs px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
        >
          Cerrar sesión
        </button>
      </header>
      {ambito && <BarraMovimiento ambito={ambito} onCambio={recargarAmbito} />}
      {persona.encargo && (
        <div className="px-4 sm:px-7 py-2 text-[12.5px] border-b bg-ventas/10 text-ventas border-ventas/30">
          Estás como <strong>{ENCARGO_LABEL[persona.encargo.cargo].toLowerCase()}</strong> hasta el{" "}
          <strong>{fechaCorta(persona.encargo.hasta)}</strong>: tienes acceso de jefatura y lo que hagas queda
          marcado como hecho en el encargo.
        </div>
      )}
      {enOtraTienda && (
        <div className="px-4 sm:px-7 py-2 text-[12.5px] flex items-center gap-3 flex-wrap border-b bg-brand/10 text-brand border-brand/30">
          <span className="flex-1 min-w-[200px]">
            Estás viendo la tienda <strong>{ambito?.tienda?.numero} · {ambito?.tienda?.nombre}</strong> como
            administrador. Lo que hagas aquí queda en esa tienda.
          </span>
          <button
            type="button"
            onClick={volverAMiTienda}
            className="px-2.5 py-1 rounded-md border border-current text-xs font-semibold"
          >
            Volver a mi tienda
          </button>
        </div>
      )}
      <div className="flex-1">{children}</div>
      {pidiendoTienda && (
        <IrAOtraTiendaModal
          onClose={() => setPidiendoTienda(false)}
          onPedido={() => {
            setPidiendoTienda(false);
            recargarAmbito();
          }}
        />
      )}
      {/* Primero el consentimiento; después, si toca, el cambio de clave. */}
      {ambito?.consentimiento_pendiente ? (
        <ConsentimientoObligatorio onAceptado={recargarAmbito} />
      ) : (
        ambito?.debe_cambiar_clave && (
          <CambioClaveObligatorio rol={persona.rol_ficha ?? persona.rol} onListo={recargarAmbito} />
        )
      )}
    </div>
  );
}
