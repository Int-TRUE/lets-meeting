import { deployedStore } from '../server/deployed-store.js';
import { handleRelayRequest, relayConfig } from '../server/mattermost-relay.js';
export default {
  fetch: (request: Request) => {
    try {
      return handleRelayRequest(
        request,
        async () => (await deployedStore()).transaction,
        relayConfig(),
      );
    } catch {
      return Response.json({ error: '중계 설정을 확인해주세요.' }, { status: 503 });
    }
  },
};
