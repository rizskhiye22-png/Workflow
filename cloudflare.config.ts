import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "kantor-bos",
    entrypoint: "./worker/index.js",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    observability: { enabled: true },
    // Tiap 5 menit: pengingat kuliah/tugas, notifikasi deploy, laporan pagi
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
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
      // Token deploy (template "Edit Cloudflare Workers" + D1 Edit + KV Edit). Dipasang otomatis ke secret repo proyek.
      CF_DEPLOY_TOKEN: bindings.secret(),
    },
  }),
});
