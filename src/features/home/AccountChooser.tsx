import { ArrowRight } from 'lucide-react';
import type { Person } from '../../domain/models';
import { Card } from '../../components/ui';
import { PersonAvatar } from '../../components/PersonAvatar';

export function AccountChooser({
  accounts,
  onSelect,
}: {
  accounts: Person[];
  onSelect: (id: string) => void;
}) {
  return (
    <section className="account-chooser" aria-labelledby="test-accounts-heading">
      <header>
        <h2 id="test-accounts-heading">테스트 계정 선택</h2>
        <p className="muted">테스트할 계정을 선택해 로그인하세요.</p>
      </header>
      <div className="account-grid">
        {accounts.map((person) => (
          <Card className="account-card" key={person.id}>
            <button onClick={() => onSelect(person.id)} aria-label={`${person.name}으로 시작`}>
              <PersonAvatar person={person} className="avatar-large" />
              <strong>{person.name}</strong>
              <span>
                {person.team} · {person.position}
              </span>
              <span className="account-enter">
                홈으로 들어가기 <ArrowRight size={18} />
              </span>
            </button>
          </Card>
        ))}
      </div>
    </section>
  );
}
