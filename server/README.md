# server — backend payment gateway (Hono + Midtrans)

Backend buat aplikasi testing di root project. Dibangun pakai:

- **[Hono](https://hono.dev)** — HTTP framework yang jalan di atas Bun.
- **[Bun SQLite](https://bun.com/docs/api/sqlite) + [Drizzle ORM](https://orm.drizzle.team)** — nyimpan order di `app.db` (mode WAL).
- **Midtrans Snap** — bikin token pembayaran, Status API, dan verifikasi webhook.

## Menjalankan

```sh
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

Isi key-nya (lihat tabel [Environment](#environment)), lalu:

```sh
bun run dev        # http://localhost:3000
```

## Environment

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `MIDTRANS_SERVER_KEY` | ✅ | — | Server key dari dashboard Midtrans (sandbox diawali `SB-`). Dipakai buat Basic Auth dan verifikasi signature webhook. |
| `MIDTRANS_CLIENT_KEY` | ✅ | — | Client key; dikirim ke frontend via `GET /api/config` buat load Snap.js. |
| `MIDTRANS_IS_PRODUCTION` | — | `false` | `true` → endpoint production (`app.midtrans.com` / `api.midtrans.com`); `false` → sandbox. |
| `APP_URL` | — | `http://localhost:5173` | Origin frontend yang diizinkan CORS. Bisa lebih dari satu, pisahkan dengan koma. |
| `PORT` | — | `3000` | Port HTTP backend. |
| `DB_FILE` | — | `app.db` | Lokasi file SQLite. |
| `MIN_AMOUNT` / `MAX_AMOUNT` | — | `1000` / `10000000` | Batas bawah/atas nominal buat form testing (bukan aturan Midtrans). |
| `MIDTRANS_SNAP_BASE` | — | otomatis | Override base URL endpoint Snap (mis. ke mock server waktu testing). |
| `MIDTRANS_API_BASE` | — | otomatis | Override base URL Status API Midtrans. |

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/` | Cek cepat server hidup. |
| `GET` | `/api/config` | Konfigurasi publik buat frontend: `clientKey`, `snapJsUrl`, `isProduction`. |
| `POST` | `/api/orders` | Bikin order + Snap token. Body: `firstName`, `lastName`, `email`, `phone`, `grossAmount`. Respons: `orderId`, `snapToken`, `redirectUrl`. |
| `GET` | `/api/orders/:id` | Status order (dipolling frontend tiap 3 detik). Kalau masih `pending`, backend sinkron ke Midtrans maksimal tiap 10 detik — jaga-jaga kalau webhook telat/hilang. |
| `POST` | `/webhook/midtrans` | Webhook notifikasi Midtrans. Verifikasi signature dulu; order tak dikenal dibalas `200 { ok: true, ignored: true }` biar nggak di-retry. Error sementara dibalas `503` supaya Midtrans retry. |

### Contoh pemakaian

**Bikin order:**

```sh
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Budi","lastName":"Santoso","email":"budi@example.com","phone":"08123456789","grossAmount":10000}'
```

**Cek status:**

```sh
curl http://localhost:3000/api/orders/ORDER-xxxx
```

## Aturan & perilaku penting

- **Source of truth = Midtrans Status API**, bukan callback Snap.js di frontend. Status `paid` cuma di-set dari data Midtrans yang diverifikasi.
- **Idempotent**: webhook ganda, urutan terbalik, atau barengan polling itu aman. Update status pakai conditional update — cuma pemanggil pertama yang menang dan memicu `onPaid()` (hook buat aksi setelah lunas, mis. kirim akses/email) **tepat satu kali**.
- **Verifikasi signature**: `SHA512(order_id + status_code + gross_amount + ServerKey)`, dibandingkan pakai `timingSafeEqual`. Signature tidak valid → `403`.
- **Cross-check nominal**: kalau `gross_amount` dari Midtrans ≠ nilai di database, sinkronisasi dibatalkan dan dicatat di log — biar nggak ada order dengan nominal berbeda.
- **`order_id`** dibuat dengan format `ORDER-<uuid>` (aturan Midtrans: maks 50 karakter, alfanumerik + `-`, harus unik).
- **Validasi input**: first name wajib, email harus valid, phone harus diawali `0` atau `+62`, `grossAmount` bilangan bulat dalam rentang `MIN_AMOUNT`–`MAX_AMOUNT`.
- Nama depan/belakang dipotong 30 karakter waktu dikirim ke Midtrans (biar aman buat VA BCA).
- `item_details` selalu di-set jumlahnya persis sama dengan `gross_amount`.

## Mapping status

Status mentah dari Midtrans dipetakan dulu sebelum disimpan:

| `transaction_status` | `fraud_status` | Status order |
|---|---|---|
| `settlement` | — | `paid` |
| `capture` | `accept` atau kosong | `paid` |
| `capture` | `deny` | `failed` |
| `capture` | selain di atas | `pending` |
| `pending`, `authorize` | — | `pending` |
| `deny`, `failure` | — | `failed` |
| `cancel` | — | `cancelled` |
| `expire` | — | `expired` |
| `refund`, `partial_refund`, `chargeback`, `partial_chargeback` | — | `refunded` |

`transaction_status` yang belum dikenal → `pending` + warning di log.

## Database

- SQLite (`app.db`, mode WAL) dengan skema di `src/schema.ts` (tabel `orders`).
- File `app.db*` sudah masuk `.gitignore` dan **jangan di-commit** — isinya data pelanggan dan file-nya berubah terus waktu server jalan.
- Mau lihat isi database dengan tampilan GUI? Jalankan `bun run db:studio` (Drizzle Studio).

## Script

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Jalanin server dengan hot reload (`bun --hot`). |
| `bun run db:studio` | Buka Drizzle Studio buat ngintip database. |

## Setup webhook di dashboard Midtrans

1. Buka **Settings → Payment → Payment notification URL**.
2. Isi `https://<url-publik>/webhook/midtrans`. Buat local testing pakai tunnel, contoh `ngrok http 3000`.
3. Tombol **Test notification** di dashboard bisa dipakai buat ngecek; karena order-nya nggak dikenal, server balas `200` + `ignored: true` (memang begitu perilakunya, biar nggak di-retry).

Kalau webhook nggak bisa dijangkau Midtrans (kasus umum waktu development), status order tetap ke-update lewat polling Status API di `GET /api/orders/:id`.
