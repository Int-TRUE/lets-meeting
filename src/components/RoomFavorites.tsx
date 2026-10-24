import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { useWorkspace } from '../app/WorkspaceContext';
import { previewService } from '../data/previewService';
import { Button } from './ui';
export function useRoomFavorites() {
  const { data } = useWorkspace();
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setIds([]);
    previewService
      .favoriteRooms(data.user.id)
      .then((v) => {
        if (active) setIds(v);
      })
      .catch(() => {
        if (active) setError('자주 사용하는 회의실을 불러오지 못했어요.');
      });
    return () => {
      active = false;
    };
  }, [data.user.id]);
  async function toggle(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setIds(await previewService.setFavoriteRoom(data.user.id, id, !ids.includes(id)));
    } catch {
      setError('자주 사용하는 회의실을 저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }
  return { ids, error, busy, toggle };
}
export function FavoriteRoomButton({
  roomId,
  favorites,
  compact = false,
  roomName,
}: {
  roomId: string;
  compact?: boolean;
  roomName?: string;
  favorites: ReturnType<typeof useRoomFavorites>;
}) {
  const selected = favorites.ids.includes(roomId);
  return (
    <Button
      variant={compact ? 'text' : 'secondary'}
      className={compact ? 'room-favorite-star' : 'room-favorite-heading-button'}
      aria-label={
        compact
          ? `${roomName ?? '회의실'} ${selected ? '즐겨찾기 해제' : '즐겨찾기 지정'}`
          : undefined
      }
      title={compact ? (selected ? '즐겨찾기 해제' : '즐겨찾기 지정') : undefined}
      aria-pressed={selected}
      disabled={favorites.busy}
      onClick={() => void favorites.toggle(roomId)}
    >
      <Star size={compact ? 24 : 18} aria-hidden="true" fill={selected ? 'currentColor' : 'none'} />
      {compact ? null : selected ? '즐겨찾기 해제' : '즐겨찾기 지정'}
    </Button>
  );
}
