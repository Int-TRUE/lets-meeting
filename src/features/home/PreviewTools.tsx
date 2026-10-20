import { SlidersHorizontal } from 'lucide-react';
import type { PreviewState } from '../../domain/models';
export function PreviewTools({
  state,
  userId,
  onChange,
}: {
  state: PreviewState;
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
        <label htmlFor="preview-state">화면 상태</label>
        <select
          id="preview-state"
          value={state}
          onChange={(e) => onChange(e.target.value as PreviewState, userId)}
        >
          <option value="normal">정상</option>
          <option value="empty-meetings">회의 없음 · Topic 있음</option>
          <option value="empty">전체 비어 있음</option>
          <option value="loading">불러오는 중</option>
          <option value="error">연결 오류</option>
          <option value="forbidden">권한 없음</option>
          <option value="expired">세션 만료</option>
        </select>
        <label htmlFor="preview-user">예시 사용자</label>
        <select id="preview-user" value={userId} onChange={(e) => onChange(state, e.target.value)}>
          <option value="kim">김하늘 · Owner / Master / Attendee</option>
          <option value="lee">이서준 · Master</option>
          <option value="ops">운영관리자 · 운영 전용</option>
          <option value="choi">최민준 · 브랜드 Owner</option>
          <option value="jung">정수아 · 조직 Owner</option>
          <option value="park">박지우 · Topic 권한 없음</option>
        </select>
      </div>
    </details>
  );
}
