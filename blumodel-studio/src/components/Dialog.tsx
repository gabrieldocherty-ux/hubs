import { useEffect, useRef, type ReactNode } from 'react';
import { Close } from './Icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog that follows the app's rules (src/features/README.md): `role="dialog"`, focus
 * moves in and is trapped there, Esc and the backdrop close it, focus returns on close.
 */
export function Dialog({
  title,
  onClose,
  children,
  className = '',
  wide = false,
  closeLabel = 'Close',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2, 9)}`).current;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal${wide ? ' modal--wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            <Close />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
