// Entry Worker kustom: halaman & API ditangani vinext (Next.js), lalu ditambah
// handler `scheduled` untuk Cron Trigger (pengingat kuliah, tugas, deploy, laporan pagi).
import app from 'vinext/server/app-router-entry';
import { runCron } from '../lib/server/cron.js';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.scheduledTime).catch((e) => console.error('cron gagal', e)));
  },
};
