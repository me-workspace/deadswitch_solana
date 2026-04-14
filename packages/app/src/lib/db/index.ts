import { neon } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Cached Drizzle client instance.
 * In serverless environments each cold-start creates a new instance,
 * but within a single invocation the connection is reused.
 */
let _db: NeonHttpDatabase<typeof schema> | null = null;

/**
 * Returns a Drizzle ORM database client connected to the Neon PostgreSQL
 * instance specified by the `DATABASE_URL` environment variable.
 *
 * Uses the Neon HTTP driver (`@neondatabase/serverless`) which is optimized
 * for serverless / edge runtimes — no persistent TCP connections needed.
 *
 * @throws {Error} If `DATABASE_URL` is not set
 * @returns Drizzle database client with full schema typing
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Please configure it in your .env.local file."
    );
  }

  const sql = neon(databaseUrl);
  _db = drizzle(sql, { schema });
  return _db;
}

/**
 * Re-export the schema so consumers can import from a single module.
 */
export { schema };
export type { NeonHttpDatabase };
