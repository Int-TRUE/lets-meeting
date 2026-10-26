import { useRoomFavorites, FavoriteRoomButton } from '../../components/RoomFavorites';
import { useEffect, useState } from 'react';
import { RoomSchedule } from '../meetings/RoomSchedule';
import { RoomDirections } from '../../components/RoomDirections';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import { compareRooms } from '../../domain/selectors';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Button, Card, EmptyState, Field } from '../../components/ui';
import { Denied, FormMessage, PageHeading } from '../../components/workflow-ui';
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
