"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import type { Persona } from "@/lib/types";

type Tab = { href: string; label: string; roles: ("jefatura" | "asesor")[] };

const TABS: Tab[] = [
  { href: "/bitacora", label: "Bitácora", roles: ["jefatura", "asesor"] },
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

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  const visibleTabs = TABS.filter((t) => t.roles.includes(persona.rol));

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="bg-brand text-white flex items-center gap-4 sm:gap-6 px-4 sm:px-7 h-[60px] shrink-0">
        <div className="flex items-center gap-2.5 pr-4 sm:pr-5 border-r border-white/15 h-[60px] shrink-0">
          <div>
            <h1 className="text-base m-0 text-white font-display font-semibold leading-tight">
              Bitácora
            </h1>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">
              Outlet de las Américas
            </div>
          </div>
        </div>

        <nav className="flex items-center h-[60px] flex-1 overflow-x-auto">
          {visibleTabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  "flex items-center px-4 h-[60px] text-[13.5px] font-medium border-b-[3px] whitespace-nowrap transition-colors " +
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
      <div className="flex-1">{children}</div>
    </div>
  );
}
