import { MapPin } from 'lucide-react';
import type { Room } from '../domain/models';
import illustration from '../assets/room-directions.png';

/** Shared demo artwork, labelled from the selected room rather than a baked-in room name. */
export function RoomDirections({
  room,
  title = '회의실 가는 길',
}: {
  room?: Room;
  title?: string;
}) {
  return (
    <section className="room-directions" aria-label={title}>
      <div className="room-directions-heading">
        <span className="room-directions-icon">
          <MapPin size={30} aria-hidden="true" />
        </span>
        <div>
          <h2>{title}</h2>
          {room ? (
            <strong>
              {room.location} · {room.name}
            </strong>
          ) : null}
          <p>
            {room
              ? '엘리베이터에서 하차 후 오른쪽으로 이동하세요.'
              : '회의실 안내가 아직 등록되지 않았어요.'}
          </p>
        </div>
      </div>
      {room ? (
        <>
          <div className="room-directions-map">
            <img
              src={illustration}
              alt={`${room.location} ${room.floor} ${room.name} 테스트용 안내도. 왼쪽 엘리베이터에서 파란 경로를 따라 오른쪽 회의실로 이동합니다.`}
            />
            <span className="room-directions-destination">{room.name}</span>
            <span className="room-directions-elevator">엘리베이터</span>
          </div>
          <small className="room-directions-note">
            테스트용 안내도 · 실제 건물 동선과 다를 수 있어요.
          </small>
        </>
      ) : null}
    </section>
  );
}
