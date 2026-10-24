import { MeetingSummary } from '../../components/MeetingSummary';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronRight, Plus, Settings } from 'lucide-react';
import { useUnsavedChanges, useWorkspace } from '../../app/WorkspaceContext';
import { previewService } from '../../data/previewService';
import { canCreateMeeting } from '../../domain/workflows';
import { fullDate, time } from '../../domain/selectors';
import { Button, Card, EmptyState, Field, Modal } from '../../components/ui';
import { TopicCard } from '../../components/TopicCard';
import {
  ConfirmDialog,
  Denied,
  FormMessage,
  PageHeading,
  PeoplePicker,
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
        title="Topic"
        description="우리 팀의 이야기를 관리하고, 관련 회의를 이어가세요."
        actions={
          <Link to="/topics/new" className="button button-primary">
            <Plus size={18} />
            Topic 만들기
          </Link>
        }
      />
      <div className="line-tabs" role="group" aria-label="Topic 필터">
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
            title={
              data.topics.length ? '이 조건에 맞는 Topic이 없어요' : '참여 중인 Topic이 없어요'
            }
            description="새로운 주제를 만들고 좋은 대화를 시작해보세요."
          />
        </Card>
      )}
    </div>
  );
}
export function TopicForm({ editing = false }: { editing?: boolean }) {
  const { data, directory, run } = useWorkspace();
  const { id } = useParams();
  const navigate = useNavigate();
  const topic = data.topics.find((t) => t.id === id);
  const [title, setTitle] = useState(editing ? (topic?.title ?? '') : '');
  const [description, setDescription] = useState(editing ? (topic?.description ?? '') : '');
  const managers =
    editing && topic
      ? Object.keys(topic.roles).filter((pid) => topic.roles[pid] !== 'Attendee')
      : [data.user.id];
  const [managerIds, setManagerIds] = useState(managers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const dirty =
    title !== (editing ? (topic?.title ?? '') : '') ||
    description !== (editing ? (topic?.description ?? '') : '') ||
    managerIds.join() !== managers.join();
  const allowLeave = useUnsavedChanges(dirty);
  if (editing && (!topic || topic.roles[data.user.id] !== 'Owner')) return <Denied />;
  function close() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else navigate(editing ? `/topics/${id}` : '/topics');
  }
  async function save() {
    if (busy) return;
    if (!title.trim() || !description.trim()) {
      setError('주제명과 한줄 설명을 입력해주세요.');
      document.getElementById('topic-title')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = { title, description, managerIds };
      const topicId = await run(() =>
        editing
          ? previewService.updateTopic(data.user.id, id!, input)
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
      className="stack-form"
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
      <PeoplePicker
        label="회의 관리자"
        people={directory}
        value={managerIds}
        onChange={setManagerIds}
        lockedIds={editing ? managers : [data.user.id]}
      />
      <p className="info-notice">
        Topic을 만든 사람은 Owner가 됩니다. 선택한 회의 관리자는 Master 권한을 가집니다.
      </p>
      <FormMessage error={error} />
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>
          취소
        </Button>
        <Button type="submit" loading={busy}>
          {editing ? '변경 저장' : 'Topic 만들기'}
        </Button>
      </div>
    </form>
  );
  return (
    <>
      {editing ? (
        <div className="workflow-page topic-settings-page">
          <PageHeading
            title="Topic 설정"
            description="주제 정보와 회의 관리자를 관리하세요."
            crumbs={[{ label: topic!.title, to: `/topics/${id}` }]}
          />
          <div className="settings-grid">
            <Card>{form}</Card>
            <Card className="policy-card">
              <h2>권한 안내</h2>
              <dl>
                <dt>Owner · 소유자</dt>
                <dd>Topic 정보·관리자 수정, 전체 회의 조회와 관리</dd>
                <dt>Master · 회의 관리자</dt>
                <dd>전체 회의 조회, 회의 생성, 자신이 만든 회의 수정</dd>
                <dt>Attendee · 참가자</dt>
                <dd>본인이 초대된 회의만 조회</dd>
              </dl>
              <h3>Owner 위임·Topic 삭제</h3>
              <p className="muted">위임 후 역할과 하위 회의 보존 정책 확정 후 제공됩니다.</p>
              <Button variant="secondary" disabled>
                Owner 위임 준비 중
              </Button>
              <Button variant="secondary" disabled>
                Topic 삭제 준비 중
              </Button>
            </Card>
          </div>
        </div>
      ) : (
        <Modal
          className="topic-form-modal"
          title="새로운 Topic 만들기"
          description="한 가지 주제로 회의를 이어가는 우리 팀의 공간입니다."
          onClose={close}
        >
          {form}
        </Modal>
      )}
      {discard ? (
        <ConfirmDialog
          title="입력을 닫을까요?"
          description="저장하지 않은 Topic 입력은 사라집니다."
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
  const [expanded, setExpanded] = useState<string[]>([]);
  const { data } = useWorkspace();
  const { id } = useParams();
  const topic = data.topics.find((t) => t.id === id);
  if (!topic) return <Denied />;
  const meetings = data.meetings
    .filter((m) => m.topicId === id)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const manager = canCreateMeeting(topic, data.user.id);
  return (
    <div className="workflow-page topic-detail-page">
      <PageHeading
        title={topic.title}
        description={topic.description}
        crumbs={[{ label: 'Topic', to: '/topics' }]}
        actions={
          <>
            {topic.roles[data.user.id] === 'Owner' ? (
              <Link className="button button-secondary" to={`/topics/${id}/settings`}>
                <Settings size={17} />
                Topic 설정
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
      </div>
      <div className="section-heading">
        <h2>
          회의 히스토리 <span className="section-note">날짜와 시작 시간순으로 이어지는 대화</span>
        </h2>
        <span className="muted">{meetings.length}개</span>
      </div>
      {meetings.length ? (
        <ol className="meeting-history">
          {meetings.map((m) => {
            const open = expanded.includes(m.id);
            return (
              <li key={m.id} className={`history-card${open ? ' is-expanded' : ''}`}>
                <div className="history-card-header">
                  <button
                    type="button"
                    className="history-toggle"
                    aria-expanded={open}
                    aria-controls={`history-${m.id}`}
                    aria-label={`${m.title} 요약 ${open ? '접기' : '펼치기'}`}
                    onClick={() =>
                      setExpanded((ids) =>
                        open ? ids.filter((id) => id !== m.id) : [...ids, m.id],
                      )
                    }
                  >
                    <span className="history-title">{m.title}</span>
                    <span className="history-date">
                      <CalendarDays size={16} aria-hidden="true" />
                      {fullDate(m.start)} · {time(m.start)}–{time(m.end)}
                    </span>
                    <ChevronDown className="history-chevron" size={20} aria-hidden="true" />
                  </button>
                  <Link to={`/meetings/${m.id}`} className="history-detail-link">
                    상세보기
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                </div>
                <div id={`history-${m.id}`} hidden={!open} className="history-expanded">
                  {open ? <MeetingSummary meeting={m} /> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <Card>
          <EmptyState
            title="아직 회의가 없어요"
            description={
              manager
                ? '첫 회의를 만들고 이야기를 시작해보세요.'
                : '초대된 회의가 생기면 여기에서 볼 수 있어요.'
            }
          />
        </Card>
      )}
    </div>
  );
}
