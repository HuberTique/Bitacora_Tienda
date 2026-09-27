// En GitHub Pages el sitio se sirve bajo un subpath (/Bitacora_Tienda) — ver next.config.ts.
// Next.js resuelve esto solo, salvo en fetch()/rutas absolutas escritas a mano (plantillas
// PDF, archivos estáticos), que hay que armar con este helper para que apunten al lugar correcto
// tanto en local (basePath vacío) como en Pages.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Antepone el basePath del sitio a una ruta absoluta de un archivo público (ej. "/plantillas/x.pdf"). */
export function assetPath(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
