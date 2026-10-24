import { useRoomFavorites, FavoriteRoomButton } from '../../components/RoomFavorites';
import { deliveryLabels } from '../../components/MeetingDelivery';
import { useEffect, useState } from 'react';
import { RoomSchedule } from '../meetings/RoomSchedule';
import { RoomDirections } from '../../components/RoomDirections';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import type { DeliveryLog } from '../../domain/models';
import { compareRooms, dateKey, fullDate, time } from '../../domain/selectors';
import { previewService } from '../../data/previewService';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card, EmptyState, Field, Modal } from '../../components/ui';
import { Denied, FormMessage, PageHeading } from '../../components/workflow-ui';
export const eventLabels: Record<DeliveryLog['event'], string> = {
  'start-check': '회의 시작·참석 확인',
  late: '지각 알림',
  'late-reply': '지각 응답',
  'end-reminder': '회의 종료·연장 안내',
  created: '회의 초대',
  reminder: '회의 리마인드',
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
        description="참가자별 알림 발송 결과와 실패 원인을 확인하세요."
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
                      <span
                        className={`badge ${log.result === 'sent' ? 'status-completed' : 'status-summary-needed'}`}
                      >
                        {deliveryLabels[log.result]}
                      </span>
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
            description="회의 생성·변경·취소 또는 자료·요약 작업 후 이벤트가 기록됩니다."
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
            <dd>{deliveryLabels[selected.result]}</dd>
            <dt>상세</dt>
            <dd>{selected.detail}</dd>
            <dt>재시도 이력</dt>
            <dd>재시도 없음</dd>
          </dl>
          <p className="detail-note">
            자동 재전송은 제공하지 않습니다. 결과 확인 필요 항목은 실제 DM을 확인해주세요. 이 기록은
            회의 본문 열람 권한을 부여하지 않습니다.
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
  const favorites = useRoomFavorites();
  const [location, setLocation] = useState('명동');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const filtered = rooms
    .filter(
      (room) =>
        room.location === location && `${room.location} ${room.floor} ${room.name}`.includes(query),
    )
    .toSorted(
      (a, b) =>
        Number(favorites.ids.includes(b.id)) - Number(favorites.ids.includes(a.id)) ||
        compareRooms(a, b),
    );
  const selected = filtered.find((room) => room.id === selectedId) ?? filtered[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);
  if (admin && !data.user.isAdmin) return <Denied />;
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
      <FormMessage error={favorites.error} />
      <div className="admin-filters">
        <Field
          label="회의실 검색"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="field">
          <label htmlFor="room-location">센터</label>
          <select id="room-location" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option>명동</option>
            <option>분당</option>
          </select>
        </div>
      </div>
      <div className="settings-grid">
        <div className="room-selection-details">
          <Card>
            <div className="rooms-list">
              {filtered.map((room) => (
                <div className="room-list-row" key={room.id}>
                  <button
                    className="room-list-item"
                    aria-pressed={selected?.id === room.id}
                    onClick={() => setSelectedId(room.id)}
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
                  </button>
                  <FavoriteRoomButton
                    compact
                    roomId={room.id}
                    roomName={`${room.location} ${room.name}`}
                    favorites={favorites}
                  />
                </div>
              ))}
              {!filtered.length ? (
                <EmptyState
                  compact
                  title="회의실 검색 결과가 없어요"
                  description="다른 이름이나 센터로 검색해주세요."
                />
              ) : null}
            </div>
          </Card>
          {selected ? (
            <Card className="room-details">
              <RoomDirections
                room={selected}
                title="회의실 정보"
                actions={<FavoriteRoomButton roomId={selected.id} favorites={favorites} />}
              />
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
                  토픽에서 회의 만들기
                </Link>
              )}
            </Card>
          ) : null}
        </div>
        {selected ? <RoomSchedule room={selected} /> : null}
      </div>
    </div>
  );
}
