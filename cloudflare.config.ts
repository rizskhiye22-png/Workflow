import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "kantor-bos",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    observability: { enabled: true },
    env: {
      ASSETS: bindings.assets(),
      // KV untuk data dashboard (proyek, riwayat, jadwal). Dibuat otomatis saat deploy.
      DASH_KV: bindings.kv(),
      // Secret — isi di dashboard Cloudflare (Settings → Variables and Secrets)
      DASHBOARD_PASSWORD: bindings.secret(),
      SESSION_SECRET: bindings.secret(),
      GITHUB_TOKEN: bindings.secret(),
      CF_API_TOKEN: bindings.secret(),
      CF_ACCOUNT_ID: bindings.secret(),
    },
  }),
});
