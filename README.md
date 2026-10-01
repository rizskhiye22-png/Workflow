# Kantor Bos 🏢

Dashboard pribadi yang di-host di Cloudflare Workers:

- **Kantor pixel**: setiap proyek tampil sebagai karyawan di mejanya. Statusnya ada lima: mengetik (sedang deploy), centang hijau (sukses), tanda "!" merah (gagal), "z" (tidur, tidak ada aktivitas 3 hari), dan santai (belum pernah deploy).
- **Jadwal kuliah** dalam jam Jepang (JST): kuliah berikutnya dengan hitung mundur, pengingat 15 menit sebelum kelas, dan ekspor ke kalender HP (.ics).
- **Upload ZIP**: file zip langsung di-push ke GitHub. Hanya file yang berubah yang di-upload, lalu Cloudflare deploy otomatis.
- **Data**: lihat, tambah, ubah, dan hapus isi **KV**, serta jalankan SQL di **D1**.
- **Riwayat**: daftar push, run GitHub Actions, dan deployment Cloudflare Pages.
- **PWA**: bisa di-"Install" atau "Tambahkan ke layar utama" di HP.

---

## Setup pertama (±15 menit, cukup sekali)

### 1. Taruh kode ini di GitHub
Buat repo baru (contoh: `kantor-bos`, sebaiknya **Private**), lalu upload isi folder ini ke repo tersebut.

### 2. Buat KV untuk dashboard
1. Buka dash.cloudflare.com, lalu masuk ke **Storage & Databases → KV → Create**.
2. Beri nama `kantor-bos-data`.
3. Salin **ID**-nya, lalu tempel di `wrangler.jsonc` menggantikan `GANTI_DENGAN_ID_KV`. Commit perubahannya.

### 3. Hubungkan repo ke Cloudflare
1. Masuk ke **Workers & Pages → Create → Import a repository** (atau *Connect to Git*).
2. Pilih repo `kantor-bos`.
3. Isi *Deploy command* dengan `npx wrangler deploy`, lalu klik Deploy.

Mulai sekarang, setiap push ke repo ini otomatis men-deploy ulang dashboard.

### 4. Buat token

**Token GitHub** (github.com → Settings → Developer settings → *Fine-grained tokens* → Generate):
- Repository access: pilih repo-repo proyekmu (atau *All repositories*).
- Permissions:
  - **Contents**: Read and write
  - **Workflows**: Read and write
  - **Actions**: Read
  - **Metadata**: Read

**Token Cloudflare** (dash.cloudflare.com → My Profile → API Tokens → Create Token → *Custom token*). Beri izin tingkat Account berikut:
- **Workers KV Storage**: Edit
- **D1**: Edit
- **Cloudflare Pages**: Read

**Account ID**: ada di halaman Overview akun Cloudflare (kolom kanan).

### 5. Simpan secret
Buka Worker `kantor-bos`, lalu masuk ke **Settings → Variables and Secrets → Add** dan tambahkan yang berikut sebagai tipe **Secret**:

| Nama | Isi |
|---|---|
| `DASHBOARD_PASSWORD` | password untuk masuk dashboard (buat yang kuat) |
| `SESSION_SECRET` | teks acak panjang, misalnya 40 karakter campur |
| `GITHUB_TOKEN` | token GitHub dari langkah 4 |
| `CF_API_TOKEN` | token Cloudflare dari langkah 4 |
| `CF_ACCOUNT_ID` | Account ID |

### 6. (Disarankan) Kunci lapis kedua
Di Worker → **Settings → Domains & Routes**, aktifkan **Cloudflare Access** untuk alamat `workers.dev` dan izinkan hanya email kamu. Jadi selain password, kamu juga harus login lewat email.

### 7. Pakai
- Buka `https://kantor-bos.<akunmu>.workers.dev`, lalu login.
- Buka menu **Atur**, cek koneksi, lalu klik **+ Proyek** untuk setiap repo.
- Di HP: buka menu browser, lalu pilih **Tambahkan ke layar utama**.
- Di menu **Jadwal**, isi tanggal semester selesai, lalu klik **Tambah ke kalender**. Buka file `.ics` yang terunduh, dan alarm 15 menit sebelum setiap kelas akan masuk ke kalender HP.

---

## Cara kerja upload zip
1. Zip dibongkar **di browser**.
2. Beberapa hal otomatis dilewati: `node_modules`, `.git`, `__MACOSX`, `.DS_Store`, serta file rahasia `.env` dan `.dev.vars` supaya tidak bocor ke GitHub.
3. Kalau semua file ada di dalam satu folder pembungkus, folder itu otomatis dilepas.
4. SHA setiap file dibandingkan dengan isi repo, jadi **hanya file yang berubah** yang di-upload (per batch 40 file, aman untuk batas paket gratis Workers).
5. Ada dua mode:
   - **Ganti semua**: zip dianggap proyek lengkap, jadi file di repo yang tidak ada di zip akan dihapus. Folder `.github` tetap dipertahankan kalau zip tidak membawanya.
   - **Tambah/timpa**: hanya file di zip yang diubah, file lain tetap.
6. Satu commit dibuat, lalu Cloudflare (lewat Git integration atau GitHub Actions di proyek itu) deploy otomatis.

> Status di kantor akan akurat kalau proyek memakai **GitHub Actions** atau kolom *Nama proyek Cloudflare Pages* diisi.

## Struktur
```
src/index.js       router + login + ringkasan status kantor
src/auth.js        password, cookie sesi (HMAC), batas percobaan login
src/github.js      push via Git Data API (blob → tree → commit → ref)
src/cloudflare.js  API KV, D1, Pages
src/store.js       data dashboard di KV: proyek, riwayat, jadwal kuliah
public/            tampilan (app.js, office.js = kantor pixel, sw.js = PWA)
```

## Coba di komputer
```bash
npm install
printf 'DASHBOARD_PASSWORD=rahasia\nSESSION_SECRET=acak-panjang\n' > .dev.vars
npx wrangler dev
```
Tambahkan `?demo=1` di URL untuk melihat kantor dengan karyawan contoh.

## Rencana pengembangan
- Push notification asli (Web Push + Cron Trigger), supaya pengingat kuliah tetap muncul walau dashboard tertutup.
- Gaji/XP karyawan dari jumlah deploy sukses, level kantor naik, dekorasi bisa dibeli.
- Karyawan bisa jalan ke water cooler saat idle, dan boss bisa "menegur" karyawan yang gagal.
- Tombol rollback ke commit sebelumnya.
