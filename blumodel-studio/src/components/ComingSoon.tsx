import { Logo } from './Icons';

/**
 * Placeholder for a feature screen that hasn't landed yet. Each feature package replaces its
 * placeholder with the real screen; this component stays for anything still pending.
 */
export function ComingSoon({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="coming-soon">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
      </header>
      <main className="screen-msg">
        <h1 className="coming-soon-title">{title}</h1>
        <p>Coming soon.</p>
        {detail && <p className="coming-soon-detail">{detail}</p>}
        <a className="btn" href="#/">
          Back to Mise
        </a>
      </main>
    </div>
  );
}
