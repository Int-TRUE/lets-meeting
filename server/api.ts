import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import { configureTransactionAdapter, localService } from '../src/data/previewService';
import { decodeWire, encodeWire } from '../src/data/wire';
import { openDemoDatabase } from './database';
export function demoDatabasePlugin(): Plugin {
  return {
    name: 'robot-butler-sqlite',
    async configureServer(server) {
      if (process.env.VITE_DATA_MODE === 'fixture') return;
      const db = openDemoDatabase(
        resolve(process.env.ROBOT_BUTLER_DB ?? 'data/robot-butler.sqlite'),
      );
      await db.seed();
      configureTransactionAdapter(db.transaction);
      server.httpServer?.once('close', () => db.close());
      server.middlewares.use('/api/demo', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const send = (status: number, value: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(value));
        };
        // Local demo only: never expose this actor-switching API on a public host.
        const host = req.headers.host ?? '';
        if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
          return send(403, { error: '로컬 데모 전용 API입니다.' });
        if (req.headers.origin && new URL(req.headers.origin).host !== host)
          return send(403, { error: '허용되지 않은 요청 출처입니다.' });
        if (req.method === 'GET' && req.url === '/directory')
          return send(200, { people: db.directory(), rooms: db.rooms() });
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json'))
          return send(405, { error: 'JSON POST가 필요합니다.' });
        const method = (req.url ?? '').slice(1);
        if (!Object.hasOwn(localService, method))
          return send(404, { error: '지원하지 않는 요청입니다.' });
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) throw Error('데모 첨부 요청은 16MB 이하여야 합니다.');
            chunks.push(Buffer.from(chunk));
          }
          const args = decodeWire(JSON.parse(Buffer.concat(chunks).toString()));
          if (!Array.isArray(args) || typeof args[0] !== 'string')
            throw Error('사용자와 요청 정보를 확인해주세요.');
          const fn = localService[method as keyof typeof localService] as (
            ...args: any[]
          ) => Promise<unknown>;
          const result = await fn(...args);
          return send(200, { result: await encodeWire(result) });
        } catch (e) {
          return send(400, { error: e instanceof Error ? e.message : 'DB 요청 실패' });
        }
      });
    },
  };
}
