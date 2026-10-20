import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import type { DeliveryLog } from '../../domain/models';
import { dateKey, fullDate, time } from '../../domain/selectors';
import { previewService } from '../../data/previewService';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card, EmptyState, Field, Modal } from '../../components/ui';
import { Denied, FormMessage, PageHeading } from '../../components/workflow-ui';
export const eventLabels: Record<DeliveryLog['event'], string> = {
  created: '회의 생성·초대',
  changed: '회의 변경',
  cancelled: '회의 취소',
  materials: '자료 등록·수정',
  summary: '요약 완료',
};
export function AdminNotificationsPage() {
  const { data, directory } = useWorkspace();
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [event, setEvent] = useState('all');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState<DeliveryLog>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!data.user.isAdmin) return;
    let active = true;
    setLoading(true);
    void previewService
      .adminLogs(data.user.id)
      .then((value) => {
        if (active) {
          setLogs(value);
          setLoading(false);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : '기록을 불러오지 못했어요.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [data.user.id, attempt]);
  if (!data.user.isAdmin) return <Denied />;
  const rows = logs
    .filter(
      (log) => (event === 'all' || log.event === event) && (!date || dateKey(log.time) === date),
    )
    .toReversed();
  return (
    <div className="workflow-page admin-notifications-page">
      <PageHeading
        title="관리자 발송 이력"
        description="알림 이벤트와 전달 결과를 확인하세요. 미리보기 기록은 실제 발송 성공이 아닙니다."
        actions={
          <Link className="button button-secondary" to="/admin/rooms">
            회의실 관리
          </Link>
        }
      />
      <Card>
        <div className="admin-filters">
          <div className="field">
            <label htmlFor="event-filter">이벤트</label>
            <select id="event-filter" value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="all">전체 이벤트</option>
              {Object.entries(eventLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="기록 날짜"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setEvent('all');
              setDate('');
            }}
          >
            필터 초기화
          </Button>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            새로고침
          </Button>
        </div>
        <FormMessage error={error} />
        {loading ? (
          <p role="status">발송 이력을 불러오는 중입니다.</p>
        ) : error ? (
          <Button onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>
        ) : rows.length ? (
          <div className="table-scroll" tabIndex={0} aria-label="발송 이력 표 · 좌우로 스크롤">
            <p className="table-scroll-hint">표를 좌우로 움직여 결과와 상세 내용을 확인하세요.</p>
            <table>
              <caption className="sr-only">관리자 알림 이벤트 기록 {rows.length}개</caption>
              <thead>
                <tr>
                  {['시간', '대상', '이벤트', '채널', '결과', '상세'].map((t) => (
                    <th scope="col" key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id}>
                    <td>
                      {fullDate(log.time)}
                      <br />
                      {time(log.time)}
                    </td>
                    <td>
                      {directory.find((p) => p.id === log.recipientId)?.name ?? '예시 사용자'}
                    </td>
                    <td>{eventLabels[log.event]}</td>
                    <td>Mattermost</td>
                    <td>
                      <span className="badge status-summary-needed">미전송 · 미연결</span>
                    </td>
                    <td>
                      <Button
                        variant="text"
                        onClick={() => setSelected(log)}
                        aria-label={`${eventLabels[log.event]} ${directory.find((p) => p.id === log.recipientId)?.name ?? ''} 상세 보기`}
                      >
                        상세 보기
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={logs.length ? '필터에 맞는 기록이 없어요' : '아직 발송 이력이 없어요'}
            description="회의 생성·변경·취소 또는 자료·요약 작업 후 예시 이벤트가 기록됩니다."
          />
        )}
      </Card>
      {selected ? (
        <Modal title="발송 기록 상세" onClose={() => setSelected(undefined)}>
          <dl className="record-detail">
            <dt>이벤트</dt>
            <dd>{eventLabels[selected.event]}</dd>
            <dt>대상</dt>
            <dd>{directory.find((p) => p.id === selected.recipientId)?.name}</dd>
            <dt>채널</dt>
            <dd>Mattermost</dd>
            <dt>결과</dt>
            <dd>미전송 · 외부 채널 미연결</dd>
            <dt>상세</dt>
            <dd>{selected.detail}</dd>
            <dt>재시도 이력</dt>
            <dd>재시도 없음</dd>
          </dl>
          <p className="detail-note">
            실제 전송·재시도 정책 확정 후 제공됩니다. 이 기록은 회의 본문 열람 권한을 부여하지
            않습니다.
          </p>
          <Button disabled variant="secondary">
            재전송 준비 중
          </Button>
        </Modal>
      ) : null}
    </div>
  );
}
export function RoomsPage({ admin = false }: { admin?: boolean }) {
  const { data, rooms } = useWorkspace();
  const [location, setLocation] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(rooms[0]);
  if (admin && !data.user.isAdmin) return <Denied />;
  const filtered = rooms.filter(
    (room) =>
      (location === 'all' || room.location === location) &&
      `${room.location} ${room.name}`.includes(query),
  );
  return (
    <div className="workflow-page rooms-page">
      <PageHeading
        title={admin ? '관리자 회의실 관리' : '회의실'}
        description="예시 회의실의 위치와 수용 인원을 확인하세요."
        actions={
          admin ? (
            <Link to="/admin/notifications" className="button button-secondary">
              발송 이력
            </Link>
          ) : undefined
        }
      />
      <div className="admin-filters">
        <Field
          label="회의실 검색"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="field">
          <label htmlFor="room-location">사업장</label>
          <select id="room-location" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="all">전체</option>
            <option>명동</option>
            <option>분당</option>
          </select>
        </div>
      </div>
      <div className="settings-grid">
        <Card>
          <div className="rooms-list">
            {filtered.map((room) => (
              <button
                className="room-list-item"
                aria-pressed={selected.id === room.id}
                key={room.id}
                onClick={() => setSelected(room)}
              >
                <span className="topic-icon tone-blue">
                  <MapPin size={24} />
                </span>
                <span>
                  <strong>
                    {room.location} · {room.name}
                  </strong>
                  <small>
                    {room.floor} · 수용 {room.capacity}명
                  </small>
                </span>
                <span className="badge status-completed">예시</span>
              </button>
            ))}
            {!filtered.length ? (
              <EmptyState
                compact
                title="회의실 검색 결과가 없어요"
                description="다른 이름이나 사업장으로 검색해주세요."
              />
            ) : null}
          </div>
        </Card>
        <Card className="room-details">
          <span className="room-illustration">
            <MapPin size={42} />
          </span>
          <h2>
            {selected.location} · {selected.name}
          </h2>
          <p>
            <MapPin size={18} />
            {selected.location} · {selected.floor}
          </p>
          <p>
            <Users size={18} />
            수용 {selected.capacity}명
          </p>
          <p>
            <CalendarDays size={18} />
            연계 출처 · 로컬 미리보기
          </p>
          <p className="detail-note">
            실제 회의실 정보·안내 경로·원텔 예약은 연결되지 않았습니다.
            {admin ? ' 추가·수정·비활성은 외부 연동과 승인 정책 확정 후 제공됩니다.' : ''}
          </p>
          {admin ? (
            <Button variant="secondary" disabled>
              회의실 수정 준비 중
            </Button>
          ) : (
            <Link to="/topics" className="button button-primary">
              Topic에서 회의 만들기
            </Link>
          )}
        </Card>
      </div>
    </div>
  );
}
