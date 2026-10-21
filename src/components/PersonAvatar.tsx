import { useState } from 'react';
import type { Person } from '../domain/models';

export function PersonAvatar({ person, className = '' }: { person: Person; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const tone = [...person.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3;
  return (
    <span
      className={`avatar person-avatar avatar-${tone} ${className}`}
      title={person.name}
      aria-hidden="true"
    >
      {person.avatarUrl && person.avatarUrl !== failedUrl ? (
        <img src={person.avatarUrl} alt="" onError={() => setFailedUrl(person.avatarUrl)} />
      ) : (
        person.name.trim().slice(0, 1)
      )}
    </span>
  );
}
