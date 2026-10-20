import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  FilePenLine,
  MapPin,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Workspace } from '../../domain/models';
import { dateKey, fullDate, homeData, meetingStatus, time } from '../../domain/selectors';
import { Mascot } from '../../components/Brand';
import { MeetingCard } from '../../components/MeetingCard';
import { TopicCard } from '../../components/TopicCard';
import { Card, EmptyState } from '../../components/ui';
export function HomePage({ workspace }: { workspace: Workspace }) {
  const data = homeData(workspace);
  return (
    <div className="home-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">좋은 대화가 좋은 일을 만듭니다</p>
          <h1>
            {data.user.name}님,
            <br />
            오늘도 좋은 대화를 만들어볼까요<span className="greeting-dot">.</span>
          </h1>
          <p className="intro-description">회의의 시작부터 끝까지, 로봇집사가 함께할게요.</p>
        </div>
        <div className="greeting-mascot">
          <Mascot />
          <Sparkles className="mascot-spark" size={24} />
        </div>
      </div>
      <div className="home-grid">
        <section className="upcoming-section" aria-labelledby="upcoming-heading">
          <div className="section-heading">
            <h2 id="upcoming-heading">
              임박한 회의<span className="section-note">다음 대화를 준비해요</span>
            </h2>
            <CalendarDays size={20} className="muted" />
          </div>
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
          <div className="section-heading">
            <h2 id="schedule-heading">오늘의 일정</h2>
            <span className="schedule-count">{data.today.length}개</span>
          </div>
          <p className="schedule-date">{fullDate(data.now)}</p>
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
                        <span>
                          <MapPin size={13} />
                          {m.room}
                        </span>
                        <small>
                          {meetingStatus(m, data.now) === 'summary-needed'
                            ? '요약 작성 필요'
                            : meetingStatus(m, data.now) === 'completed'
                              ? '완료'
                              : `참석자 ${m.participantIds.length}명`}
                        </small>
                      </span>
                      <ChevronRight size={16} />
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
          {data.summaries.length ? (
            <Link to="/meetings?filter=summary" className="summary-notice">
              <span>
                <FilePenLine size={18} />
                작성할 회의 요약 <strong>{data.summaries.length}개</strong>
              </span>
              <ChevronRight size={16} />
            </Link>
          ) : null}
        </Card>
      </div>
      <section className="topics-section" aria-labelledby="topics-heading">
        <div className="section-heading">
          <h2 id="topics-heading">
            나의 Topic<span className="section-note">함께 나누는 이야기, 하나의 흐름으로</span>
          </h2>
          <Link to="/topics" className="text-link">
            전체 보기
            <ChevronRight size={16} />
          </Link>
        </div>
        {data.topics.length ? (
          <div className="topic-grid">
            {data.topics.map((t) => (
              <TopicCard key={t.id} topic={t} data={data} />
            ))}
            <Link to="/topics/new" className="create-topic-card">
              <span className="create-topic-icon">
                <Plus size={25} />
              </span>
              <h3>Topic 만들기</h3>
              <p>
                새로운 주제로
                <br />
                대화를 이어가보세요.
              </p>
              <ArrowRight size={20} />
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
      <footer className="home-footer">
        <span>ROBOT BUTLER</span>
        <span>회의는 준비가 전부가 아니라, 좋은 대화가 전부입니다.</span>
      </footer>
    </div>
  );
}
