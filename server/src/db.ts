/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const sqlite = new Database(process.env.DB_FILE ?? "app.db");
sqlite.run("PRAGMA journal_mode = WAL;") // dibuka dari GUI saat server jalan

export const db = drizzle(sqlite, { schema });