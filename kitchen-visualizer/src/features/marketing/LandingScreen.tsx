import { Logo } from '../../components/Icons';
import './marketing.css';

/** Placeholder until package E lands: the landing page (signed-out `#/` and `#/welcome`). */
export default function LandingScreen() {
  return (
    <div className="coming-soon">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <a className="btn" href="#/signin">
          Sign in
        </a>
      </header>
      <main className="screen-msg">
        <h1 className="coming-soon-title">Plan the kitchen before you build it.</h1>
        <p>Landing page coming soon.</p>
        <nav className="coming-soon-actions" aria-label="Get started">
          <a className="btn primary" href="#/signup">
            Start free
          </a>
          <a className="btn" href="#/generate">
            Describe your kitchen
          </a>
          <a className="btn" href="#/local">
            Try without an account
          </a>
        </nav>
      </main>
    </div>
  );
}
