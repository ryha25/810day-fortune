---
name: Replit port override for Lovable vite config
description: How to make @lovable.dev/vite-tanstack-config use port 5000 instead of its default 8080 on Replit.
---

## The rule
Add `vite.server.port = 5000` with `strictPort: true` in `vite.config.ts` to override the Lovable default of 8080.

**Why:** `@lovable.dev/vite-tanstack-config` forces port 8080 when `LOVABLE_SANDBOX=1` is set, but in non-sandbox mode (Replit) it does `mergeConfig({ port: 8080 }, userConfig)` where user config wins. Port 5000 is required for Replit's webview outputType.

## How to apply
```ts
export default defineConfig({
  vite: {
    server: { port: 5000, strictPort: true, host: "0.0.0.0", allowedHosts: true },
  },
});
```
`isSandbox` is `true` only when `LOVABLE_SANDBOX=1` or `DEV_SERVER__PROJECT_PATH` is set — neither is present in Replit.
