import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Meeting, Workspace } from '../domain/models';
import { fullDate, meetingStatus, time } from '../domain/selectors';
import { AvatarGroup, StatusBadge } from './ui';
import { MeetingCalendar } from './MeetingCalendar';
export function MeetingCard({ meeting, data }: { meeting: Meeting; data: Workspace }) {
  const minutes = Math.ceil((Date.parse(meeting.start) - Date.parse(data.now)) / 60_000);
  const timeLabel =
    minutes > 0 && minutes <= 60
      ? `${minutes}분 후`
      : minutes <= 0
        ? '예정된 회의'
        : '다가오는 회의';
  return (
    <article className="meeting-card">
      <MeetingCalendar />
      <div className="meeting-card-top">
        <span className="countdown">{timeLabel}</span>
        <span className="sr-only">
          <StatusBadge status={meetingStatus(meeting, data.now)} />
        </span>
      </div>
      <div className="meeting-copy">
        <h3>{meeting.title}</h3>
      </div>
      <dl className="meeting-meta">
        <div>
          <dt>
            <CalendarDays size={19} />
            <span className="sr-only">일시</span>
          </dt>
          <dd>
            {fullDate(meeting.start)} {time(meeting.start)} - {time(meeting.end)}
          </dd>
        </div>
        <div>
          <dt>
            <MapPin size={19} />
            <span className="sr-only">장소</span>
          </dt>
          <dd>{meeting.room}</dd>
        </div>
        <div className="meeting-material sr-only">
          <dt>자료</dt>
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
          max={5}
          people={meeting.participantIds.flatMap(
            (id) => data.people.find((p) => p.id === id) ?? [],
          )}
        />
        <Link className="button button-primary" to={`/meetings/${meeting.id}`}>
          회의 상세 보기
          <ArrowRight size={18} />
        </Link>
      </div>
    </article>
  );
}
