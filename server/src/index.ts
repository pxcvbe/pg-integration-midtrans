/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, eq, ne } from "drizzle-orm";
import { db } from './db';
import { orders, type Order } from './schema';
import {
  CLIENT_KEY,
  IS_PRODUCTION,
  SNAP_JS_URL,
  createSnapTransaction,
  getTransactionStatus,
  isValidSignature,
  mapStatus,
} from "./midtrans";

const app = new Hono()

app.get('/', (c) => {
  return c.text('This is will be my backend for midtrans payment gateway\n\nBuilt with Hono')
})

// APP_URL = origin frontend; boleh lebih dari satu, pisahkan dengan koma
const origins = (process.env.APP_URL ?? "http://localhost:5173").split(",").map((s) => s.trim());
// Enable CORS untuk komunikasi dengan frontend (Preact App)
app.use("/api/*", cors({ origin: origins }));

const now = () => Math.floor(Date.now() / 1000);

// Batas nominal untuk form testing ini (bukan aturan Midtrans)
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT ?? 1_000);
const MAX_AMOUNT = Number(process.env.MAX_AMOUNT ?? 10_000_000);

const getOrder = (id: string) => db.select().from(orders).where(eq(orders.id, id)).get();

// Dipanggil tepat satu kali per order, saat status pindah ke "paid"
async function onPaid(order: Order) {
  console.log(`[paid] ${order.id} Rp${order.grossAmount}`);
  // TODO lakukan something seperti kirim akses/email, kurangi stok, dll
}

// Source of Truth = API status Midtrans, bukan isi notifikasi/callback dari frontend.
// Idempotent: aman dipanggil berkali-kali (webhook ganda, urutan terbalik, polling).
async function syncOrder(order: Order) {
  const tx = await getTransactionStatus(order.id);
  if (!tx) return; // customer belum memilih metode bayar

  if (Number(tx.gross_amount) !== order.grossAmount) {
    console.error(`[midtrans] nominal tidak cocok untuk ${order.id}: db=${order.grossAmount} midtrans=${tx.gross_amount}`);
    return;
  }

  const next = mapStatus(tx.transaction_status, tx.fraud_status);

  db.update(orders)
    .set({
      transactionStatus: tx.transaction_status,
      fraudStatus: tx.fraud_status ?? null,
      paymentType: tx.payment_type ?? null,
      midtransTransactionId: tx.transaction_id ?? null,
      updatedAt: now(),
    })
    .where(eq(orders.id, order.id))
    .run();

  // Update bersyarat: hanya satu pemanggilan (webhook / polling) itu yang "menang"
  const changed = db
    .update(orders)
    .set({ status: next, ...(next === "paid" ? { paidAt: now() } : {}) })
    .where(and(eq(orders.id, order.id), ne(orders.status, next)))
    .returning({ id: orders.id })
    .all();

  if (changed.length > 0 && next === "paid") await onPaid({ ...order, status: "paid " });
}

function parseOrderInput(b: any) {
  const firstName = String(b?.firstName ?? "").trim();
    const lastName = String(b?.lastName ?? "").trim();
    const email = String(b?.email ?? "").trim();
    const phone = String(b?.phone ?? "").replace(/[\s-]/g, "");
    const grossAmount = b?.grossAmount;
   
    if (!firstName) return { error: "First name wajib diisi" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email tidak valid" };
    // Aturan nomor telepon untuk VA BNI: diawali +62 atau 0, maksimal 30 karakter
    if (!/^(\+62|0)\d{6,28}$/.test(phone)) return { error: "Phone harus diawali 0 atau +62" };
    if (!Number.isInteger(grossAmount) || grossAmount < MIN_AMOUNT || grossAmount > MAX_AMOUNT) {
      return { error: `Gross amount harus bilangan bulat ${MIN_AMOUNT}-${MAX_AMOUNT}` };
    }
    return { value: { firstName, lastName, email, phone, grossAmount: grossAmount as number } };
}

// 1) Konfigurasi publik untuk frontend
app.get("/api/config", (c) =>
  c.json
    ({
      clientKey: CLIENT_KEY,
      snapJsUrl: SNAP_JS_URL,
      isProduction: IS_PRODUCTION
    }),
);

// 2) Buat order + Snap token
app.post("/api/orders", async (c) => {
  const parsed = parseOrderInput(await c.req.json().catch(() => null));
  if (!parsed.value)
    return c.json({ error: parsed.error }, 400);
  const v = parsed.value;

  // order_id: maks 50 karakter, hanya - _ ~ . dan alfanumerik, harus unik
  const orderId = `ORDER-${crypto.randomUUID()}`;
  db.insert(orders).values({ id: orderId, ...v }).run();

  try {
    const snap = await createSnapTransaction({
      transaction_details: { order_id: orderId, gross_amount: v.grossAmount },
      // Jumlah item_details harus persis sama dengan gross_amount
      item_details: [
        { id: "TEST-ITEM", price: v.grossAmount, quantity: 1, name: "Testing Payment" },
      ],
      customer_details: {
        // Nama dipotong 30 karakter agar aman untuk VA BCA
        first_name: v.firstName.slice(0, 30),
        last_name: v.lastName.slice(0, 30) || undefined,
        email: v.email,
        phone: v.phone,
      },
    });
    db.update(orders)
      .set({ snapToken: snap.token, redirectUrl: snap.redirect_url, updatedAt: now() })
      .where(eq(orders.id, orderId))
      .run();
    return c.json({ orderId, snapToken: snap.token, redirectUrl: snap.redirect_url });
  } catch (e) {
    console.error(e);
    db.update(orders)
      .set({ status: "failed", updatedAt: now() })
      .where(eq(orders.id, orderId))
      .run();
    return c.json({ error: "Gagal membuat pembayaran" }, 502);
  }
});

// 3) Cek status order (dipolling di frontend)
const lastSync = new Map<string, number>();
app.get("/api/orders/:id", async (c) => {
  const id = c.req.param("id");
  let order = getOrder(id);
  if (!order) return c.json({ error: "Not found" }, 404);

  // Jaga-jaga kalau notifikasi telat/hilang: sinkron ke Midtrans maksimal tiap 10 detik (heartbeat).
  if (order.status === "pending" && Date.now() - (lastSync.get(id) ?? 0) > 10_000) {
    lastSync.set(id, Date.now());
    try {
      await syncOrder(order);
      order = getOrder(id) ?? order;
    } catch (e) {
      console.error(e);
    }
  }
  return c.json({
    id: order.id,
    status: order.status,
    grossAmount: order.grossAmount,
    paymentType: order.paymentType,
    snapToken: order.status === "pending" ? order.snapToken : null,
    redirectUrl: order.redirectUrl,
  });
});

// 4) Notifikasi dari Midtrans (isi URL ini di Settings -> Payment -> Notification URL -> Payment notification URL)
app.post("/webhook/midtrans", async (c) => {
  const body: any = await c.req.json().catch(() => null);

  if (!isValidSignature(body)) return c.text("Invalid signature", 403);

  const order = getOrder(body.order_id);
  // Order tak dikenal (contoh: tombol test notification di dashboard) akan dibalas 200 agar tidak di-retry
  if (!order) return c.json({ ok: true, ignored: true });

  try {
    await syncOrder(order);
  } catch (e) {
    console.error(e);
    return c.text("Temporary error, midtrans will retry", 503); // Midtrans akan retry
  }
  return c.json({ ok: true });
})

export { app };

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
}
