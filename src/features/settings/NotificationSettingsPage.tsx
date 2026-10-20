import { useEffect, useState } from 'react';
import { Bell, LockKeyhole } from 'lucide-react';
import type { NotificationSettings } from '../../domain/models';
import { defaultPreferences, reminderChoices } from '../../domain/workflows';
import { previewService } from '../../data/previewService';
import { useUnsavedChanges, useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card } from '../../components/ui';
import { FormMessage, PageHeading } from '../../components/workflow-ui';
export function NotificationSettingsPage() {
  const { data, run } = useWorkspace();
  const [settings, setSettings] = useState<NotificationSettings>(
    structuredClone(defaultPreferences),
  );
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useUnsavedChanges(Boolean(saved) && JSON.stringify(settings) !== saved);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void previewService
      .preferences(data.user.id)
      .then((value) => {
        if (active) {
          setSettings(value);
          setSaved(JSON.stringify(value));
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('알림 설정을 불러오지 못했어요. 다시 접속해주세요.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [data.user.id]);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await run(() => previewService.savePreferences(data.user.id, settings));
      setSaved(JSON.stringify(settings));
      setSuccess('이 브라우저에 알림 설정을 저장했어요. 외부 메시지는 전송되지 않습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-page">
      <PageHeading
        title="개인 알림 설정"
        description="회의와 관련된 중요한 소식을 원하는 방식으로 받아보세요."
      />
      <Card className="notification-channel">
        <span className="topic-icon tone-blue">
          <Bell size={26} />
        </span>
        <div>
          <h2>Mattermost</h2>
          <p className="muted">기본 알림 채널 · 미리보기에서는 실제 메시지가 전송되지 않습니다.</p>
        </div>
        <span className="badge status-scheduled">기본</span>
      </Card>
      <div className="settings-grid">
        <Card className="notification-preview">
          <h2>알림 대상 이벤트</h2>
          <p className="muted">회의 생성·변경·취소 알림은 항상 켜져 있습니다.</p>
          {['회의 생성·초대', '일시·장소 변경', '회의 취소'].map((label) => (
            <div key={label}>
              <span>{label}</span>
              <span className="locked-label">
                <LockKeyhole size={16} />
                필수 · 항상 켜짐
              </span>
            </div>
          ))}
          {[
            ['materials', '자료 등록·수정'],
            ['summary', '요약 완료'],
          ].map(([key, label]) => (
            <label className="switch-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                role="switch"
                disabled={loading || busy || !saved}
                checked={settings[key as 'materials' | 'summary']}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, [key]: e.target.checked }));
                  setSuccess('');
                }}
              />
            </label>
          ))}
        </Card>
        <Card>
          <h2>회의 전 리마인드</h2>
          <p className="muted">받고 싶은 시점을 선택하세요.</p>
          <fieldset className="reminder-options">
            <legend className="sr-only">리마인드 시점</legend>
            {reminderChoices.map((choice) => (
              <label key={choice}>
                <input
                  type="checkbox"
                  checked={settings.reminders.includes(choice)}
                  disabled={loading || busy || !saved}
                  onChange={(e) => {
                    setSettings((s) => ({
                      ...s,
                      reminders: e.target.checked
                        ? [...s.reminders, choice]
                        : s.reminders.filter((r) => r !== choice),
                    }));
                    setSuccess('');
                  }}
                />
                {choice}
              </label>
            ))}
          </fieldset>
          <p className="detail-note">방해금지·카카오톡·이메일은 추후 제공 범위입니다.</p>
        </Card>
      </div>
      <FormMessage error={error} success={success} />
      <div className="form-actions">
        <Button
          variant="secondary"
          disabled={busy || !saved}
          onClick={() => {
            setSettings(JSON.parse(saved));
            setSuccess('');
            setError('');
          }}
        >
          변경 취소
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={loading || !saved}>
          설정 저장
        </Button>
      </div>
    </div>
  );
}
