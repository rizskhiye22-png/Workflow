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

## Setup (cukup sekali)

### 1. Hubungkan repo ini ke Cloudflare
1. Buka dash.cloudflare.com, lalu masuk ke **Workers & Pages → Create → Import a repository**.
2. Pilih repo ini.
3. Isi pengaturan build:
   - Build command: `npm run build`
   - Deploy command: `npm run deploy`
4. Klik Deploy.

KV `DASH_KV` dibuat otomatis saat deploy pertama. Setiap push ke `main` akan men-deploy ulang.

> Kalau deploy gagal karena KV belum ada: buat KV di **Storage & Databases → KV → Create**, lalu isi ID-nya di `cloudflare.config.ts` (`DASH_KV: bindings.kv({ id: "..." })`).

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
app/(game)/          halaman game (dikunci login): Kantor, Jadwal, Upload, Data, Log, Atur
app/login/           layar judul / login
app/api/[...path]/   semua API (route handler)
components/          UI React (GameShell = HUD + hotbar, *Screen = tiap halaman)
lib/office/          mesin kantor pixel (engine.js) + font pixel
lib/server/          login, push GitHub, API KV/D1/Pages, penyimpanan
cloudflare.config.ts konfigurasi Worker + binding KV + secret
```

## Ide berikutnya
- Notifikasi push asli untuk jadwal kuliah (Web Push + Cron), supaya tetap muncul walau aplikasi tertutup.
- Toko dekorasi kantor, dibeli pakai koin dari push.
- Karyawan naik jabatan setelah X deploy sukses.
- Tombol rollback ke commit sebelumnya.
