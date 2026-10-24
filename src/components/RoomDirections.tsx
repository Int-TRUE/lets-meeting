import { useState, type ReactNode } from 'react';
import { ImageIcon, MapPin, Maximize2 } from 'lucide-react';
import type { Room } from '../domain/models';
import { Modal } from './ui';
import illustration from '../assets/room-directions.png';

export function RoomDirections({
  room,
  title = '회의실 가는 길',
  actions,
}: {
  room?: Room;
  title?: string;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<'photo' | 'directions'>();
  const [failedPhoto, setFailedPhoto] = useState('');
  const photo = room?.photoUrl && failedPhoto !== room.photoUrl ? room.photoUrl : undefined;
  const map = (
    <div className="room-directions-map">
      <img
        src={illustration}
        alt={`${room?.location} ${room?.floor} ${room?.name} 테스트용 안내도. 왼쪽 엘리베이터에서 파란 경로를 따라 오른쪽 회의실로 이동합니다.`}
      />
      <span className="room-directions-destination">{room?.name}</span>
      <span className="room-directions-elevator">엘리베이터</span>
    </div>
  );
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
          ) : (
            <p>회의실 안내가 아직 등록되지 않았어요.</p>
          )}
        </div>
        {actions ? <div className="room-directions-actions">{actions}</div> : null}
      </div>
      {room ? (
        <div className="room-media-grid">
          <div className="room-media-item">
            <h3>회의실 대표사진</h3>
            {photo ? (
              <button
                type="button"
                className="room-media-preview"
                aria-label="회의실 대표사진 크게 보기"
                onClick={() => setExpanded('photo')}
              >
                <img
                  src={photo}
                  alt={`${room.location} ${room.name} 대표사진`}
                  onError={() => setFailedPhoto(photo)}
                />
                <span className="room-media-zoom">
                  <Maximize2 size={16} aria-hidden="true" />
                  크게 보기
                </span>
              </button>
            ) : (
              <div className="room-photo-empty">
                <ImageIcon size={32} aria-hidden="true" />
                <strong>대표사진 등록 예정</strong>
                <p>사진이 등록되면 이곳에서 확인할 수 있어요.</p>
              </div>
            )}
          </div>
          <div className="room-media-item">
            <h3>회의실 가는 법</h3>
            <button
              type="button"
              className="room-media-preview"
              aria-label="회의실 가는 법 크게 보기"
              onClick={() => setExpanded('directions')}
            >
              {map}
              <span className="room-media-zoom">
                <Maximize2 size={16} aria-hidden="true" />
                크게 보기
              </span>
            </button>
            <small className="room-directions-note">
              테스트용 안내도 · 실제 건물 동선과 다를 수 있어요.
            </small>
          </div>
        </div>
      ) : null}
      {expanded ? (
        <Modal
          className="room-image-modal"
          title={expanded === 'photo' ? '회의실 대표사진' : '회의실 가는 법'}
          description={`${room?.location} · ${room?.name}`}
          onClose={() => setExpanded(undefined)}
        >
          {expanded === 'photo' && photo ? (
            <img className="room-expanded-photo" src={photo} alt={`${room?.name} 대표사진`} />
          ) : (
            map
          )}
        </Modal>
      ) : null}
    </section>
  );
}
