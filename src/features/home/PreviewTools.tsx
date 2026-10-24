import { SlidersHorizontal } from 'lucide-react';
import type { Person, PreviewState } from '../../domain/models';
export function PreviewTools({
  state,
  directory,
  userId,
  onChange,
}: {
  state: PreviewState;
  directory: Person[];
  userId: string;
  onChange: (state: PreviewState, userId: string) => void;
}) {
  return (
    <details className="preview-tools">
      <summary>
        <SlidersHorizontal size={15} />
        미리보기 상태
      </summary>
      <div>
        <p className="preview-disclosure">
          예시 데이터 미리보기 · 실제 계정·예약·알림과 연결되지 않습니다.
        </p>
        <label htmlFor="preview-state">화면 상태</label>
        <select
          id="preview-state"
          value={state}
          onChange={(e) => onChange(e.target.value as PreviewState, userId)}
        >
          <option value="normal">정상</option>
          <option value="empty-meetings">회의 없음 · 토픽 있음</option>
          <option value="empty">전체 비어 있음</option>
          <option value="loading">불러오는 중</option>
          <option value="error">연결 오류</option>
          <option value="forbidden">권한 없음</option>
          <option value="expired">세션 만료</option>
        </select>
        <label htmlFor="preview-user">예시 사용자</label>
        <select id="preview-user" value={userId} onChange={(e) => onChange(state, e.target.value)}>
          {directory.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.position ?? p.team}
            </option>
          ))}
        </select>
      </div>
    </details>
  );
}
