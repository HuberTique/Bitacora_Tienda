"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

export type PuestoPodio = { id: string; nombre: string; puntos: number; avatar: ReactNode };

const COLORES = ["#E0A526", "#FFFFFF", "#3B8BEB", "#D1487A", "#1F8A70", "#F5D26B", "#7C5CBF"];

type Particula = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  serpentina: boolean;
  fase: number;
  vida: number;
};

/** Lluvia de confeti y serpentinas sobre toda la pantalla (dura unos 5 s). */
export function lanzarConfeti() {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ps: Particula[] = [];
  const crear = (x: number, y: number, vx: number, vy: number) =>
    ps.push({
      x,
      y,
      vx,
      vy,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      color: COLORES[Math.floor(Math.random() * COLORES.length)],
      serpentina: Math.random() < 0.3,
      fase: Math.random() * 10,
      vida: 0,
    });
  // Cañones laterales + lluvia desde arriba.
  for (let i = 0; i < 90; i++) {
    crear(0, H * 0.75, 6 + Math.random() * 9, -(9 + Math.random() * 11));
    crear(W, H * 0.75, -(6 + Math.random() * 9), -(9 + Math.random() * 11));
  }
  for (let i = 0; i < 110; i++) crear(Math.random() * W, -20 - Math.random() * H * 0.6, (Math.random() - 0.5) * 2, 1 + Math.random() * 3);

  const inicio = performance.now();
  const DUR = 5200;
  const frame = (t: number) => {
    const el = t - inicio;
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => {
      p.vida++;
      p.vy += 0.22;
      p.vx *= 0.985;
      p.vy = Math.min(p.vy, p.serpentina ? 3.2 : 5.5);
      p.x += p.vx + Math.sin((p.vida + p.fase) * 0.08) * 0.8;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = Math.max(0, Math.min(1, (DUR - el) / 1200));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.serpentina) {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        for (let k = -14; k <= 14; k += 4) ctx.lineTo(k, Math.sin(k * 0.5 + p.vida * 0.2) * 4);
        ctx.stroke();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.vida * 0.12 + p.fase)) + 1);
      }
      ctx.restore();
    });
    if (el < DUR) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

const ESCALON = [
  { alto: 150, grad: "linear-gradient(180deg,#F6D060 0%,#C88A12 100%)", texto: "#5A3A00", num: "1" },
  { alto: 110, grad: "linear-gradient(180deg,#E7EBF2 0%,#9AA5B8 100%)", texto: "#2B3446", num: "2" },
  { alto: 84, grad: "linear-gradient(180deg,#E2A26B 0%,#A5622B 100%)", texto: "#4A2608", num: "3" },
];

/** Podio estilo olímpico (2.º · 1.º · 3.º) con reflectores y celebración con confeti. */
export function PodioOlimpico({ puestos, celebrar = true }: { puestos: PuestoPodio[]; celebrar?: boolean }) {
  const lanzado = useRef(false);
  const celebrarYa = useCallback(() => lanzarConfeti(), []);
  useEffect(() => {
    if (celebrar && !lanzado.current && puestos.length > 0) {
      lanzado.current = true;
      const t = setTimeout(lanzarConfeti, 350);
      return () => clearTimeout(t);
    }
  }, [celebrar, puestos.length]);

  // Orden visual: plata, oro, bronce.
  const orden = [1, 0, 2].filter((i) => puestos[i]);

  return (
    <div
      className="relative overflow-hidden rounded-[14px] px-3 pt-6 sm:px-8"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(80,150,255,.45) 0%, rgba(11,30,63,0) 60%), linear-gradient(180deg,#0B1E3F 0%,#050B18 100%)",
      }}
    >
      {/* Reflectores */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-full opacity-40"
        style={{
          background:
            "conic-gradient(from 200deg at 50% -10%, transparent 0deg, rgba(255,255,255,.22) 12deg, transparent 24deg, transparent 336deg, rgba(255,255,255,.22) 348deg, transparent 360deg)",
        }}
      />
      <div className="relative flex items-end justify-center gap-2 sm:gap-4">
        {orden.map((i) => {
          const p = puestos[i];
          const e = ESCALON[i];
          return (
            <div key={p.id} className="flex flex-col items-center flex-1 max-w-[230px]">
              {i === 0 && (
                <div className="text-3xl leading-none mb-1 animate-bounce" aria-hidden>
                  👑
                </div>
              )}
              {p.avatar}
              <div className="mt-2 font-display font-bold text-[15px] leading-tight text-white text-center">
                {p.nombre}
              </div>
              <div className="text-[13px] font-semibold text-[#F5D26B] mb-2">{Math.round(p.puntos)} pts</div>
              <div
                className="w-full rounded-t-lg flex items-start justify-center pt-2 shadow-[0_-4px_18px_rgba(255,255,255,.12)]"
                style={{ height: e.alto, background: e.grad, color: e.texto }}
              >
                <span className="font-display font-bold text-5xl leading-none opacity-90">{e.num}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative h-2 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <button
        type="button"
        onClick={celebrarYa}
        className="absolute top-2 right-3 text-[12px] font-semibold text-white/85 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1"
      >
        🎉 Celebrar
      </button>
    </div>
  );
}
