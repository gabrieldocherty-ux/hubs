import { useDesignStore } from '../store/useDesignStore';
import { Alert, Check, Close, Info } from './Icons';

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
    </div>
  );
}
