import { useEffect, useState } from 'react';
import { Crown, Network, Search, Users, User, X } from 'lucide-react';
import type { Person, Role } from '../../domain/models';
import { previewService } from '../../data/previewService';
import { PersonAvatar } from '../../components/PersonAvatar';
import { Button } from '../../components/ui';
import './topic-roles.css';
import { Dropdown } from '../../components/Dropdown';

function RoleIcon({ role }: { role: Role }) {
  const Icon = role === 'Owner' ? Crown : role === 'Master' ? Users : User;
  return <Icon size={18} aria-hidden="true" />;
}
export function TopicRoleEditor({
  topicId,
  user,
  roles,
  onChange,
  disabled,
  onReady,
}: {
  topicId: string;
  user: Person;
  roles: Record<string, Role>;
  onChange: (roles: Record<string, Role>) => void;
  disabled: boolean;
  onReady: (ready: boolean) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState(user.team);
  const [sort, setSort] = useState('mine');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    onReady(false);
    previewService
      .topicOrganization(user.id, topicId)
      .then((result) => {
        if (active) {
          setPeople(result);
          onReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '조직도를 불러오지 못했어요.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id, topicId, retry, onReady]);
  const teams = [...new Set(people.map((p) => p.team || '미지정부서'))].sort((a, b) =>
    sort === 'mine' && (a === user.team || b === user.team)
      ? a === user.team
        ? -1
        : 1
      : a.localeCompare(b, 'ko'),
  );
  const term = query.trim().toLocaleLowerCase('ko-KR');
  const shown = people.filter((p) =>
    term
      ? `${p.name} ${p.team} ${p.position ?? ''}`.toLocaleLowerCase('ko-KR').includes(term)
      : !team || (p.team || '미지정부서') === team,
  );
  function select(id: string, role?: Role) {
    if (disabled || roles[id] === 'Owner') return;
    const next = { ...roles };
    if (role) next[id] = role;
    else delete next[id];
    onChange(next);
  }
  return (
    <section className="topic-role-editor" aria-label="토픽 참가자 권한 설정">
      <h2>토픽 참가자</h2>
      <label className="role-search">
        <Search size={20} aria-hidden="true" />
        <input
          type="search"
          aria-label="이름, 팀, 직책으로 검색"
          placeholder="이름, 팀, 직책으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled || loading}
        />
      </label>
      <div className="role-selected" aria-label="선택한 토픽 구성원">
        {people
          .filter((p) => roles[p.id])
          .map((p) => (
            <span className="role-chip" key={p.id}>
              <PersonAvatar person={p} />
              <strong>{p.name}</strong>
              <span className={`topic-role role-${roles[p.id].toLowerCase()}`}>
                <RoleIcon role={roles[p.id]} />
                {roles[p.id]}
              </span>
              {roles[p.id] !== 'Owner' ? (
                <button
                  type="button"
                  aria-label={`${p.name} 토픽에서 제외`}
                  onClick={() => select(p.id)}
                  disabled={disabled}
                >
                  <X size={16} />
                </button>
              ) : null}
            </span>
          ))}
      </div>
      <div className="role-legend">
        <span>
          <span className="topic-role role-owner">
            <Crown size={18} />
            Owner
          </span>{' '}
          토픽 생성자 · 1명
        </span>
        <span>
          <span className="topic-role role-master">
            <Users size={18} />
            Master
          </span>{' '}
          회의 관리자
        </span>
        <span>
          <span className="topic-role role-attendee">
            <User size={18} />
            Attendee
          </span>{' '}
          일반 참가자
        </span>
      </div>
      <div className="organization-panel">
        <div className="organization-toolbar">
          <span>
            <Network size={20} />
            조직도
          </span>
          <Dropdown
            label="부서 정렬"
            value={sort}
            onChange={setSort}
            options={[
              {
                value: 'mine',
                label: '내 팀 우선',
                description: '내가 속한 팀을 맨 위로',
                icon: <Users size={18} />,
              },
              {
                value: 'name',
                label: '이름순',
                description: '부서 이름 가나다순',
                icon: <Network size={18} />,
              },
            ]}
          />
        </div>
        {loading ? (
          <p role="status" className="organization-message">
            조직도를 불러오는 중이에요.
          </p>
        ) : error ? (
          <div className="organization-message">
            <p role="alert">{error}</p>
            <Button type="button" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
              다시 시도
            </Button>
          </div>
        ) : (
          <div className="organization-columns">
            <nav className="organization-teams" aria-label="조직도 부서">
              <button
                type="button"
                aria-pressed={!team && !term}
                onClick={() => {
                  setTeam('');
                  setQuery('');
                }}
              >
                <Network size={18} />
                전체 조직<span>{people.length}명</span>
              </button>
              {teams.map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={team === name && !term}
                  onClick={() => {
                    setTeam(name);
                    setQuery('');
                  }}
                >
                  <Users size={18} />
                  <strong>{name}</strong>
                  {name === user.team && <small>내 팀</small>}
                  <span>{people.filter((p) => (p.team || '미지정부서') === name).length}명</span>
                </button>
              ))}
            </nav>
            <div className="organization-members">
              <h3>
                <Users size={20} />
                {term ? '검색 결과' : team || '전체 조직'} <span>({shown.length}명)</span>
              </h3>
              <div className="organization-table-wrap">
                <table className="organization-table">
                  <thead>
                    <tr>
                      <th scope="col">선택</th>
                      <th scope="col">이름</th>
                      <th scope="col">팀 · 직책</th>
                      <th scope="col">권한</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${p.name} 토픽 구성원`}
                            checked={Boolean(roles[p.id])}
                            disabled={disabled || roles[p.id] === 'Owner'}
                            onChange={(e) =>
                              select(p.id, e.target.checked ? 'Attendee' : undefined)
                            }
                          />
                        </td>
                        <td>
                          <span className="organization-person">
                            <PersonAvatar person={p} />
                            <strong>{p.name}</strong>
                          </span>
                        </td>
                        <td>
                          {p.team}
                          {p.position ? ` · ${p.position}` : ''}
                        </td>
                        <td>
                          <Dropdown
                            label={`${p.name} 권한`}
                            value={roles[p.id] ?? 'Attendee'}
                            tone={(roles[p.id] ?? 'Attendee').toLowerCase()}
                            disabled={disabled || roles[p.id] === 'Owner'}
                            onChange={(value) => select(p.id, value as Role)}
                            options={
                              roles[p.id] === 'Owner'
                                ? [
                                    {
                                      value: 'Owner',
                                      label: 'Owner',
                                      icon: <RoleIcon role="Owner" />,
                                    },
                                  ]
                                : [
                                    {
                                      value: 'Master',
                                      label: 'Master',
                                      description: '토픽의 모든 회의 조회 · 회의 생성',
                                      icon: <RoleIcon role="Master" />,
                                    },
                                    {
                                      value: 'Attendee',
                                      label: 'Attendee',
                                      description: '개별 회의에 초대된 경우만 조회',
                                      icon: <RoleIcon role="Attendee" />,
                                    },
                                  ]
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!shown.length && (
                <p className="organization-message">
                  {term
                    ? '검색 결과가 없어요. 이름, 팀, 직책을 다시 확인해주세요.'
                    : '이 부서에 등록된 직원이 없어요.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="info-notice">
        Owner와 Master는 이 토픽의 모든 회의를 볼 수 있습니다. Attendee는 토픽 구성원으로 등록한 뒤
        개별 회의에도 추가해야 볼 수 있습니다. 구성원을 제외하면 이 토픽의 회의 접근 권한을
        잃습니다.
      </p>
      <p className="muted">
        토픽 생성자는 Owner로 유지됩니다. 구성원 선택 시 Attendee로 추가되며, 권한을 Master로 변경할
        수 있습니다. 변경 저장을 누르면 반영됩니다.
      </p>
    </section>
  );
}
