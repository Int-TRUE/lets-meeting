import { TopicRoleEditor } from './TopicRoleEditor';
import type { Role } from '../../domain/models';
import { HistorySelect } from './HistorySelect';
import './meeting-history.css';
import { createId } from '../../domain/id';
import { MeetingSummary } from '../../components/MeetingSummary';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Settings } from 'lucide-react';
import { useUnsavedChanges, useWorkspace } from '../../app/WorkspaceContext';
import { previewService } from '../../data/previewService';
import { canCreateMeeting } from '../../domain/workflows';
import { dateKey, fullDate, meetingStatus, time } from '../../domain/selectors';
import {
  AvatarGroup,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  StatusBadge,
} from '../../components/ui';
import { TopicCard } from '../../components/TopicCard';
import {
  ConfirmDialog,
  Denied,
  FormMessage,
  PageHeading,
  TextareaField,
} from '../../components/workflow-ui';
export function TopicsPage() {
  const { data } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const topics = data.topics.filter(
    (t) =>
      filter === 'all' ||
      (filter === 'managed'
        ? t.roles[data.user.id] !== 'Attendee'
        : t.roles[data.user.id] === 'Attendee'),
  );
  return (
    <div className="workflow-page topics-page">
      <PageHeading
        title="토픽"
        description="우리 팀의 이야기를 관리하고, 관련 회의를 이어가세요."
        actions={
          <Link to="/topics/new" className="button button-primary">
            <Plus size={18} />
            토픽 만들기
          </Link>
        }
      />
      <div className="line-tabs" role="group" aria-label="토픽 필터">
        {[
          ['all', '전체'],
          ['managed', '관리 중'],
          ['joined', '참여 중'],
        ].map(([key, text]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setParams({ filter: key })}
          >
            {text}
            <span>
              {
                data.topics.filter(
                  (t) =>
                    key === 'all' ||
                    (key === 'managed'
                      ? t.roles[data.user.id] !== 'Attendee'
                      : t.roles[data.user.id] === 'Attendee'),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {topics.length ? (
        <div className="topic-list">
          {topics.map((t) => (
            <TopicCard topic={t} data={data} key={t.id} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title={data.topics.length ? '이 조건에 맞는 토픽이 없어요' : '참여 중인 토픽이 없어요'}
            description="새로운 주제를 만들고 좋은 대화를 시작해보세요."
          />
        </Card>
      )}
    </div>
  );
}
export function TopicForm({ editing = false }: { editing?: boolean }) {
  const { data, run } = useWorkspace();
  const { id } = useParams();
  const navigate = useNavigate();
  const topic = data.topics.find((t) => t.id === id);
  const [title, setTitle] = useState(editing ? (topic?.title ?? '') : '');
  const [description, setDescription] = useState(editing ? (topic?.description ?? '') : '');
  const initialRoles = useRef<Record<string, Role>>(
    editing && topic ? { ...topic.roles } : { [data.user.id]: 'Owner' },
  );
  const [roles, setRoles] = useState<Record<string, Role>>(initialRoles.current);
  const [rolesReady, setRolesReady] = useState(!editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const requestId = useRef(createId());
  const dirty =
    title !== (editing ? (topic?.title ?? '') : '') ||
    description !== (editing ? (topic?.description ?? '') : '') ||
    JSON.stringify(roles) !== JSON.stringify(initialRoles.current);
  const allowLeave = useUnsavedChanges(dirty);
  if (editing && (!topic || topic.roles[data.user.id] !== 'Owner')) return <Denied />;
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else navigate(editing ? `/topics/${id}` : '/topics');
  }
  async function save() {
    if (busy || (editing && !rolesReady)) return;
    if (!title.trim() || !description.trim()) {
      setError('주제명과 한줄 설명을 입력해주세요.');
      document.getElementById('topic-title')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = {
        title,
        description,
        roles,
        managerIds: Object.keys(roles).filter((pid) => roles[pid] !== 'Attendee'),
      };
      const topicId = await run(() =>
        editing
          ? previewService.updateTopic(data.user.id, id!, {
              ...input,
              roles,
              expectedRoles: initialRoles.current,
            })
          : previewService.createTopic(data.user.id, input, requestId.current),
      );
      allowLeave();
      navigate(`/topics/${topicId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  const form = (
    <form
      className="stack-form topic-editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field
        label="주제명"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        id="topic-title"
      />
      <TextareaField
        label="한줄 설명"
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TopicRoleEditor
        topicId={editing ? id : undefined}
        user={data.user}
        roles={roles}
        onChange={setRoles}
        disabled={busy}
        onReady={setRolesReady}
      />
      <FormMessage error={error} />
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>
          취소
        </Button>
        <Button type="submit" loading={busy} disabled={editing && !rolesReady}>
          {editing ? '변경 저장' : '토픽 만들기'}
        </Button>
      </div>
    </form>
  );
  return (
    <>
      {editing ? (
        <div className="workflow-page topic-settings-page">
          <PageHeading
            title="토픽 설정"
            description="주제 정보와 토픽 참가자의 권한을 관리하세요."
            crumbs={[{ label: topic!.title, to: `/topics/${id}` }]}
          />
          <div className="settings-grid">
            <Card>{form}</Card>
            <Card className="policy-card">
              <h2>권한 안내</h2>
              <dl>
                <dt>Owner · 소유자</dt>
                <dd>토픽 정보·관리자 수정, 전체 회의 조회와 관리</dd>
                <dt>Master · 회의 관리자</dt>
                <dd>전체 회의 조회, 회의 생성, 자신이 만든 회의 수정</dd>
                <dt>Attendee · 참가자</dt>
                <dd>본인이 초대된 회의만 조회</dd>
              </dl>
              <h3>Owner 위임·토픽 삭제</h3>
              <p className="muted">위임 후 역할과 하위 회의 보존 정책 확정 후 제공됩니다.</p>
              <Button variant="secondary" disabled>
                Owner 위임 준비 중
              </Button>
              <Button variant="secondary" disabled>
                토픽 삭제 준비 중
              </Button>
            </Card>
          </div>
        </div>
      ) : (
        <Modal
          className="topic-form-modal"
          title="새로운 토픽 만들기"
          description="한 가지 주제로 회의를 이어가는 우리 팀의 공간입니다."
          onClose={close}
        >
          {form}
        </Modal>
      )}
      {discard ? (
        <ConfirmDialog
          title="입력을 닫을까요?"
          description="저장하지 않은 토픽 입력은 사라집니다."
          actionLabel="저장하지 않고 나가기"
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            allowLeave();
            navigate(editing ? `/topics/${id}` : '/topics');
          }}
        />
      ) : null}
    </>
  );
}
export function TopicDetail() {
  const [historyParams, setHistoryParams] = useSearchParams();
  const selectedId = historyParams.get('meeting');
  const query = historyParams.get('historySearch') ?? '';
  const searchBy = historyParams.get('historyBy') ?? 'all';
  const year = historyParams.get('historyYear') ?? 'all';
  const order = historyParams.get('historyOrder') ?? 'desc';
  const compact = historyParams.get('historyView') !== 'list';
  const timeline = useRef<HTMLOListElement>(null);
  function updateHistory(key: string, value: string) {
    // Read the committed URL so rapid input cannot restore an older filter snapshot.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'meeting' && key !== 'historyView') next.delete('meeting');
    setHistoryParams(next, { replace: true, flushSync: true });
  }
  const { data } = useWorkspace();
  const { id } = useParams();
  const topic = data.topics.find((t) => t.id === id);
  if (!topic) return <Denied />;
  const meetings = data.meetings
    .filter((m) => m.topicId === id)
    .sort(
      (a, b) => (Date.parse(a.start) - Date.parse(b.start)) * (compact || order === 'asc' ? 1 : -1),
    );
  const manager = canCreateMeeting(topic, data.user.id);
  const years = [...new Set(meetings.map((m) => dateKey(m.start).slice(0, 4)))].sort().reverse();
  const names = new Map(data.people.map((person) => [person.id, person.name]));
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  const filtered = meetings.filter((meeting) => {
    if (compact) return true;
    if (year !== 'all' && dateKey(meeting.start).slice(0, 4) !== year) return false;
    const fields = {
      title: meeting.title,
      host: `${meeting.hostAtTime ?? ''} ${names.get(meeting.creatorId) ?? ''}`,
      participant: meeting.participantIds.map((pid) => names.get(pid) ?? '').join(' '),
    };
    const text =
      searchBy === 'title'
        ? fields.title
        : searchBy === 'host'
          ? fields.host
          : searchBy === 'participant'
            ? fields.participant
            : Object.values(fields).join(' ');
    return text.normalize('NFKC').toLocaleLowerCase().includes(needle);
  });
  const selected = filtered.find((meeting) => meeting.id === selectedId) ?? filtered[0];
  return (
    <div className="workflow-page topic-detail-page">
      <PageHeading
        title={topic.title}
        description={topic.description}
        crumbs={[{ label: '토픽', to: '/topics' }]}
        actions={
          <>
            {topic.roles[data.user.id] === 'Owner' ? (
              <Link className="button button-secondary" to={`/topics/${id}/settings`}>
                <Settings size={17} />
                토픽 설정
              </Link>
            ) : null}
            {manager ? (
              <Link
                className="button button-primary"
                to={`/topics/${id}/meetings/new`}
                onClick={() => {
                  // An explicit create action starts a new request, not an older draft.
                  try {
                    sessionStorage.removeItem(`robot-butler:draft:v1:${data.user.id}:new:${id}`);
                  } catch {
                    /* Draft persistence is optional. */
                  }
                }}
              >
                <Plus size={18} />
                회의 만들기
              </Link>
            ) : null}
          </>
        }
      />
      <div className="topic-overview">
        <span className="badge status-scheduled">{topic.roles[data.user.id]}</span>
        <span className="muted">
          회의 관리자 ·{' '}
          {Object.keys(topic.roles)
            .filter((pid) => topic.roles[pid] !== 'Attendee')
            .map((pid) => data.people.find((p) => p.id === pid)?.name)
            .filter(Boolean)
            .join(', ')}
        </span>
        <div className="history-view-switch" role="group" aria-label="히스토리 보기 방식">
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => updateHistory('historyView', 'compact')}
          >
            간략히 보기
          </button>
          <button
            type="button"
            aria-pressed={!compact}
            onClick={() => updateHistory('historyView', 'list')}
          >
            리스트로 보기
          </button>
        </div>
      </div>
      <section className="meeting-history" aria-label="회의 히스토리">
        <div className="history-toolbar">
          <div className="history-heading-row">
            <h2>
              회의 히스토리{' '}
              <span className="section-note" role="status">
                {filtered.length}건
              </span>
            </h2>

            {compact && meetings.length ? (
              <div className="history-scroll-actions">
                <span>회의를 좌우로 넘겨보세요</span>
                <button
                  type="button"
                  aria-label="이전 회의 카드"
                  onClick={() =>
                    timeline.current?.scrollBy({
                      left: -(timeline.current.clientWidth * 0.8),
                      behavior: 'smooth',
                    })
                  }
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label="다음 회의 카드"
                  onClick={() =>
                    timeline.current?.scrollBy({
                      left: timeline.current.clientWidth * 0.8,
                      behavior: 'smooth',
                    })
                  }
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            ) : null}
            {!compact && meetings.length ? (
              <div className="history-filters">
                <HistorySelect
                  label="검색 조건"
                  value={searchBy}
                  onChange={(value) => updateHistory('historyBy', value)}
                  options={[
                    { value: 'all', label: '전체' },
                    { value: 'title', label: '회의명' },
                    { value: 'host', label: '주최자' },
                    { value: 'participant', label: '참가자' },
                  ]}
                />
                <label className="history-search">
                  검색어
                  <input
                    type="search"
                    key={id}
                    defaultValue={query}
                    placeholder="회의명·주최자·참가자 검색"
                    onChange={(e) => updateHistory('historySearch', e.target.value)}
                  />
                </label>
                <HistorySelect
                  label="연도"
                  value={year}
                  onChange={(value) => updateHistory('historyYear', value)}
                  options={[
                    { value: 'all', label: '전체 연도' },
                    ...years.map((value) => ({ value, label: `${value}년` })),
                  ]}
                />
                <HistorySelect
                  label="정렬"
                  value={order}
                  onChange={(value) => updateHistory('historyOrder', value)}
                  options={[
                    { value: 'desc', label: '최신순' },
                    { value: 'asc', label: '오래된순' },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </div>
        {filtered.length ? (
          <div className={`history-layout${compact ? ' is-compact' : ''}`}>
            {!compact ? (
              <h3 className="history-first-year">{dateKey(filtered[0].start).slice(0, 4)}년</h3>
            ) : null}
            <ol
              ref={timeline}
              className={compact ? 'meeting-flow history-flow' : 'history-timeline'}
              aria-label="회의 히스토리 카드"
              tabIndex={compact ? 0 : undefined}
            >
              {filtered.map((m, index) => (
                <li key={m.id}>
                  {!compact &&
                  index > 0 &&
                  dateKey(filtered[index - 1].start).slice(0, 4) !==
                    dateKey(m.start).slice(0, 4) ? (
                    <h3 className="history-year">{dateKey(m.start).slice(0, 4)}년</h3>
                  ) : null}
                  <button
                    type="button"
                    className={`card history-card flow-${meetingStatus(m, data.now)}${selected?.id === m.id ? ' is-selected' : ''}`}
                    aria-pressed={selected?.id === m.id}
                    aria-controls={`history-detail-${topic.id}`}
                    aria-label={`${m.title} 회의 정보 보기`}
                    onClick={() => updateHistory('meeting', m.id)}
                  >
                    {compact ? (
                      <>
                        <StatusBadge status={meetingStatus(m, data.now)} />
                        <span className="history-title">{m.title}</span>
                        <span className="history-datetime">
                          <span className="history-date">
                            <CalendarDays size={16} aria-hidden="true" />
                            {fullDate(m.start)}
                          </span>
                          <span className="history-time">
                            {time(m.start)} – {time(m.end)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="history-date">
                          {fullDate(m.start)} · {time(m.start)}
                        </span>
                        <span className="history-title">{m.title}</span>
                        <StatusBadge status={meetingStatus(m, data.now)} />
                      </>
                    )}
                    <span className="history-host">
                      {m.hostAtTime ?? names.get(m.creatorId) ?? '주최자 정보 없음'}
                    </span>
                    {!compact && m.files.length ? (
                      <span className="history-files-count">자료 {m.files.length}개</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ol>
            <section
              id={`history-detail-${topic.id}`}
              className="card history-detail-panel"
              aria-label="선택한 회의 상세"
            >
              {selected ? (
                <>
                  <div className="history-panel-heading">
                    <div>
                      <span className="history-panel-eyebrow">선택한 회의</span>
                      <h2>{selected.title}</h2>
                    </div>
                    <Link to={`/meetings/${selected.id}`} className="button button-secondary">
                      회의 상세 보기
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                  <div className="history-meeting-info">
                    <div className="history-info-meta">
                      <StatusBadge status={meetingStatus(selected, data.now)} />
                      <span>
                        <CalendarDays size={16} aria-hidden="true" />
                        {fullDate(selected.start)} · {time(selected.start)}–{time(selected.end)}
                      </span>
                      <span>
                        <MapPin size={16} aria-hidden="true" />
                        {selected.room}
                      </span>
                    </div>
                    <p className="history-agenda">
                      {selected.description || '등록된 회의 안건이 없어요.'}
                    </p>
                    <div className="history-people">
                      <AvatarGroup
                        people={data.people.filter((person) =>
                          selected.participantIds.includes(person.id),
                        )}
                        max={5}
                      />
                      <span>참가자 {selected.participantIds.length}명</span>
                      <span>
                        주최자 ·{' '}
                        {selected.hostAtTime ??
                          data.people.find((person) => person.id === selected.creatorId)?.name}
                      </span>
                    </div>
                  </div>
                  <MeetingSummary key={selected.id} meeting={selected} />
                  {selected.files.length ? (
                    <div className="history-files">
                      <h3>회의 자료</h3>
                      <ul>
                        {selected.files.map((file, index) => (
                          <li key={`${file}-${index}`}>
                            <span>{file}</span>
                            <Link to={`/meetings/${selected.id}`}>
                              자료 보기
                              <ChevronRight size={16} aria-hidden="true" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="history-selection-empty">
                  <CalendarDays size={28} aria-hidden="true" />
                  <h3>회의 카드를 선택해주세요</h3>
                  <p>선택한 회의의 정보와 요약, 후속 작업을 여기에서 확인할 수 있어요.</p>
                </div>
              )}
            </section>
          </div>
        ) : (
          <Card>
            <EmptyState
              title={meetings.length ? '검색 결과가 없어요' : '아직 회의가 없어요'}
              description={
                meetings.length
                  ? '검색어나 검색 조건을 바꿔보세요.'
                  : manager
                    ? '첫 회의를 만들고 이야기를 시작해보세요.'
                    : '초대된 회의가 생기면 여기에서 볼 수 있어요.'
              }
            />
          </Card>
        )}
      </section>
    </div>
  );
}
