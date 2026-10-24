import { BellRing, Check, Clock3 } from 'lucide-react';
import { meetingReminderChoices } from '../domain/workflows';
export const reminderLabel = (minutes: number) =>
  minutes === 1440 ? '하루 전' : minutes === 60 ? '1시간 전' : `${minutes}분 전`;
export function ReminderSettings({
  value,
  onChange,
}: {
  value: number[];
  onChange: (minutes: number[]) => void;
}) {
  const enabled = value.length > 0;
  return (
    <section
      className={`reminder-settings${enabled ? ' is-enabled' : ''}`}
      aria-label="자동 리마인드 알람"
    >
      <div className="reminder-settings-header">
        <span className="reminder-settings-icon">
          <BellRing size={24} />
        </span>
        <div>
          <h3>회의 전에, 한 번 더 알려드릴게요</h3>
          <p>참가자 모두에게 매터모스트 DM으로 보내요.</p>
        </div>
        <label className="reminder-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="자동 리마인드 켜기"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? [30] : [])}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      {enabled ? (
        <div className="reminder-settings-body">
          <div className="reminder-choice-heading">
            <strong>언제 알려드릴까요?</strong>
            <span>여러 개 선택 가능</span>
          </div>
          <div className="reminder-choices">
            {meetingReminderChoices.map((minutes) => (
              <label
                key={minutes}
                className={`reminder-choice${value.includes(minutes) ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={value.includes(minutes)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...value, minutes] : value.filter((n) => n !== minutes),
                    )
                  }
                />
                <span>{reminderLabel(minutes)}</span>
                <Check size={16} aria-hidden="true" />
              </label>
            ))}
          </div>
          <p className="reminder-selection-note">
            <Clock3 size={16} />
            회의 시작{' '}
            {meetingReminderChoices
              .filter((n) => value.includes(n))
              .map(reminderLabel)
              .join(' · ')}
            에 발송
          </p>
          <small>하루 전은 24시간 전이에요. 모든 시간을 해제하면 알림이 꺼져요.</small>
        </div>
      ) : (
        <p className="reminder-off-note">
          지금은 자동 알림이 꺼져 있어요. 켜고 원하는 시간을 선택해보세요.
        </p>
      )}
    </section>
  );
}
