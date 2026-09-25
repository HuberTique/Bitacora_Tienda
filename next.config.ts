import type { NextConfig } from "next";

// En GitHub Pages el sitio se sirve bajo un subpath (/Bitacora_Tienda).
// Localmente y en Vercel se sirve en /. El workflow de Actions pone la env
// var GITHUB_PAGES=true al construir para Pages.
const isGithubPages = process.env.GITHUB_PAGES === "true";
// Nombre del repositorio en Pages. Una copia limpia en otro repo lo cambia con PAGES_REPO.
const REPO = process.env.PAGES_REPO || "Bitacora_Tienda";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: isGithubPages ? `/${REPO}` : "",
  assetPrefix: isGithubPages ? `/${REPO}/` : "",
};

export default nextConfig;
