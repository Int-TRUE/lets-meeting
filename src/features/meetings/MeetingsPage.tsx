import { Link, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Card, EmptyState, StatusBadge } from '../../components/ui';
import { PageHeading } from '../../components/workflow-ui';
import { fullDate, meetingStatus, time } from '../../domain/selectors';
export function MeetingsPage() {
  const { data } = useWorkspace();
  const [params] = useSearchParams();
  const summaries = params.get('filter') === 'summary';
  const meetings = data.meetings
    .filter(
      (m) =>
        !summaries ||
        (meetingStatus(m, data.now) === 'summary-needed' && m.creatorId === data.user.id),
    )
    .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return (
    <div className="workflow-page">
      <PageHeading
        title={summaries ? '작성할 회의 요약' : '나의 회의'}
        description="초대된 회의와 관리 중인 회의를 확인하세요."
      />
      <div className="linked-meetings">
        {meetings.map((m) => (
          <Link
            key={m.id}
            to={`/meetings/${m.id}${summaries ? '?tab=summary' : ''}`}
            className="card linked-meeting"
          >
            <StatusBadge status={meetingStatus(m, data.now)} />
            <h2>{m.title}</h2>
            <p>
              {fullDate(m.start)} {time(m.start)} – {time(m.end)} · {m.room}
            </p>
          </Link>
        ))}
        {!meetings.length ? (
          <Card>
            <EmptyState
              title="표시할 회의가 없어요"
              description="회의가 생기면 여기에서 확인할 수 있어요."
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
