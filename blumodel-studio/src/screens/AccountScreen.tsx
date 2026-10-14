import { AccountMenu } from '../components/AccountMenu';
import { AccountSettingsForm } from '../components/AccountSettings';
import { Logo, Wordmark } from '../components/Icons';
import { LegalLinks } from '../features/legal/LegalLinks';

/** `#/account`: the same settings as the account menu's dialog, as a page the legal pages link to. */
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
      <main className="home-main acct-main">
        <div className="home-head">
          <div>
            <span className="eyebrow">Account</span>
            <h1>Account settings</h1>
          </div>
          <a className="btn" href="#/account/billing">
            Billing
          </a>
        </div>
        <div className="acct-card">
          <AccountSettingsForm />
        </div>
        <LegalLinks />
      </main>
    </div>
  );
}
