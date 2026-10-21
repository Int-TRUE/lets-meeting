import { Building2, CalendarDays, MessageSquare, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Mascot } from '../../components/Brand';
import { Button } from '../../components/ui';
import type { Person } from '../../domain/models';
import { AccountChooser } from './AccountChooser';

export function LoginPage({
  accounts,
  onSelect,
}: {
  accounts?: Person[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className={`login-page ${onSelect ? 'login-page-test' : ''}`}>
      <section className="login-brand-panel" aria-label="로봇집사 소개">
        <Mascot pose="welcome" />
        <strong>로봇집사</strong>
        <span>ROBOT BUTLER</span>
        <h2>
          좋은 대화가
          <br />
          좋은 일을 만듭니다.
        </h2>
        <p>
          회의의 시작부터 끝까지,
          <br />더 집중할 수 있도록 도와드려요.
        </p>
      </section>
      <section className="login-form-panel">
        <h1>
          로봇집사에 오신 것을
          <br />
          환영합니다.
        </h1>
        <p>조직 계정으로 간편하게 시작하세요.</p>
        <Button disabled>
          <Building2 size={22} />
          회사 계정으로 로그인하기
        </Button>
        <p className="detail-note">회사 계정 로그인은 아직 연결되지 않았습니다.</p>
        {accounts && onSelect ? <AccountChooser accounts={accounts} onSelect={onSelect} /> : null}
        <div className="login-features">
          <div>
            <MessageSquare />
            <p>
              회의 준비부터
              <br />
              요약까지 한 곳에
            </p>
          </div>
          <div>
            <Users />
            <p>
              사람, 자료, 맥락이
              <br />
              이어지는 대화
            </p>
          </div>
          <div>
            <CalendarDays />
            <p>
              반복되는 회의도
              <br />더 가볍게
            </p>
          </div>
        </div>
        {!onSelect ? (
          <Link className="text-link" to="/">
            예시 데이터로 미리보기
          </Link>
        ) : null}
      </section>
    </div>
  );
}
