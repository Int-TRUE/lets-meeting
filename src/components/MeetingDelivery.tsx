import { MessageCircle, RefreshCw, CheckCircle2, Clock3, AlertCircle, Unplug } from 'lucide-react';
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
  const [counts, setCounts] =
    useState<{ result: DeliveryLog['result']; label: string; count: number }[]>();
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
            return { result: key as DeliveryLog['result'], label, count };
          })
          .filter((item) => item.count > 0);
        setCounts(values);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [data.user.id, meetingId, revision, attempt]);
  return (
    <section className="delivery-panel" aria-label="매터모스트 발송 결과">
      <div className="delivery-heading">
        <span className="section-icon">
          <MessageCircle size={22} aria-hidden="true" />
        </span>
        <div>
          <h3>참가자 Mattermost 알림</h3>
          <p>참가자에게 보낸 알림의 발송 상태를 확인하세요.</p>
        </div>
        <Button
          variant="secondary"
          disabled={!counts && !error}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          발송 결과 새로고침
        </Button>
      </div>
      {error ? (
        <p className="delivery-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          발송 결과를 불러오지 못했어요. 회의 저장 결과와는 별개입니다.
        </p>
      ) : (
        <div className="delivery-results" role="status">
          {counts ? (
            counts.length ? (
              counts.map(({ result, label, count }) => {
                const Icon =
                  result === 'sent'
                    ? CheckCircle2
                    : result === 'pending' || result === 'sending'
                      ? Clock3
                      : result === 'not-connected'
                        ? Unplug
                        : AlertCircle;
                return (
                  <div key={result} className={`delivery-stat delivery-${result}`}>
                    <Icon size={20} aria-hidden="true" />
                    <span>
                      {label} <strong>{count}명</strong>
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="summary-empty">발송 기록 없음</p>
            )
          ) : (
            <p className="summary-empty">발송 결과 확인 중…</p>
          )}
        </div>
      )}
    </section>
  );
}
