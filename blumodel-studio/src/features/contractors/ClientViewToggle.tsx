import { useEffect } from 'react';
import { Present } from '../../components/Icons';
import { useDesignStore } from '../../store/useDesignStore';
import { useClientView, usePriceBook } from './pricing';

/**
 * The estimate's Contractor view / Client view switch (PLANS_AND_CONTRACTORS §4.5). Client view, the
 * default, shows sell prices only; Contractor view adds cost, markup and margin. Null for anyone
 * who isn't a contractor, and hidden while presenting.
 */
export function ClientViewToggle(): JSX.Element | null {
  const { isContractor } = usePriceBook();
  const view = useClientView((s) => s.view);
  const presenting = useClientView((s) => s.presenting);
  const readOnly = useDesignStore((s) => s.readOnly);
  if (!isContractor || presenting || readOnly) return null;
  return (
    <div className="client-view-toggle" role="radiogroup" aria-label="Estimate view">
      <button role="radio" aria-checked={view === 'client'} className={view === 'client' ? 'on' : ''} onClick={() => useClientView.setState({ view: 'client' })}>
        Client view
      </button>
      <button role="radio" aria-checked={view === 'contractor'} className={view === 'contractor' ? 'on' : ''} onClick={() => useClientView.setState({ view: 'contractor' })}>
        Contractor view
      </button>
    </div>
  );
}

/**
 * TopBar button for presentation mode: full screen, Client view forced, costs hidden, for showing a
 * customer on a laptop or TV. Leaving full screen (Esc) ends it.
 */
export function PresentButton({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { isContractor } = usePriceBook();
  const presenting = useClientView((s) => s.presenting);

  useEffect(() => {
    if (!presenting) return;
    document.documentElement.classList.add('is-presenting');
    const onFs = () => {
      if (!document.fullscreenElement) useClientView.setState({ presenting: false });
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.documentElement.classList.remove('is-presenting');
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [presenting]);

  useEffect(() => () => useClientView.setState({ presenting: false }), []);

  if (!isContractor) return null;
  const toggle = async () => {
    if (presenting) {
      useClientView.setState({ presenting: false });
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    useClientView.setState({ presenting: true, view: 'client' });
    // Full screen where the browser allows it; presentation mode works without it too.
    await document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return (
    <button className={presenting ? 'btn primary present-btn' : compact ? 'icon-btn present-btn' : 'btn present-btn'} onClick={toggle} aria-pressed={presenting} title={presenting ? 'Stop presenting (Esc)' : 'Present to a client: full screen, no costs'}>
      <Present width={compact ? 20 : 16} height={compact ? 20 : 16} />
      {!compact && <span>{presenting ? 'Stop presenting' : 'Present'}</span>}
    </button>
  );
}
