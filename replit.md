# 810DAY毎日くじ

A Japanese daily lottery web app where users authenticate with their X (Twitter) ID.

## Stack

- **Framework**: TanStack Start (React 19 + SSR) via `@lovable.dev/vite-tanstack-config`
- **Auth / Database**: Supabase (`cwaixuwgicbivphoasam`)
- **UI**: shadcn/ui + Tailwind CSS v4
- **Package manager**: Bun
- **Routing**: TanStack Router (file-based)

## Running the app

```bash
bun run dev
```

The dev server starts on **port 5000**. The workflow "Start application" handles this automatically.

## Environment variables

All Supabase env vars are set as Replit environment variables (shared):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

## Key files

- `vite.config.ts` — Vite/TanStack Start config (port 5000 override for Replit)
- `src/routes/` — File-based routes (TanStack Router)
- `src/integrations/supabase/client.ts` — Supabase client
- `src/server.ts` — SSR error wrapper
- `supabase/migrations/` — Database schema migrations

## Notes

- The `@lovable.dev/vite-tanstack-config` package defaults to port 8080 for the Lovable sandbox. On Replit, `LOVABLE_SANDBOX` is not set, so port 5000 is used instead.
- The `.env` file holds Supabase publishable (non-secret) keys. These are also set as Replit env vars so they're available in all environments.

## User preferences
