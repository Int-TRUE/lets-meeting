import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card, EmptyState } from '../../components/ui';
import type { Room } from '../../domain/models';
import { previewService } from '../../data/previewService';
import { dateKey, time } from '../../domain/selectors';

export function RoomSchedule({ room }: { room: Room }) {
  const { data } = useWorkspace();
  const today = dateKey(data.now);
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const [result, setResult] = useState<{
    key: string;
    meetings: Awaited<ReturnType<typeof previewService.roomSchedule>>;
  }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${data.user.id}:${room.id}:${month}:${attempt}`;
  useEffect(() => {
    let active = true;
    setError('');
    void previewService
      .roomSchedule(data.user.id, room.id, month)
      .then((meetings) => {
        if (active) setResult({ key: requestKey, meetings });
      })
      .catch(() => {
        if (active) setError('회의실 일정을 불러오지 못했어요. 다시 시도해주세요.');
      });
    return () => {
      active = false;
    };
  }, [data.user.id, room.id, month, requestKey]);
  const loading = result?.key !== requestKey;
  const meetings = loading ? [] : result.meetings;
  const dayMeetings = meetings.filter((meeting) => dateKey(meeting.start) === date);
  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
    setMonth(next);
    setDate(`${next}-01`);
  }
  return (
    <Card className="room-schedule">
      <h2>
        {room.location} · {room.name} 일정
      </h2>
      <p className="muted">이 회의실의 모든 예정·진행 중 회의를 표시합니다.</p>
      <div className="room-calendar-header">
        <Button variant="text" aria-label="이전 달" onClick={() => moveMonth(-1)}>
          <ChevronLeft size={20} />
        </Button>
        <h3 aria-live="polite">
          {year}년 {monthNumber}월
        </h3>
        <Button variant="text" aria-label="다음 달" onClick={() => moveMonth(1)}>
          <ChevronRight size={20} />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setMonth(today.slice(0, 7));
            setDate(today);
          }}
        >
          오늘
        </Button>
      </div>
      <div className="room-calendar" role="group" aria-label="회의실 일정 달력">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <span className="room-calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: firstDay }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const key = `${month}-${String(index + 1).padStart(2, '0')}`;
          const count = meetings.filter((meeting) => dateKey(meeting.start) === key).length;
          return (
            <button
              type="button"
              key={key}
              aria-label={loading || error ? `${key}` : `${key}, 회의 ${count}개`}
              aria-pressed={key === date}
              aria-current={key === today ? 'date' : undefined}
              onClick={() => setDate(key)}
            >
              <span>{index + 1}</span>
              <small>{!error && count ? `${count}개` : '\u00a0'}</small>
            </button>
          );
        })}
      </div>
      <section className="room-agenda" aria-label="선택한 날짜의 예정 회의" aria-live="polite">
        <h3>
          {date} · 예정 회의{!loading && !error ? ` ${dayMeetings.length}개` : ''}
        </h3>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              다시 시도
            </Button>
          </div>
        ) : loading ? (
          <p role="status">회의실 일정을 불러오는 중입니다.</p>
        ) : dayMeetings.length ? (
          <ul>
            {dayMeetings.map((meeting) => (
              <li key={meeting.id}>
                <div className="room-agenda-item">
                  <span className="room-agenda-time">
                    {time(meeting.start)} – {time(meeting.end)}
                  </span>
                  {meeting.canOpen ? (
                    <Link to={`/meetings/${meeting.id}`}>{meeting.title}</Link>
                  ) : (
                    <strong>{meeting.title}</strong>
                  )}
                  <span className="muted">주최자 {meeting.hostName}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            title="표시할 예정 회의가 없어요"
            description="다른 날짜를 선택해보세요."
          />
        )}
      </section>
    </Card>
  );
}
