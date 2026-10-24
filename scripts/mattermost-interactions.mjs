import { signInteraction, verifyInteraction } from '../server/mattermost.ts';

// This listener is reachable only on the private Compose network, with no host port.
// Signed, expiring tickets bind the action to the original recipient and bot post.
export function createInteractionHandler({ config, rpc, fetcher = fetch }) {
  async function mm(path, body) {
    const response = await fetcher(`${config.baseUrl}/api/v4${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('매터모스트에서 요청을 확인하지 못했어요.');
    return response.json();
  }
  return async (path, body) => {
    const dialog = path === '/dialog';
    if (!dialog && path !== '/action') throw new Error('잘못된 요청입니다.');
    const ticket = verifyInteraction(
      dialog ? body.state : body.context?.ticket,
      config.interaction.secret,
    );
    if (ticket.userId !== body.user_id || config.users[ticket.actor] !== body.user_id)
      throw new Error('알림 수신자만 사용할 수 있어요.');
    if (dialog !== (ticket.command === 'late')) throw new Error('잘못된 동작입니다.');
    const postId = dialog ? ticket.postId : body.post_id;
    const channelId = dialog ? ticket.channelId : body.channel_id;
    if (
      !/^[a-z0-9]{26}$/.test(postId ?? '') ||
      !/^[a-z0-9]{26}$/.test(channelId ?? '') ||
      body.channel_id !== channelId
    )
      throw new Error('알림을 확인할 수 없어요.');
    const post = await mm(`/posts/${postId}`);
    if (
      post.user_id !== config.botId ||
      post.channel_id !== channelId ||
      post.props?.robot_butler_delivery_id !== ticket.logId ||
      post.delete_at
    )
      throw new Error('원본 알림을 확인할 수 없어요.');
    const input = {
      action: 'interact',
      logId: ticket.logId,
      actor: ticket.actor,
      command: ticket.command,
    };
    if (ticket.command === 'options') {
      const result = await rpc(input);
      if (!result.participants?.length) return { ephemeral_text: '알림을 보낼 참가자가 없어요.' };
      await mm('/actions/dialogs/open', {
        trigger_id: body.trigger_id,
        url: config.interaction.url + '/dialog',
        dialog: {
          callback_id: 'robotbutlerlate',
          title: '지각자 알림',
          submit_label: '알림 보내기',
          introduction_text:
            '아직 도착하지 않은 참가자를 모두 선택해주세요. 같은 회의에서는 한 사람에게 한 번만 보냅니다.',
          state: signInteraction(
            { ...ticket, command: 'late', postId, channelId },
            config.interaction.secret,
          ),
          elements: [
            {
              display_name: '참가자',
              name: 'attendees',
              type: 'select',
              multiselect: true,
              optional: false,
              options: result.participants.map((p) => ({ text: p.name, value: p.id })),
            },
          ],
        },
      });
      return {};
    }
    if (dialog) {
      if (body.callback_id !== 'robotbutlerlate' || body.cancelled) return {};
      input.selected = body.submission?.attendees;
    } else if (ticket.command === 'reply') {
      const selected = body.context?.selected_option;
      if (!['0', '1', '2'].includes(selected)) throw new Error('응답을 선택해주세요.');
      input.reply = Number(selected);
    } else if (ticket.command === 'extend') input.minutes = ticket.minutes;
    else throw new Error('잘못된 동작입니다.');
    const result = await rpc(input);
    // A successful empty response closes the dialog. Ephemeral post creation requires
    // elevated Mattermost permissions; do not fail a committed queue request for it.
    if (dialog) return {};
    return { ephemeral_text: result.message };
  };
}

export function interactionListener(handler) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (
      request.method !== 'POST' ||
      !request.headers['content-type']?.startsWith('application/json')
    ) {
      response.writeHead(405).end('{}');
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) {
          response.writeHead(413).end('{}');
          return;
        }
        chunks.push(chunk);
      }
      const result = await handler(request.url, JSON.parse(Buffer.concat(chunks).toString()));
      response.end(JSON.stringify(result));
    } catch (error) {
      const message =
        error?.publicMessage ?? '요청을 처리하지 못했어요. 최신 회의와 연결 상태를 확인해주세요.';
      // Dialog errors retain the selection; message action errors are visible to the clicker.
      response.end(
        JSON.stringify(
          request.url === '/dialog'
            ? { errors: { attendees: message } }
            : { ephemeral_text: message },
        ),
      );
    }
  };
}
