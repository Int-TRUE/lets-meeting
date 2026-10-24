import { loadEnv, type Plugin } from 'vite';
import { createMattermostDelivery, mattermostConfig } from './mattermost';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { openDemoDatabase } from './database';
import { handleDemoRequest } from './http';
export function demoDatabasePlugin(): Plugin {
  return {
    name: 'robot-butler-sqlite',
    async configureServer(server) {
      if (process.env.VITE_DATA_MODE === 'fixture') return;
      const db = openDemoDatabase(
        resolve(process.env.ROBOT_BUTLER_DB ?? 'data/robot-butler.sqlite'),
      );
      await db.seed();
      const env = { ...loadEnv(server.config.mode, server.config.root, ''), ...process.env };
      const config = mattermostConfig(env);
      const delivery = config ? createMattermostDelivery(db.transaction, config) : undefined;
      if (delivery) await delivery.recover('taeheon');
      const store = { ...db, transaction: delivery?.transaction ?? db.transaction };
      server.httpServer?.once('close', () => db.close());
      server.middlewares.use('/api/demo', async (req, res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const init = {
          method: req.method,
          headers,
          ...(!['GET', 'HEAD'].includes(req.method ?? 'GET')
            ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' }
            : {}),
        };
        const request = new Request(
          `http://${req.headers.host ?? 'localhost'}/api/demo${req.url}`,
          init,
        );
        const response = await handleDemoRequest(request, async () => store, true);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}
