import type { NextConfig } from "next";

// En GitHub Pages el sitio se sirve bajo un subpath (/Bitacora_Tienda).
// Localmente y en Vercel se sirve en /. El workflow de Actions pone la env
// var GITHUB_PAGES=true al construir para Pages.
const isGithubPages = process.env.GITHUB_PAGES === "true";
// Nombre del repositorio en Pages. Una copia limpia en otro repo lo cambia con PAGES_REPO.
const REPO = process.env.PAGES_REPO || "Bitacora_Tienda";

const basePath = isGithubPages ? `/${REPO}` : "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
  assetPrefix: isGithubPages ? `/${REPO}/` : "",
  // Expone el basePath al código de cliente (ver src/lib/asset-path.ts) — Next.js
  // no lo inyecta solo fuera de sus propios helpers (next/link, next/image).
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
