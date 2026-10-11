/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */
// service layer 'server/mayar.ts'

import { createHash, timingSafeEqual } from "node:crypto"
import type { OrderStatus } from "./schema";

export const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY ?? "";
export const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY ?? "";

// Sandbox: app.sandbox.midtrans.com (Snap) & api.sandbox.midtrans.com (status API).
// Production mengikuti pola yang sama (app.midtrans.com / api.midtrans.com).
// MIDTRANS_SNAP_BASE / MIDTRANS_API_BASE hanya untuk override (mis. mock saat testing).
const SNAP_BASE = process.env.MIDTRANS_SNAP_BASE ??
  (IS_PRODUCTION ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
const API_BASE = process.env.MIDTRANS_API_BASE ??
  (IS_PRODUCTION ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");

export const SNAP_JS_URL = `${SNAP_BASE}/snap/snap.js`;

if (!SERVER_KEY || !CLIENT_KEY) {
  console.warn("[WARN] MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY belum diisi.")
} else if (!IS_PRODUCTION && !SERVER_KEY.startsWith("SB-")) {
  console.warn("[WARN] Mode sandbox aktif, tapi server key tidak berawalan 'SB-'. Cek kembali key-nya.");
}

// Basic Auth: Base64(SERVER_KEY + ":"), password kosong
const headers = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: "Basic " + Buffer.from(`${SERVER_KEY}`).toString("base64"),
})

// ---------- Snap: buat token ----------
export type SnapTransactionInput = {
  transaction_details: {
    order_id: string;
    gross_amount: number;
  };
  item_details: {
    id: string;
    price: number;
    quantity: number;
    name: string }[];
  customer_details: {
    first_name: string;
    last_name?: string;
    email: string;
    phone: string;
  }
}

export async function createSnapTransaction(input: SnapTransactionInput) {
  const res = await fetch(`${SNAP_BASE}/snap/v1/transactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    const msg = Array.isArray(body.error_messages) ?
      body.error_messages.join("; ") :
      (body.status_message ?? "unknown error");
    throw new Error(`Midtrans Snap ${res.status} ${msg}`);
  }
  return body as {
    token: string;
    redirect_url: string
  };
}

// ---------- Status API ----------
export type MidtransStatus = {
  order_id: string;
  transaction_id?: string;
  transaction_status: string;
  fraud_status?: string;
  status_code: string;
  gross_amount: string; // mis. "10000.00"
  payment_type?: string;
}

/** null = transaksi belum ada di Midtrans (customer belum memilih metode bayar) */
export async function getTransactionStatus(orderId: string): Promise<MidtransStatus | null> {
  const res = await fetch(`${API_BASE}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: headers(),
  });
  const body: any = await res.json().catch(() => ({}));
  // "Not found" bisa lewat HTTP status atau status_code di body
  if (res.status === 404 || String(body.status_code) === "404") return null;
  if (!res.ok || !body.transaction_status) {
    throw new Error(`Midtrans status ${res.status}: ${body.status_message ?? "unknown error"}`);
  }
  return body as MidtransStatus;
}

// ---------- Notifikasi (webhook) ----------

/** signature_key = SHA512(order_id + status_code + gross_amount + ServerKey) */
export function isValidSignature(n: any): boolean {
  const { order_id, status_code, gross_amount, signature_key } = n ?? {};
  if ([order_id, status_code, gross_amount, signature_key].some((v) => typeof v !== "string")) {
    return false;
  }
  const expected = createHash("sha512")
    .update(order_id + status_code + gross_amount + SERVER_KEY)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature_key);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Mapping status ----------
const STATUS_MAP: Record<string, OrderStatus> = {
  settlement: "paid",
  pending: "pending",
  authorize: "pending",
  deny: "failed",
  failure: "failed",
  cancel: "cancelled",
  expire: "expired",
  refund: "refunded",
  partial_refund: "refunded",
  chargeback: "refunded",
  partial_chargeback: "refunded",
}
export function mapStatus(transactionStatus: string, fraudStatus?: string): OrderStatus {
  if (transactionStatus === "capture") {
    if (!fraudStatus || fraudStatus === "accept") return "paid";
    return fraudStatus === "deny" ? "failed" : "pending";
  }

  const status = STATUS_MAP[transactionStatus];

  if (status !== undefined) return status;
  
  console.warn("[midtrans] transaction_status tak dikenal:", transactionStatus);
  
  return "pending";
}
