import { AccountMenu } from '../components/AccountMenu';
import { AccountSettingsPage } from '../components/AccountSettings';
import { Logo, Wordmark } from '../components/Icons';
import { LegalLinks } from '../features/legal/LegalLinks';

/** `#/account`: Account settings, in sections (src/components/AccountSettings.tsx). */
export default function AccountScreen() {
  return (
    <div className="acct-page">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <AccountMenu />
      </header>
      <main className="home-main acct-main acct-main--settings">
        <div className="home-head">
          <div>
            <span className="eyebrow">Account</span>
            <h1>Account settings</h1>
          </div>
        </div>
        <AccountSettingsPage />
        <LegalLinks />
      </main>
    </div>
  );
}
