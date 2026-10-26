import {
  configureTransactionAdapter,
  localService,
  type TransactionAdapter,
} from '../src/data/previewService.js';
import { encodeWire, decodeWire } from '../src/data/wire.js';
import { RuleError } from '../src/domain/workflows.js';
import type { Person, Workspace } from '../src/domain/models.js';

export interface DemoStore {
  transaction: TransactionAdapter;
  directory(): unknown | Promise<unknown>;
  rooms(): unknown | Promise<unknown>;
}
export const MAX_API_BYTES = 3 * 1024 * 1024;

export async function handleDemoRequest(
  request: Request,
  getStore: () => Promise<DemoStore>,
  localOnly = false,
) {
  const json = (status: number, body: unknown) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const url = new URL(request.url);
  if (localOnly && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return json(403, { error: '로컬 데모 전용 API입니다.' });
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).origin !== url.origin)
      return json(403, { error: '허용되지 않은 요청 출처입니다.' });
    const method = url.searchParams.get('method') ?? url.pathname.replace(/^\/api\/demo\//, '');
    if (request.method === 'GET' && method === 'directory') {
      const db = await getStore();
      return json(200, {
        people: ((await db.directory()) as Person[]).filter((p) => p.isTestAccount),
        rooms: await db.rooms(),
      });
    }
    if (
      request.method !== 'POST' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return json(405, { error: 'JSON POST가 필요합니다.' });
    if (['meetingDelivery', 'adminLogs'].includes(method) || !Object.hasOwn(localService, method))
      return json(404, { error: '지원하지 않는 요청입니다.' });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_API_BYTES) {
          await reader.cancel();
          return json(413, { error: '첨부를 포함한 요청은 3MB 이하여야 합니다.' });
        }
        chunks.push(value);
      }
    const args = decodeWire(JSON.parse(Buffer.concat(chunks).toString()));
    if (!Array.isArray(args) || typeof args[0] !== 'string')
      return json(400, { error: '사용자와 요청 정보를 확인해주세요.' });
    const db = await getStore();
    configureTransactionAdapter(db.transaction);
    const fn = localService[method as keyof typeof localService] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let result = await fn(...args);
    // List/detail metadata must not transfer every attachment on each refresh.
    // Bytes are returned only by the separately permission-checked download command.
    if (method === 'snapshot') {
      const workspace = result as Workspace;
      result = {
        ...workspace,
        meetings: workspace.meetings.map((meeting) => ({
          ...meeting,
          attachments: meeting.attachments?.map(({ blob, ...metadata }) => ({
            ...metadata,
            downloadable: Boolean(blob),
          })),
        })),
      };
    }
    return json(200, { result: await encodeWire(result) });
  } catch (error) {
    if (error instanceof RuleError || error instanceof SyntaxError || error instanceof TypeError)
      return json(400, {
        error: error instanceof RuleError ? error.message : '요청 형식을 확인해주세요.',
      });
    // Never return database/connection errors containing credentials to the browser.
    return json(503, { error: 'DB에 연결하지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
}
