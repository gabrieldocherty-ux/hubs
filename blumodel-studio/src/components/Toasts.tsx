import { useDesignStore } from '../store/useDesignStore';
import { Alert, Check, Close, Info } from './Icons';
import { ContractorFinder } from '../features/finder';

export function Toasts() {
  const toasts = useDesignStore((s) => s.toasts);
  const dismiss = useDesignStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === 'ok' ? <Check /> : t.tone === 'warn' ? <Alert /> : <Info />}
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><Close width={14} height={14} /></button>
        </div>
      ))}
      {/* For a while after an export in the editor: a quiet "Need a contractor?" under the toast. */}
      <ContractorFinder where="export" />
    </div>
  );
}
