import {
  forwardRef,
  useLayoutEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { AlertCircle, ArrowRight, Check, FileText, LoaderCircle, X } from 'lucide-react';
import type { MeetingStatus, Person } from '../domain/models';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'text' | 'danger';
    loading?: boolean;
  }
>(function Button(
  { variant = 'primary', loading, children, className = '', disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`button button-${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`} {...props} />;
}
export function Field({
  label,
  error,
  helper,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; helper?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {props.required ? <span> *</span> : null}
      </label>
      <input
        id={fieldId}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helper ? `${fieldId}-help` : undefined}
        {...props}
      />
      {error || helper ? (
        <p id={`${fieldId}-help`} className={error ? 'field-error' : 'muted'}>
          {error ?? helper}
        </p>
      ) : null}
    </div>
  );
}
export const statusLabels: Record<MeetingStatus, string> = {
  scheduled: '예정',
  'summary-needed': '요약 작성 필요',
  completed: '완료',
  cancelled: '취소',
};
export function StatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <span className={`badge status-${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
export function AvatarGroup({ people, max = 4 }: { people: Person[]; max?: number }) {
  return (
    <div
      className="avatar-group"
      aria-label={`참석자 ${people.length}명: ${people.map((p) => p.name).join(', ')}`}
    >
      {people.slice(0, max).map((person, i) => (
        <span
          key={person.id}
          className={`avatar avatar-${i % 3}`}
          title={person.name}
          aria-hidden="true"
        >
          {person.name.slice(0, 1)}
        </span>
      ))}
      {people.length > max ? (
        <span className="avatar avatar-more" aria-hidden="true">
          +{people.length - max}
        </span>
      ) : null}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
  compact = false,
  illustration,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  compact?: boolean;
  illustration?: ReactNode;
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      {illustration ?? (
        <span className="empty-icon">
          <FileText size={26} />
        </span>
      )}
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}
export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={32} />
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          다시 시도하기 <ArrowRight size={16} />
        </Button>
      ) : null}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-label="홈 정보를 불러오는 중">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
      <div className="skeleton-grid topics-skeleton">
        {[1, 2, 3].map((n) => (
          <div key={n} className="skeleton skeleton-topic" />
        ))}
      </div>
      <span className="sr-only">홈 정보를 불러오는 중입니다.</span>
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  className = '',
  returnFocusRef,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const trigger =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, []);
  function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const dialog = ref.current;
    const elements = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    );
    if (!elements?.length) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <dialog
      ref={ref}
      onKeyDown={trapFocus}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <Button variant="text" className="icon-button" onClick={onClose} aria-label="닫기">
          <X size={22} />
        </Button>
      </div>
      {description ? (
        <p className="muted" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {children}
    </dialog>
  );
}
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="진행 단계">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className={index <= current ? 'active' : ''}
        >
          <span>{index < current ? <Check size={16} /> : index + 1}</span>
          <span className="step-label">
            {step.split(' / ').map((label) => (
              <b key={label}>{label}</b>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}
