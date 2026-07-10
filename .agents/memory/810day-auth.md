---
name: 810DAY auth architecture
description: How login/registration works after the auth security fix — server-side only, random auth_token per user.
---

## The rule
All credential derivation is server-side. The browser only ever sends an X ID string and receives JWT session tokens back. No password is ever computed or visible on the client.

**Why:** The original code derived email/password deterministically from the public X ID (`xIdToEmail`, `xIdToPassword`), allowing any user to impersonate any other by knowing their X ID.

## How to apply
- `loginWithXId` server fn: looks up `profiles.auth_token` via service role, calls `signInWithPassword` server-side, returns `{ access_token, refresh_token }`.
- Client calls `supabase.auth.setSession(tokens)` after receiving them.
- `registerNewUser` server fn: generates `randomUUID()` as auth_token, creates Supabase auth user with it, stores in `profiles.auth_token`.
- `profiles.auth_token` column has `REVOKE SELECT (auth_token) ON profiles FROM authenticated` — authenticated role cannot read it; only service role can.
- `src/lib/xid.ts` no longer exports `xIdToEmail` or `xIdToPassword`.
- Required secret: `SUPABASE_SERVICE_ROLE_KEY` (Replit secret, used by `client.server.ts`).
