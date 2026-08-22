# Bitácora Digital

Gestión automática de tareas manuales para operación de tienda retail (bitácora, feedbacks, horarios, presupuestos, requerimientos, reportes).

Migración del artifact HTML original a aplicación web real. Ver [`docs/Plan_Migracion_Bitacora_Digital.md`](docs/Plan_Migracion_Bitacora_Digital.md) para el plan completo por fases.

## Stack

- **Next.js 16** (App Router, TypeScript) en modo **exportación estática** (`output: 'export'`) — el sitio queda como archivos estáticos servibles desde GitHub Pages
- **Tailwind CSS 4**
- **Supabase** — Postgres + Auth + Storage + Realtime + Edge Functions (todo el backend, sin servidor propio)

## Estado

**Fase 0 — Scaffold + conexión Supabase.** ✅ Cliente inicializado, endpoint de auth respondiendo desde el navegador.

Próximo: portar el módulo de Personal (Fase 1) como primer módulo de punta a punta.

## Desarrollo local

Requisitos: Node 18.17+ (probado con Node 25).

```bash
cp .env.example .env.local
# editar .env.local con URL y publishable key del proyecto de Supabase
npm install
npm run dev
```

Abrir http://localhost:3000 — la portada debe mostrar "Conectado" al proyecto de Supabase configurado.

## Scripts

- `npm run dev` — servidor de desarrollo con hot reload
- `npm run build` — build estático a `out/` (listo para publicar en GitHub Pages, Cloudflare Pages, Vercel, etc.)
- `npm run lint` — ESLint

## Variables de entorno

Solo dos, ambas públicas (se embeben en el bundle del navegador — Supabase las diseñó para eso, la seguridad la impone Row Level Security en la base de datos):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

**No** commitear `.env.local`. La `service_role` key nunca se usa desde el navegador — va en Supabase Edge Functions, del lado servidor.
