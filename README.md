# [Example] Payment-Gateway-Integration-Midtrans

## Frontend UI
<img width="1920" height="997" alt="payment-gtwy-integration-midtrans-user-interface-2026(3)" src="https://github.com/user-attachments/assets/b21d0eec-b4b2-4420-9dcd-779e590bf207" />

<img width="1917" height="1043" alt="payment-gtwy-integration-midtrans-user-interface-2026(2)" src="https://github.com/user-attachments/assets/6cc7abc0-3116-4ea2-8349-031a8634b261" />

## Backend UI
<img width="668" height="276" alt="pg-integration-midtrans-backend" src="https://github.com/user-attachments/assets/e7e00e3e-4695-4219-be1c-54e2ec94c06b" />

## Sandbox Mode Midtrans Dashboard UI
<img width="1888" height="939" alt="midtrans-dashboard-ui" src="https://github.com/user-attachments/assets/e7797e11-3c30-4551-8e6c-98b02b27e9a3" />

Demo integrasi **payment gateway Midtrans (Snap)** buat testing. Projectnya terdiri dari dua aplikasi yang jalan terpisah:

| Bagian | Teknologi | Port | Fungsi |
|---|---|---|---|
| Frontend (root) | Preact + Bun dev server | `5173` | Form pelanggan + popup pembayaran Snap.js |
| Backend (`server/`) | Hono + SQLite (Drizzle) | `3000` | Bikin transaksi Snap, simpan order, terima webhook |

> ⚠️ Project ini cuma buat belajar/testing, bukan siap production. Buat dipakai beneran, masih perlu autentikasi, manajemen stok, dan error handling yang lebih lengkap.

## Alur pembayaran

1. User isi form (nama, email, telepon, nominal) → frontend kirim `POST /api/orders`.
2. Backend bikin order `ORDER-<uuid>`, minta **Snap token** ke Midtrans, lalu simpan order + token ke SQLite.
3. Frontend buka **popup Snap.js** pakai token tersebut → user pilih metode bayar (VA, QRIS, e-wallet, dsb).
4. Status final datang dari **webhook Midtrans** (`POST /webhook/midtrans`). Buat jaga-jaga kalau webhook telat/tidak sampai, backend juga sinkron ke **Status API** Midtrans maksimal tiap 10 detik selama frontend polling `GET /api/orders/:id`.
5. Frontend menampilkan hasil akhir: `paid`, `failed`, `cancelled`, `expired`, atau `refunded`.

## Struktur folder

```
├── src/
│   ├── index.ts          # Bun dev server frontend (port 5173)
│   ├── client.tsx        # Form + polling status + integrasi Snap.js
│   └── index.html
├── style.css             # Styling form
└── server/
    ├── src/
    │   ├── index.ts      # Route API + webhook (Hono)
    │   ├── midtrans.ts   # Snap API, Status API, verifikasi signature
    │   ├── db.ts         # Koneksi SQLite (WAL) via Drizzle
    │   └── schema.ts     # Skema tabel `orders`
    ├── env.example       # Contoh konfigurasi environment
    └── README.md         # Dokumentasi backend (endpoint, env, status mapping)
```

## Prasyarat

- [Bun](https://bun.com) — dipakai frontend dan backend.
- Akun [Midtrans Sandbox](https://dashboard.sandbox.midtrans.com) — buat ambil Access Keys.

## 1. Setup & jalankan backend

```sh
cd server
bun install
```

Copy `env.example` jadi `.env`:

```powershell
# Windows (PowerShell)
Copy-Item env.example .env
```

```sh
# Linux/macOS
cp env.example .env
```

Isi key dari dashboard Midtrans (**Settings → Access Keys**). Minimal yang perlu diisi:

```env
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxx
MIDTRANS_IS_PRODUCTION=false
APP_URL=http://localhost:5173
```

Jalankan backend:

```sh
bun run dev        # http://localhost:3000
```

> Penjelasan lengkap semua variabel env + daftar endpoint ada di [server/README.md](server/README.md).

## 2. Setup & jalankan frontend

Buka terminal baru, dari root project:

```sh
bun install
bun run dev        # http://localhost:5173
```

Buka `http://localhost:5173`, isi form, klik **Pay!** — popup Snap bakal muncul. Di mode sandbox, popup-nya menyediakan simulator pembayaran; setelah simulasi selesai, status di form bakal berubah jadi `paid`.

Catatan:

- URL backend di-hardcode di `src/client.tsx` (`const API = "http://localhost:3000"`). Kalau port backend berubah, ubah di situ.
- Script `start` di `package.json` pakai sintaks `NODE_ENV=production bun ...` yang cuma jalan di bash. Di Windows (PowerShell), jalankan manual:

```powershell
$env:NODE_ENV="production"; bun src/index.ts
```

## Konfigurasi dashboard Midtrans

1. **Access Keys** (Settings → Access Keys) — selama testing pakai key **sandbox** (diawali `SB-`). Backend bakal ngasih warning kalau mode sandbox tapi key-nya bukan `SB-`.
2. **Payment notification URL** (Settings → Payment → Payment notification URL) — isi `https://<url-publik>/webhook/midtrans`. Midtrans nggak bisa manggil `localhost`, jadi buat testing lokal pakai tunnel, contoh:

```sh
ngrok http 3000
# lalu isi https://xxxx.ngrok-free.app/webhook/midtrans di dashboard
```

Kalau webhook belum di-set, status order tetap ke-update karena backend juga polling Status API — cuma nggak instan.

## Security

- **`.env` jangan pernah di-commit.** Isinya server key yang bisa dipakai buat akses API Midtrans (bikin transaksi, lihat data). Kalau tidak sengaja ke-push, segera rotate/regenerate key di dashboard.
- **File SQLite (`server/app.db*`) jangan di-commit.** Selain berubah terus tiap server jalan (mode WAL), isinya data pelanggan: nama, email, dan nomor telepon.
