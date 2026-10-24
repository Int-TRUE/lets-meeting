import { handleDemoRequest } from '../server/http.js';
import { deployedStore } from '../server/deployed-store.js';
import { queueForRelay, relayConfig } from '../server/mattermost-relay.js';
export default {
  fetch: (request: Request) =>
    handleDemoRequest(request, async () => {
      const db = await deployedStore();
      const config = relayConfig();
      return {
        ...db,
        transaction: config ? queueForRelay(db.transaction, config) : db.transaction,
      };
    }),
};
