"use client";

// Genera una imagen PNG del podio (1080x1350) para descargar y compartir por
// WhatsApp o imprimir para la cartelera. Se dibuja en un <canvas>, sin
// librerías externas.

export type ItemPodio = { nombre: string; puntaje: number; fotoUrl?: string };

function cargarImagen(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function iniciales(n: string): string {
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

export async function descargarPodioPng(opts: {
  tienda: string;
  periodo: string; // p. ej. "septiembre 2026"
  items: ItemPodio[]; // en orden de puesto (1, 2, 3)
}): Promise<void> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear la imagen.");

  const fondo = ctx.createLinearGradient(0, 0, 0, H);
  fondo.addColorStop(0, "#1B2A4A");
  fondo.addColorStop(1, "#0F1A31");
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#E0A526";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText("VENDEDORES QUE HACEN MAGIA", W / 2, 120);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 76px sans-serif";
  ctx.fillText("Podio de ventas", W / 2, 215);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "34px sans-serif";
  ctx.fillText(`${opts.tienda} · ${opts.periodo}`, W / 2, 275);

  const fotos = await Promise.all(opts.items.map((i) => (i.fotoUrl ? cargarImagen(i.fotoUrl) : Promise.resolve(null))));

  // Orden visual: 2.º, 1.º, 3.º
  const orden = [1, 0, 2].filter((i) => opts.items[i]);
  const cols = [190, 540, 890];
  const medallas = ["#E0A526", "#B4BCC8", "#C0763F"];
  const alturas = [560, 440, 360];
  const base = 1180;

  orden.forEach((idx, pos) => {
    const it = opts.items[idx];
    const cx = cols[[1, 0, 2].indexOf(idx)];
    const h = alturas[idx];
    const radio = idx === 0 ? 120 : 100;
    const cy = base - h - radio - 30;

    // Tarima
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(cx - 150, base - h, 300, h);
    ctx.fillStyle = medallas[idx];
    ctx.fillRect(cx - 150, base - h, 300, 12);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 120px sans-serif";
    ctx.fillText(String(idx + 1), cx, base - h + 150);

    // Foto circular
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const img = fotos[idx];
    if (img) {
      const lado = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - lado) / 2,
        (img.height - lado) / 2,
        lado,
        lado,
        cx - radio,
        cy - radio,
        radio * 2,
        radio * 2,
      );
    } else {
      ctx.fillStyle = "#E8ECF4";
      ctx.fillRect(cx - radio, cy - radio, radio * 2, radio * 2);
      ctx.fillStyle = "#1B2A4A";
      ctx.font = `bold ${radio * 0.8}px sans-serif`;
      ctx.fillText(iniciales(it.nombre), cx, cy + radio * 0.28);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = medallas[idx];
    ctx.stroke();

    // Nombre y puntaje
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText(it.nombre.trim().split(/\s+/)[0], cx, base - h + 235);
    ctx.fillStyle = "#7BE0B8";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(`${Math.round(it.puntaje)} pts`, cx, base - h + 285);
    void pos;
  });

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "28px sans-serif";
  ctx.fillText("Bitácora Digital", W / 2, H - 60);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/png"),
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `podio-${opts.periodo.replace(/\s+/g, "-")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
