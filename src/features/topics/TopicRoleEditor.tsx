import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { Person, Role } from '../../domain/models';
import { previewService } from '../../data/previewService';
import { Button } from '../../components/ui';
import { PeoplePicker } from '../../components/workflow-ui';
import './topic-roles.css';

export function TopicRoleEditor({
  topicId,
  user,
  roles,
  onChange,
  disabled,
  onReady,
}: {
  topicId?: string;
  user: Person;
  roles: Record<string, Role>;
  onChange: (roles: Record<string, Role>) => void;
  disabled: boolean;
  onReady: (ready: boolean) => void;
}) {
  const [members, setMembers] = useState<Person[]>([user]);
  const [loading, setLoading] = useState(Boolean(topicId));
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!topicId) {
      onReady(true);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    onReady(false);
    previewService
      .topicPeople(user.id, topicId)
      .then((result) => {
        if (active) {
          setMembers(result);
          onReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '참가자를 불러오지 못했어요.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [topicId, user.id, retry, onReady]);
  function changeMembers(role: 'Master' | 'Attendee', ids: string[]) {
    if (disabled) return;
    const next = { ...roles };
    for (const [id, currentRole] of Object.entries(next)) {
      if (currentRole === role && !ids.includes(id)) delete next[id];
    }
    for (const id of ids) {
      if (next[id] !== 'Owner') next[id] = role;
    }
    onChange(next);
  }
  return (
    <div className="topic-role-editor" aria-label="토픽 참가자 권한 설정">
      {loading ? (
        <p role="status">토픽 참가자를 불러오는 중이에요.</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <Button type="button" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </Button>
        </div>
      ) : (
        <>
          <div className="topic-participants-heading">
            <h3 className="topic-participants-title">토픽 참가자</h3>
            <div className="topic-owner" aria-label="Owner">
              <span>
                {members.find((person) => roles[person.id] === 'Owner')?.name ?? user.name}
              </span>
              <span className="topic-owner-badge">
                Owner <LockKeyhole size={14} aria-label="잠금" />
              </span>
            </div>
          </div>
          {(['Master', 'Attendee'] as const).map((role) => (
            <section className="topic-role-section" key={role}>
              <PeoplePicker
                label={role}
                labelDescription={
                  role === 'Master'
                    ? '토픽의 모든 회의 조회 · 회의 생성'
                    : '개별 회의에 참가자로 추가된 경우에만 조회'
                }
                people={members}
                value={Object.keys(roles).filter((id) => roles[id] === role)}
                disabled={disabled}
                excludedIds={Object.keys(roles).filter((id) => roles[id] === 'Owner')}
                onChange={(ids) => changeMembers(role, ids)}
              />
            </section>
          ))}
        </>
      )}
      <p className="topic-role-description">
        다른 권한 영역에서 같은 사람을 추가하면 해당 권한으로 이동합니다.
      </p>
    </div>
  );
}
