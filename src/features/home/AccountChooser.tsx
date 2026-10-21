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
    <div className="account-chooser">
      <header>
        <p className="account-eyebrow">ROBOT BUTLER</p>
        <h1>테스트 계정 선택</h1>
        <p className="muted">사용할 계정을 선택하고 Topic 만들기부터 시작해보세요.</p>
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
    </div>
  );
}
