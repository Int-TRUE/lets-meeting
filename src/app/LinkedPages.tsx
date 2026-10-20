import { Link } from 'react-router-dom';
import { Card, EmptyState } from '../components/ui';
export function NotFoundPage() {
  return (
    <div className="workflow-page">
      <Card>
        <EmptyState
          title="페이지를 찾을 수 없어요"
          description="주소를 확인하거나 홈으로 돌아가주세요."
        >
          <Link className="button button-primary" to="/">
            홈으로 돌아가기
          </Link>
        </EmptyState>
      </Card>
    </div>
  );
}
