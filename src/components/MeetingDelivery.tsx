import { useEffect, useState } from 'react';
import { previewService } from '../data/previewService';
import { useWorkspace } from '../app/WorkspaceContext';
import { Button } from './ui';
import type { DeliveryLog } from '../domain/models';
export const deliveryLabels: Record<DeliveryLog['result'], string> = {
  'not-connected': '미전송 · 미연결',
  pending: '발송 대기',
  sending: '발송 중',
  sent: '발송 완료',
  failed: '발송 실패',
  unknown: '결과 확인 필요',
};
export function MeetingDelivery({
  meetingId,
  revision = 0,
}: {
  meetingId: string;
  revision?: number;
}) {
  const { data } = useWorkspace();
  const [counts, setCounts] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setCounts(undefined);
    setError(false);
    void previewService
      .meetingDelivery(data.user.id, meetingId)
      .then((logs) => {
        if (!active) return;
        const values = Object.entries(deliveryLabels)
          .map(([key, label]) => {
            const count = logs.filter((log) => log.result === key).length;
            return count ? `${label} ${count}명` : '';
          })
          .filter(Boolean);
        setCounts(values.join(' · ') || '발송 기록 없음');
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [data.user.id, meetingId, revision, attempt]);
  return (
    <section aria-label="매터모스트 발송 결과">
      <h3>참가자 Mattermost 알림</h3>
      <p role="status">
        {error
          ? '발송 결과를 불러오지 못했어요. 회의 저장 결과와는 별개입니다.'
          : (counts ?? '발송 결과 확인 중…')}
      </p>
      <Button variant="text" onClick={() => setAttempt((value) => value + 1)}>
        발송 결과 새로고침
      </Button>
    </section>
  );
}
