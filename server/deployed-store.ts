import { openPostgresDatabase } from './postgres.js';
let database: ReturnType<typeof openPostgresDatabase> | undefined;
export async function deployedStore() {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED)
    throw new Error('DATABASE_URL is not configured.');
  database ??= openPostgresDatabase(process.env.DATABASE_URL);
  await database.seed();
  return database;
}
