import type { ReactNode } from 'react';
import { RoomDirections } from '../../components/RoomDirections';
import { useRoomFavorites, FavoriteRoomButton } from '../../components/RoomFavorites';
import { compareRooms } from '../../domain/selectors';
import { Check, Clock3, MapPin } from 'lucide-react';
import type { Room } from '../../domain/models';
import { previewPolicy } from '../../domain/workflows';
import { useWorkspace } from '../../app/WorkspaceContext';
import { Card } from '../../components/ui';
export interface ScheduleValue {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
}
export const isoTime = (date: string, time: string) => `${date}T${time}:00+09:00`;
export function SchedulePicker({
  value,
  onChange,
  unavailable,
  now,
  actions,
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  unavailable: string[];
  now: string;
  actions?: ReactNode;
}) {
  const { rooms } = useWorkspace();
  const favorites = useRoomFavorites();
  const selectedRoom = rooms.find((r) => r.id === value.roomId);
  const location = selectedRoom?.location ?? '명동';
  const slots = Array.from(
    {
      length: ((previewPolicy.endHour - previewPolicy.startHour) * 60) / previewPolicy.slotMinutes,
    },
    (_, i) => {
      const mins = previewPolicy.startHour * 60 + i * previewPolicy.slotMinutes;
      return `${Math.floor(mins / 60)
        .toString()
        .padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`;
    },
  );
  function choose(time: string) {
    const endMinutes =
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + previewPolicy.slotMinutes;
    const nextEnd = `${Math.floor(endMinutes / 60)
      .toString()
      .padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
    const extending =
      value.startTime &&
      time > value.startTime &&
      !unavailable.some((t) => t >= value.startTime && t <= time);
    onChange({ ...value, startTime: extending ? value.startTime : time, endTime: nextEnd });
  }
  function roomChange(room: Room) {
    onChange({ ...value, roomId: room.id, startTime: '', endTime: '' });
  }
  const minutes =
    value.startTime && value.endTime
      ? (Date.parse(isoTime(value.date, value.endTime)) -
          Date.parse(isoTime(value.date, value.startTime))) /
        60000
      : 0;
  return (
    <div className="schedule-picker">
      <section>
        <h2>회의실 선택</h2>
        <div className="segmented" role="group" aria-label="센터">
          {(['명동', '분당'] as const).map((name) => (
            <button
              type="button"
              aria-pressed={location === name}
              key={name}
              onClick={() => roomChange(rooms.find((r) => r.location === name)!)}
            >
              {name}
            </button>
          ))}
        </div>
        {favorites.error ? <p role="alert">{favorites.error}</p> : null}
        <div className="rooms-list">
          {rooms
            .filter((r) => r.active && r.location === location)
            .toSorted(
              (a, b) =>
                Number(favorites.ids.includes(b.id)) - Number(favorites.ids.includes(a.id)) ||
                compareRooms(a, b),
            )
            .map((r) => (
              <div className="room-list-row" key={r.id}>
                <button
                  type="button"
                  className="room-list-item"
                  aria-pressed={value.roomId === r.id}
                  onClick={() => roomChange(r)}
                >
                  <MapPin size={24} />
                  <span>
                    <strong>
                      {r.location} · {r.name}
                    </strong>
                    <small>
                      {r.floor} · 수용 {r.capacity}명
                    </small>
                  </span>
                </button>
                <FavoriteRoomButton
                  compact
                  roomId={r.id}
                  roomName={`${r.location} ${r.name}`}
                  favorites={favorites}
                />
              </div>
            ))}
        </div>
        {selectedRoom ? (
          <Card className="room-details">
            <RoomDirections
              room={selectedRoom}
              title="회의실 정보"
              actions={<FavoriteRoomButton roomId={selectedRoom.id} favorites={favorites} />}
            />
            <p>
              {selectedRoom.floor} · 수용 {selectedRoom.capacity}명
            </p>
          </Card>
        ) : null}
      </section>
      <section>
        <h2>일정 선택</h2>
        <div className="field">
          <label htmlFor="meeting-date">회의 일자 *</label>
          <input
            id="meeting-date"
            type="date"
            min={now.slice(0, 10)}
            value={value.date}
            onChange={(e) =>
              onChange({ ...value, date: e.target.value, startTime: '', endTime: '' })
            }
          />
        </div>
        <p className="slot-hint">시작할 시간을 선택한 뒤 마지막 시간을 선택해 범위를 늘리세요.</p>
        <div className="time-slots" role="group" aria-label="예약 시간">
          {slots.map((t) => {
            const blocked =
              !value.date ||
              unavailable.includes(t) ||
              Date.parse(isoTime(value.date, t)) < Date.parse(now);
            const selected = Boolean(value.startTime && t >= value.startTime && t < value.endTime);
            return (
              <button
                type="button"
                key={t}
                disabled={blocked}
                aria-pressed={selected}
                onClick={() => choose(t)}
              >
                <strong>{t}</strong>
                <small>{blocked ? '예약 불가' : selected ? '선택' : '예약 가능'}</small>
                {selected ? <Check size={16} /> : null}
              </button>
            );
          })}
        </div>
        <div className="slot-legend">
          <span>○ 예약 가능</span>
          <span>— 예약 불가</span>
          <span>✓ 선택</span>
        </div>
        <Card className="selection-summary">
          <Clock3 size={22} />
          <div>
            <strong>
              {minutes
                ? `${value.startTime} – ${value.endTime} · ${minutes}분`
                : '시간을 선택해주세요'}
            </strong>
            <p>미리보기는 30분 단위 · 09:00–18:00 예시 정책입니다.</p>
          </div>
        </Card>
        {actions}
      </section>
    </div>
  );
}
