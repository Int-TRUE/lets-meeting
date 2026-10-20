import { handleDemoRequest } from '../server/http.js';
import { openPostgresDatabase } from '../server/postgres.js';

let database: ReturnType<typeof openPostgresDatabase> | undefined;
async function getStore() {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED)
    throw new Error('DATABASE_URL is not configured.');
  database ??= openPostgresDatabase(process.env.DATABASE_URL);
  await database.seed();
  return database;
}
export default { fetch: (request: Request) => handleDemoRequest(request, getStore) };
