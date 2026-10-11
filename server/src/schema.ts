/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
] as const;

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), // = order_id di Midtrans
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  grossAmount: integer("gross_amount").notNull(),
  status: text("status",
    { enum: ORDER_STATUSES }).notNull().default("pending"),
  snapToken: text("snap_token"),
  redirectUrl: text("redirect_url"),
  // Diisi dari API status Midtrans
  midtransTransactionId: text("midtrans_transaction_id"),
  paymentType: text("payment_type"),
  transactionStatus: text("transaction_status"), // nilai mentah Midtrans (settlement, pending, dst...)
  fraudStatus: text("fraud_status"),
  paidAt: integer("paid_at"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Order = typeof orders.$inferSelect;
export type OrderStatus = Order["status"];