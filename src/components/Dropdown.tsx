import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LockKeyhole } from 'lucide-react';
import './dropdown.css';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}
/** Shared single-select with a viewport-aligned menu, including inside scrolling tables. */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  tone?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const open = Boolean(position) && !disabled;
  function show() {
    if (disabled) return;
    const bounds = trigger.current!.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const height = Math.min(280, options.length * 76 + 16);
    setPosition({
      width,
      left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
      top:
        bounds.bottom + height + 8 < window.innerHeight
          ? bounds.bottom + 8
          : Math.max(12, bounds.top - height - 8),
    });
  }
  function close(restore = false) {
    setPosition(undefined);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    buttons?.[
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      )
    ]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setPosition(undefined);
    };
    const reposition = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) show();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
    // Opening the menu establishes focus; options are supplied by the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={`butler-dropdown dropdown-${tone}`}
        ref={trigger}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        {selected?.icon}
        <span>{selected?.label}</span>
        {disabled ? (
          <LockKeyhole className="dropdown-chevron" size={14} aria-hidden="true" />
        ) : (
          <ChevronDown className="dropdown-chevron" size={16} aria-hidden="true" />
        )}
      </button>
      {open && position
        ? createPortal(
            <div
              className="butler-dropdown-menu"
              ref={menu}
              id={id}
              role="listbox"
              aria-label={label}
              style={position}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) close();
              }}
              onKeyDown={(event) => {
                const buttons = Array.from(
                  menu.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
                );
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length;
                  buttons[next]?.focus({ preventScroll: true });
                }
              }}
            >
              {options.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    close(true);
                  }}
                >
                  {option.icon ? <span className="dropdown-option-icon">{option.icon}</span> : null}
                  <span className="dropdown-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                  {option.value === value ? (
                    <Check size={17} className="dropdown-check" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>,
            trigger.current?.closest('dialog') ?? document.body,
          )
        : null}
    </>
  );
}
