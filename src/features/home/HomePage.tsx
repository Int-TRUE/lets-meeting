import { ChevronRight, MapPin, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Workspace } from '../../domain/models';
import { dateKey, homeData, time } from '../../domain/selectors';
import { Mascot } from '../../components/Brand';
import { MeetingCard } from '../../components/MeetingCard';
import { TopicCard } from '../../components/TopicCard';
import { AvatarGroup, Card, EmptyState } from '../../components/ui';
export function HomePage({ workspace }: { workspace: Workspace }) {
  const data = homeData(workspace);
  return (
    <div className={`home-page ${data.next ? '' : 'home-page-empty'}`}>
      <div className="home-grid">
        <section className="upcoming-section" aria-labelledby="upcoming-heading">
          <div className="page-intro">
            <h1>
              <span className="greeting-name-row">
                <span>{data.user.name}님,</span>
                <span className="greeting-mascot">
                  <Mascot pose="home" />
                </span>
              </span>
              <span className="greeting-question">오늘도 좋은 대화를 만들어볼까요</span>
            </h1>
            <p className="intro-description">
              회의는 준비가 전부가 아니라, 좋은 대화가 전부입니다.
            </p>
          </div>
          <h2 className="sr-only" id="upcoming-heading">
            임박한 회의
          </h2>
          {data.next ? (
            <MeetingCard meeting={data.next} data={data} />
          ) : (
            <Card className="empty-meeting-card">
              <EmptyState
                illustration={<Mascot pose="tablet" />}
                title="아직 예정된 회의가 없어요"
                description="새로운 주제로 좋은 대화를 시작해보세요."
              >
                <Link className="button button-secondary" to="/topics">
                  Topic 둘러보기
                </Link>
                <Link className="button button-primary" to="/topics/new">
                  Topic 만들기
                  <Plus size={16} />
                </Link>
              </EmptyState>
            </Card>
          )}
        </section>
        <Card className="schedule" aria-labelledby="schedule-heading">
          <div className="schedule-header">
            <div>
              <h2 id="schedule-heading">오늘의 일정</h2>
              <p className="schedule-date">
                {data.today.length
                  ? `${data.today.length}개의 회의가 예정되어 있어요.`
                  : '오늘 예정된 회의가 없어요.'}
              </p>
            </div>
            {data.summaries.length ? (
              <Link
                to="/meetings?filter=summary"
                className="summary-notice"
                aria-label={`작성할 회의 요약 ${data.summaries.length}개`}
              >
                <span>요약 대기</span>
                <strong>{data.summaries.length}</strong>
                <ChevronRight size={18} />
              </Link>
            ) : null}
          </div>
          {data.today.length ? (
            <ol className="timeline">
              {data.today.map((m) => {
                const active = m.id === data.next?.id && dateKey(m.start) === dateKey(data.now);
                return (
                  <li key={m.id} className={active ? 'timeline-active' : ''}>
                    <Link to={`/meetings/${m.id}`} className="timeline-link">
                      <span className="timeline-dot" />
                      <span className="timeline-time">
                        <strong>{time(m.start)}</strong>
                        <span>{time(m.end)}</span>
                      </span>
                      <span className="timeline-copy">
                        <strong>{m.title}</strong>
                        <AvatarGroup
                          max={4}
                          people={m.participantIds.flatMap(
                            (id) => data.people.find((p) => p.id === id) ?? [],
                          )}
                        />
                        <span className="timeline-room">
                          <MapPin size={14} />
                          {m.room}
                        </span>
                      </span>
                      <ChevronRight size={18} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              compact
              title="오늘은 일정이 없어요"
              description="다음 대화를 위한 여유를 가져보세요."
            />
          )}
        </Card>
      </div>
      <section className="topics-section" aria-labelledby="topics-heading">
        <div className="section-heading">
          <h2 id="topics-heading">
            나의 Topic<span className="section-note">진행 중인 주제에서 이어보세요.</span>
          </h2>
          <Link to="/topics" className="text-link">
            전체 보기
            <ChevronRight size={17} />
          </Link>
        </div>
        {data.topics.length ? (
          <div className="topic-grid">
            {data.topics.map((t) => (
              <TopicCard key={t.id} topic={t} data={data} compact />
            ))}
            <Link to="/topics/new" className="create-topic-card">
              <span className="create-topic-icon">
                <Plus size={25} />
              </span>
              <h3>Topic 만들기</h3>
              <p>
                새로운 주제로
                <br />
                회의를 시작해보세요.
              </p>
            </Link>
          </div>
        ) : (
          <Card>
            <EmptyState
              compact
              title="아직 참여 중인 Topic이 없어요"
              description="관심 있는 주제를 둘러보거나 새로운 Topic을 만들어보세요."
            >
              <Link className="button button-primary" to="/topics/new">
                Topic 만들기
                <Plus size={16} />
              </Link>
            </EmptyState>
          </Card>
        )}
      </section>
    </div>
  );
}
