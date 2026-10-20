import { ArrowRight, CalendarDays, Clock3, FileText, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Meeting, Workspace } from '../domain/models';
import { fullDate, meetingStatus, time } from '../domain/selectors';
import { AvatarGroup, StatusBadge } from './ui';
export function MeetingCard({ meeting, data }: { meeting: Meeting; data: Workspace }) {
  const status = meetingStatus(meeting, data.now);
  const minutes = Math.ceil((Date.parse(meeting.start) - Date.parse(data.now)) / 60_000);
  const timeLabel =
    minutes > 0 && minutes <= 60
      ? `${minutes}분 후 시작`
      : minutes <= 0
        ? '예정된 회의'
        : '다가오는 회의';
  return (
    <article className="meeting-card">
      <div className="meeting-card-top">
        <span className="countdown">
          <Clock3 size={15} />
          {timeLabel}
        </span>
        <StatusBadge status={status} />
      </div>
      <div className="meeting-copy">
        <span className="eyebrow">{data.topics.find((t) => t.id === meeting.topicId)?.title}</span>
        <h3>{meeting.title}</h3>
        <p className="muted">회의 전에 일정과 자료를 가볍게 확인해보세요.</p>
      </div>
      <dl className="meeting-meta">
        <div>
          <dt>
            <CalendarDays size={18} />
            <span className="sr-only">일시</span>
          </dt>
          <dd>
            {fullDate(meeting.start)}
            <br className="mobile-only" /> {time(meeting.start)} – {time(meeting.end)}
          </dd>
        </div>
        <div>
          <dt>
            <MapPin size={18} />
            <span className="sr-only">장소</span>
          </dt>
          <dd>{meeting.room}</dd>
        </div>
        <div>
          <dt>
            <FileText size={18} />
            <span className="sr-only">자료</span>
          </dt>
          <dd>
            {meeting.material === 'uploaded'
              ? `자료 ${meeting.files.length}개 등록됨`
              : meeting.material === 'none'
                ? '자료 없음'
                : '자료 등록 예정'}
          </dd>
        </div>
      </dl>
      <div className="meeting-card-bottom">
        <AvatarGroup
          people={meeting.participantIds.flatMap(
            (id) => data.people.find((p) => p.id === id) ?? [],
          )}
        />
        <Link className="button button-primary" to={`/meetings/${meeting.id}`}>
          회의 상세 보기
          <ArrowRight size={17} />
        </Link>
      </div>
    </article>
  );
}
