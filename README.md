# Kantor Bos 🏢🎮

**Office simulator pixel** pribadi sekaligus dashboard kerja. Dibangun dengan **Next.js (App Router)** lewat [vinext](https://github.com/cloudflare/vinext), dan berjalan di **Cloudflare Workers**.

## Fitur
- **Kantor hidup**: setiap proyek adalah karyawan pixel yang bergerak sendiri.
  - Jalan ke dispenser air, bikin kopi, rebahan di sofa, main arcade, beli camilan.
  - Nyamperin meja teman untuk ngobrol, dengan gelembung bicara bergantian.
  - **Bos keliling inspeksi**: memuji karyawan yang deploy-nya sukses, menegur yang gagal, membangunkan yang tidur, lalu kadang turun ambil kopi.
  - Status ditampilkan langsung di karyawan:
    - **Mengetik** dengan layar laptop berkedip: sedang deploy
    - **✓**: sukses, ada **konfeti** saat baru berhasil
    - **!** dengan keringat: gagal
    - **z**: tidur
  - Langit di jendela, jam dinding, dan lampu malam mengikuti **jam Jepang**.
  - Feed **Kabar Kantor** mencatat semua kejadian.
- **HUD game**: level, bar XP, dan koin. Setiap push = +1 XP, dan trofi di dinding bertambah sesuai level.
- **Jadwal kuliah (JST)**:
  - "Quest" aktif atau berikutnya dengan hitung mundur dan bar progres.
  - Notifikasi 15 menit sebelum kelas.
  - Ekspor ke kalender HP (.ics) dengan alarm.
- **Upload ZIP → GitHub**: hanya file yang berubah yang di-upload. File `.env` dan `.dev.vars` otomatis tidak ikut. Ada mode *Ganti semua* atau *Tambah/timpa*.
- **Data**: editor KV (lihat, tambah, ubah, hapus) dan konsol SQL untuk D1.
- **Log deploy**: push, GitHub Actions, dan Cloudflare Pages.
- **PWA**: bisa di-"Tambahkan ke layar utama" di HP. Ada efek suara 8-bit yang bisa dimatikan.

---

## Fitur v3
- **Notifikasi push asli**. Muncul di HP walau aplikasi tertutup, dikirim oleh Cron Trigger setiap 5 menit:
  - pengingat kuliah (5–60 menit sebelum mulai)
  - tenggat tugas
  - laporan pagi Bos
  - kabar deploy sukses atau gagal

  Cara mengaktifkan: **Atur → Notifikasi → Aktifkan di perangkat ini**. Di iPhone, tambahkan dulu ke Layar Utama.
- **Rollback**. Di menu Log ada daftar 10 commit terakhir dengan tombol **↺ Kembalikan**. Rollback membuat commit baru, jadi riwayat tetap aman.
- **Laporan Bos** di layar Kantor: kuliah hari ini, tugas mendekati tenggat, sesi yang belum dicentang, dan proyek yang gagal deploy.
- **Sekretaris Yuki**. Di layar Jadwal, dia memberi kabar kuliah dan tugas. Di kantor pixel, dia berjalan ke meja Bos untuk melapor kalau ada yang penting. Ketuk Yuki untuk membuka Jadwal.
- **Jadwal kuliah** dengan 3 tab:
  - **Minggu**: daftar kelas, pertemuan ke berapa, progres sesi, dan pengaturan semester
  - **Kalender**: tampilan per bulan. Ketuk tanggal untuk menandai sesi *Ada kuliah*, *✓ Selesai*, atau *Libur*, dan untuk menambah kuliah tambahan atau pengganti
  - **Tugas**: to-do tugas dengan tenggat, plus daftar sesi yang belum dicentang
- **Proyek Worker atau Pages**. Status deploy dibaca dari Cloudflare sesuai jenis proyeknya.
- **Upload aman**. Ada pratinjau file yang ditambah atau dihapus sebelum push, folder pembungkus hanya dilepas 1 lapis, dan kamu bisa memilih folder tujuan.

### 🚀 Proyek baru dari zip (menu Upload → Proyek baru)
Pilih zip, lalu Kantor Bos akan:
1. Mengenali jenis proyek: situs statis, perlu build (Vite/React/Vue…), atau Worker yang sudah punya `wrangler.jsonc`.
2. Membuat repo GitHub (private secara default).
3. Memasang secret `CLOUDFLARE_API_TOKEN` & `CLOUDFLARE_ACCOUNT_ID` di repo itu, dari `CF_DEPLOY_TOKEN`.
4. Menambahkan `.github/workflows/deploy.yml`, plus `wrangler.jsonc` untuk situs statis atau hasil build.
5. Merekrut karyawan baru, lalu meng-upload isi zip. GitHub Actions kemudian men-deploy ke `https://<nama>.<akun>.workers.dev`.

Sebelum menimpa repo yang sudah berisi atau Worker yang sudah ada, Kantor Bos selalu minta konfirmasi dulu.
Untuk repo lama (misalnya yang dibuat dari laptop), pakai **Atur → proyek → 🔑 Pasang deploy otomatis**.

### Izin token tambahan
| Token | Izin |
|---|---|
| GitHub (fine-grained, All repositories) | Contents: Read & write · Workflows: Read & write · Actions: Read · Metadata: Read · **Administration: Read & write** (buat repo) · **Secrets: Read & write** (pasang kunci deploy) |
| Cloudflare (User API Token) | Workers KV Storage: Edit · D1: Edit · Cloudflare Pages: Read · **Workers Scripts: Read** · **Workers Builds Configuration: Read** (untuk status proyek Worker) |

## Setup (cukup sekali)

### 1. Hubungkan repo ini ke Cloudflare
1. Buka dash.cloudflare.com → **Workers & Pages → Create → tab Workers → Import a repository**. Jangan pilih Pages.
2. Pilih repo ini.
3. Isi pengaturannya:
   - **Project name**: `kantor-bos`
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy` (biarkan default)
4. Klik Deploy.

KV `DASH_KV` dibuat otomatis saat deploy pertama, dan setiap push ke `main` akan men-deploy ulang.

> Konfigurasi Worker ada di dua file: `cloudflare.config.ts` (dipakai saat build/dev) dan `wrangler.jsonc` (dipakai saat deploy). Kalau mengubah binding, ubah di keduanya.

### 2. Buat token

**GitHub** (Settings → Developer settings → *Fine-grained tokens*):
- Pilih repo-repo proyekmu.
- Permissions:
  - **Contents**: Read & write
  - **Workflows**: Read & write
  - **Actions**: Read
  - **Metadata**: Read

**Cloudflare** (My Profile → API Tokens → Custom token). Beri izin tingkat Account berikut:
- **Workers KV Storage**: Edit
- **D1**: Edit
- **Cloudflare Pages**: Read

**Account ID**: ada di halaman Overview akun Cloudflare.

### 3. Isi secret
Buka Worker `kantor-bos`, lalu masuk ke **Settings → Variables and Secrets** dan tambahkan sebagai tipe **Secret**:

| Nama | Isi |
|---|---|
| `DASHBOARD_PASSWORD` | password masuk (buat yang kuat) |
| `SESSION_SECRET` | teks acak panjang (±40 karakter) |
| `GITHUB_TOKEN` | token GitHub |
| `CF_API_TOKEN` | token Cloudflare |
| `CF_ACCOUNT_ID` | Account ID |
| `CF_DEPLOY_TOKEN` | token Cloudflare template **Edit Cloudflare Workers** + **D1: Edit** + **Workers KV Storage: Edit**. Dipasang otomatis ke repo proyek |

### 4. (Disarankan) Kunci lapis kedua
Aktifkan **Cloudflare Access** untuk alamat `workers.dev` di Worker → Settings → Domains & Routes, dan izinkan hanya email kamu.

### 5. Main!
- Buka `https://kantor-bos.<akunmu>.workers.dev` dan login.
- Masuk ke menu **Atur → + Rekrut** dan tambahkan satu karyawan untuk setiap repo.
- Di HP: buka menu browser, lalu pilih **Tambahkan ke layar utama**.

---

## Coba di komputer
```bash
npm install
printf 'DASHBOARD_PASSWORD=rahasia\nSESSION_SECRET=acak-panjang\n' > .dev.vars
npm run dev
```
Buka `/?demo=1` untuk melihat kantor penuh karyawan contoh.

## Struktur
```
worker/index.js      entry Worker: halaman (vinext) + handler cron
lib/kuliah.js        logika jadwal (sesi, libur, kuliah tambahan) dipakai server & browser
app/(game)/          halaman game (dikunci login): Kantor, Jadwal, Upload, Data, Log, Atur
app/login/           layar judul / login
app/api/[...path]/   semua API (route handler)
components/          UI React (GameShell = HUD + hotbar, *Screen = tiap halaman)
lib/office/          mesin kantor pixel (engine.js) + font pixel
lib/server/          login, push & rollback GitHub, API KV/D1/Pages/Workers, penyimpanan,
                     webpush.js (VAPID + enkripsi), cron.js (pengingat & laporan pagi)
cloudflare.config.ts konfigurasi Worker + binding KV + secret
```

## Ide berikutnya
- Toko dekorasi kantor, dibeli pakai koin dari push.
- Karyawan naik jabatan setelah X deploy sukses.
- Belajar JLPT (flashcard + SRS) yang memberi XP.
- Rekap nilai & IPK.
