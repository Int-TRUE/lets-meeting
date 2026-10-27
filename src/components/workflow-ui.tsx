import { createId } from '../domain/id';
import { useEffect, useId, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Attachment, Person } from '../domain/models';
import { Button, Modal } from './ui';
import { previewService } from '../data/previewService';
import { useWorkspace } from '../app/WorkspaceContext';
import { PersonAvatar } from './PersonAvatar';
export function PageHeading({
  title,
  description,
  actions,
  crumbs = [],
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  crumbs?: { label: string; to: string }[];
}) {
  return (
    <>
      {crumbs.length ? (
        <nav className="breadcrumbs" aria-label="현재 위치">
          <Link to="/">홈</Link>
          {crumbs.map((c) => (
            <span key={c.to}>
              <ChevronRight size={14} />
              <Link to={c.to}>{c.label}</Link>
            </span>
          ))}
          <ChevronRight size={14} />
          <span aria-current="page">{title}</span>
        </nav>
      ) : null}
      <div className="workflow-heading">
        <div>
          <h1>{title}</h1>
          {description ? <p className="muted">{description}</p> : null}
        </div>
        {actions ? <div className="heading-actions">{actions}</div> : null}
      </div>
    </>
  );
}
export function TextareaField({
  label,
  error,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {props.required ? ' *' : ''}
      </label>
      <textarea
        id={fieldId}
        rows={4}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        {...props}
      />
      {error ? (
        <p className="field-error" id={`${fieldId}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function PeoplePicker({
  label,
  labelDescription,
  people,
  value,
  onChange,
  lockedIds = [],
  excludedIds = [],
  topicId,
  renderRole,
  disabled = false,
}: {
  label: string;
  people: Person[];
  value: string[];
  onChange: (value: string[]) => void;
  lockedIds?: string[];
  excludedIds?: string[];
  labelDescription?: string;
  topicId?: string;
  renderRole?: (person: Person, selected: boolean) => ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const { data, rememberPeople } = useWorkspace();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{
    query: string;
    people: Person[];
    hasMore: boolean;
    error?: string;
  }>({ query: '', people: [], hasMore: false });
  const [selectedPeople, setSelectedPeople] = useState<Person[]>(people);
  const [retry, setRetry] = useState(0);
  const [topicPeople, setTopicPeople] = useState<Person[]>([]);
  const [topicLoading, setTopicLoading] = useState(Boolean(topicId));
  const [topicError, setTopicError] = useState('');
  useEffect(() => {
    if (!topicId) return;
    let active = true;
    setTopicLoading(true);
    setTopicError('');
    void previewService
      .topicPeople(data.user.id, topicId)
      .then((result) => {
        if (active) {
          setTopicPeople(result);
        }
      })
      .catch(() => {
        if (active) setTopicError('토픽 참여자를 불러오지 못했어요. 다시 시도해주세요.');
      })
      .finally(() => {
        if (active) setTopicLoading(false);
      });
    return () => {
      active = false;
    };
  }, [topicId, data.user.id, retry]);
  const availablePeople = topicId ? topicPeople : people;
  const term = query.trim();
  useEffect(() => {
    if (topicId || !term) return;
    let active = true;
    const timer = setTimeout(() => {
      void previewService
        .searchPeople(data.user.id, term, topicId)
        .then((result) => {
          if (active) setSearch({ query: term, ...result });
        })
        .catch(() => {
          if (active)
            setSearch({
              query: term,
              people: [],
              hasMore: false,
              error: '직원을 검색하지 못했어요. 다시 시도해주세요.',
            });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, topicId, data.user.id, retry]);
  const loading = !topicId && Boolean(term && search.query !== term);
  const searchMatches = topicId
    ? availablePeople.filter((person) =>
        `${person.name} ${person.team} ${person.position ?? ''}`
          .toLocaleLowerCase()
          .includes(term.toLocaleLowerCase()),
      )
    : term && !loading
      ? search.people
      : [];
  const matches = searchMatches.filter((person) => !excludedIds.includes(person.id));
  function select(p: Person, checked: boolean) {
    if (checked) rememberPeople([p]);
    if (checked)
      setSelectedPeople((current) => [...current.filter((person) => person.id !== p.id), p]);
    onChange(checked ? [...new Set([...value, p.id])] : value.filter((id) => id !== p.id));
  }
  return (
    <fieldset
      className={`people-picker${renderRole ? ' people-picker-roles' : ''}`}
      disabled={disabled}
      aria-labelledby={`${id}-label`}
      aria-describedby={labelDescription ? `${id}-description` : undefined}
    >
      <legend>
        <span id={`${id}-label`}>{label}</span>
        {labelDescription ? (
          <span className="picker-label-description" id={`${id}-description`}>
            {labelDescription}
          </span>
        ) : null}
      </legend>
      <label htmlFor={id} className="picker-search">
        <Search size={18} />
        <span className="sr-only">{label} 검색</span>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름, 팀, 직책으로 검색"
        />
      </label>
      {topicId ? (
        <div className="people-picker-toolbar">
          <span>
            토픽 참여자 {availablePeople.length}명 · 선택 {value.length}명
          </span>
          <Button
            variant="secondary"
            disabled={
              topicLoading ||
              Boolean(topicError) ||
              availablePeople.every((person) => value.includes(person.id))
            }
            onClick={() => {
              rememberPeople(availablePeople);
              onChange([...new Set([...value, ...availablePeople.map((person) => person.id)])]);
            }}
          >
            전체 추가
          </Button>
        </div>
      ) : null}
      <div className="selected-people">
        {value.map((pid) => {
          const p =
            availablePeople.find((p) => p.id === pid) ??
            people.find((p) => p.id === pid) ??
            selectedPeople.find((p) => p.id === pid);
          return p ? (
            <span className="person-chip" key={pid}>
              <PersonAvatar person={p} />
              <span className="person-chip-name">{p.name}</span>
              {renderRole?.(p, true)}
              {lockedIds.includes(pid) ? (
                renderRole ? null : (
                  <small>유지</small>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((id) => id !== pid))}
                  aria-label={`${p.name} 선택 해제`}
                >
                  <X size={14} />
                </button>
              )}
            </span>
          ) : null;
        })}
      </div>
      <div className="people-options">
        {matches.map((p) => (
          <div className="person-result" key={p.id}>
            <label className="person-option">
              <input
                type="checkbox"
                checked={value.includes(p.id)}
                disabled={lockedIds.includes(p.id)}
                onChange={(e) => select(p, e.target.checked)}
              />
              <PersonAvatar person={p} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.team}
                  {p.position ? ` · ${p.position}` : ''}
                </small>
              </span>
            </label>
            {renderRole?.(p, false)}
          </div>
        ))}
        <div className="people-search-status" role="status">
          {topicId && topicLoading ? (
            '토픽 참여자를 불러오고 있어요…'
          ) : topicId && topicError ? (
            <>
              <p>{topicError}</p>
              <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
                다시 불러오기
              </Button>
            </>
          ) : topicId ? (
            matches.length ? (
              `${matches.length}명 표시됨`
            ) : term ? (
              '검색한 참여자가 없어요.'
            ) : (
              '토픽 참여자가 없어요.'
            )
          ) : !term ? (
            <>
              <Search size={24} />
              <strong>함께할 동료를 찾아보세요</strong>
              <p>이름, 팀 또는 직책을 검색하면 결과가 표시돼요.</p>
            </>
          ) : loading ? (
            '직원을 검색하고 있어요…'
          ) : search.error ? (
            <>
              <p>{search.error}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch({ query: '', people: [], hasMore: false });
                  setRetry((n) => n + 1);
                }}
              >
                다시 검색
              </Button>
            </>
          ) : !matches.length ? (
            '검색한 직원이 없어요.'
          ) : search.hasMore ? (
            '검색 결과가 많아요. 상위 20명을 표시합니다. 이름이나 팀을 더 입력해주세요.'
          ) : (
            `${matches.length}명 검색됨`
          )}
        </div>
      </div>
    </fieldset>
  );
}
export function FormMessage({ error, success }: { error?: string; success?: string }) {
  return error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : success ? (
    <p role="status" className="form-success">
      {success}
    </p>
  ) : null;
}
export function ConfirmDialog({
  title,
  description,
  actionLabel,
  onConfirm,
  onClose,
  busy,
  error,
  danger = false,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <FormMessage error={error} />
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          돌아가기
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {actionLabel}
        </Button>
      </div>
    </Modal>
  );
}
export function FilePicker({
  value,
  onChange,
}: {
  value: Attachment[];
  onChange: (files: Attachment[]) => void;
}) {
  const id = useId();
  return (
    <div className="file-picker">
      <label htmlFor={id}>회의 자료 선택</label>
      <input
        id={id}
        type="file"
        multiple
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].map((file) => ({
            id: createId(),
            name: file.name,
            type: file.type || '파일',
            size: file.size,
            authorId: '',
            updatedAt: '',
            blob: file,
          }));
          onChange([...value, ...files]);
          e.target.value = '';
        }}
      />
      <ul>
        {value.map((file) => (
          <li key={file.id}>
            <span>
              {file.name}
              <small>{new Intl.NumberFormat('ko-KR').format(file.size)} bytes</small>
            </span>
            <Button
              type="button"
              variant="text"
              className="icon-button"
              aria-label={`${file.name} 제거`}
              onClick={() => onChange(value.filter((f) => f.id !== file.id))}
            >
              <X size={16} />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function Denied() {
  return (
    <div className="error-state">
      <h1>이 정보에 접근할 수 없어요</h1>
      <p>권한이 있는 계정인지 확인해주세요.</p>
      <Link to="/" className="button button-secondary">
        홈으로 돌아가기
      </Link>
    </div>
  );
}
