import { ArrowLeft, CalendarDays, FileText, LockKeyhole, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TopicCard } from '../components/TopicCard';
import { Card, EmptyState, StatusBadge } from '../components/ui';
import type { Workspace } from '../domain/models';
import { fullDate, meetingStatus, time } from '../domain/selectors';
export function LinkedPages({ data }: { data: Workspace }) {
  const { pathname, state } = useLocation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const meeting = data.meetings.find((m) => m.id === id);
  const topic = data.topics.find((t) => t.id === id);
  let title = '준비 중인 화면';
  let content;
  if (pathname === '/topics') {
    title = '나의 Topic';
    content = data.topics.length ? (
      <div className="topic-list">
        {data.topics.map((t) => (
          <TopicCard key={t.id} topic={t} data={data} />
        ))}
      </div>
    ) : (
      <Card>
        <EmptyState
          title="참여 중인 Topic이 없어요"
          description="새로운 Topic에서 대화를 시작해보세요."
        />
      </Card>
    );
  } else if (pathname === '/topics/new') {
    title = 'Topic 만들기';
    content = (
      <Card>
        <EmptyState
          title="새로운 대화를 위한 공간"
          description="Topic 생성은 다음 개발 단계에서 제공됩니다. 현재는 홈과 검색 화면을 둘러볼 수 있어요."
        >
          <Link className="button button-secondary" to="/topics">
            Topic으로 돌아가기
          </Link>
        </EmptyState>
      </Card>
    );
  } else if (pathname.startsWith('/topics/')) {
    title = topic?.title ?? '접근할 수 없는 화면';
    content = topic ? (
      <>
        <p className="muted">{topic.description}</p>
        <div className="linked-meetings">
          {data.meetings
            .filter((m) => m.topicId === topic.id)
            .map((m) => (
              <Link to={`/meetings/${m.id}`} className="card linked-meeting" key={m.id}>
                <StatusBadge status={meetingStatus(m, data.now)} />
                <h2>{m.title}</h2>
                <p>
                  {fullDate(m.start)} {time(m.start)} · {m.room}
                </p>
              </Link>
            ))}
        </div>
      </>
    ) : (
      <AccessDenied />
    );
  } else if (pathname.startsWith('/meetings/')) {
    title = meeting?.title ?? '접근할 수 없는 화면';
    content = meeting ? (
      <Card className="meeting-detail">
        <StatusBadge status={meetingStatus(meeting, data.now)} />
        <p>{meeting.description}</p>
        <p>
          <CalendarDays size={18} />
          {fullDate(meeting.start)} {time(meeting.start)} – {time(meeting.end)}
        </p>
        <p>{meeting.room}</p>
        <h2>참석자 · {meeting.participantIds.length}명</h2>
        <p>
          {meeting.participantIds
            .map((pid) => data.people.find((p) => p.id === pid)?.name)
            .filter(Boolean)
            .join(', ')}
        </p>
        <h2>회의 자료</h2>
        {meeting.files.length ? (
          <ul>
            {meeting.files.map((file) => (
              <li key={file}>
                <FileText size={17} />
                {file}
                <span className="muted">예시 자료</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{meeting.material === 'none' ? '자료 없음' : '자료 등록 예정'}</p>
        )}
        <p className="detail-note">
          회의 정보 미리보기입니다. 예약·자료 다운로드·요약 작성은 다음 단계에서 제공됩니다.
        </p>
      </Card>
    ) : (
      <AccessDenied />
    );
  } else if (pathname === '/meetings') {
    title = params.get('filter') === 'summary' ? '작성할 회의 요약' : '회의';
    const meetings = data.meetings.filter(
      (m) =>
        params.get('filter') !== 'summary' ||
        (meetingStatus(m, data.now) === 'summary-needed' && m.creatorId === data.user.id),
    );
    content = (
      <div className="linked-meetings">
        {meetings.map((m) => (
          <Link key={m.id} to={`/meetings/${m.id}`} className="card linked-meeting">
            <StatusBadge status={meetingStatus(m, data.now)} />
            <h2>{m.title}</h2>
            <p>
              {fullDate(m.start)} {time(m.start)}
            </p>
          </Link>
        ))}
        {!meetings.length ? (
          <Card>
            <EmptyState
              title="표시할 회의가 없어요"
              description="새로운 회의가 생기면 여기서 확인할 수 있어요."
            />
          </Card>
        ) : null}
      </div>
    );
  } else if (pathname === '/settings/notifications') {
    title = '알림 설정';
    content = (
      <Card className="notification-preview">
        <h2>Mattermost 알림</h2>
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
        <p className="detail-note">알림 전송과 설정 저장은 아직 연결되지 않았습니다.</p>
      </Card>
    );
  } else if (pathname === '/rooms') {
    title = '회의실';
    content = (
      <Card>
        <EmptyState
          title="회의실을 준비하고 있어요"
          description="회의실 조회와 예약은 연동 준비가 끝나면 제공됩니다."
        />
      </Card>
    );
  } else {
    title = '페이지를 찾을 수 없어요';
    content = (
      <Card>
        <EmptyState
          title="주소를 다시 확인해주세요"
          description="홈으로 돌아가 새로운 대화를 찾아보세요."
        >
          <Link className="button button-primary" to="/">
            홈으로 이동
          </Link>
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="linked-page">
      {state?.fromSearch ? (
        <button className="back-link" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          검색 결과로 돌아가기
        </button>
      ) : (
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          홈으로 돌아가기
        </Link>
      )}
      <div className="section-heading">
        <h1>{title}</h1>
        {pathname === '/topics' ? (
          <Link to="/topics/new" className="button button-primary">
            <Plus size={18} />
            Topic 만들기
          </Link>
        ) : null}
      </div>
      {content}
    </div>
  );
}
function AccessDenied() {
  return (
    <Card>
      <EmptyState
        title="이 정보에 접근할 수 없어요"
        description="접근 권한을 확인하거나 홈으로 돌아가주세요."
      />
    </Card>
  );
}
