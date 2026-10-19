/**
 * A person's preferences (Account settings > Preferences and Email notifications), for the whole
 * app: the appearance, the cost estimator switch and sign-in alerts.
 *
 * - Signed in: read from and saved to the account (`/api/account/prefs`), so they follow the person
 *   to another device. The estimator switch is also remembered in this browser for that account, so
 *   the editor doesn't blink while the account's copy loads.
 * - Signed out or designing on this device: the defaults. The cost estimator is OFF.
 * - Appearance is special: it is kept in this browser too (theme.ts), so it applies before the first
 *   paint and on the sign-in page. An account's saved choice wins when it loads.
 */
import { create } from 'zustand';
import { useSession } from '../store/useSession';
import { accountApi, type AccountPrefs } from './accountApi';
import { applyTheme, readThemePref } from './theme';

export const DEFAULT_PREFS: AccountPrefs = Object.freeze({ theme: 'system', showEstimator: false, signInAlerts: true }) as AccountPrefs;

const CACHE_KEY = 'blumodel.prefs';

interface PrefsState {
  /** The account these are for, or null (signed out / device-only: the defaults). */
  userId: string | null;
  prefs: AccountPrefs;
  /** The account's copy has arrived (or there is no account). */
  loaded: boolean;
  /** The server can send email: Account settings shows Email notifications only then. */
  emailEnabled: boolean;
}

export const usePrefs = create<PrefsState>()(() => ({
  userId: null,
  prefs: { ...DEFAULT_PREFS, theme: readThemePref() },
  loaded: true,
  emailEnabled: false,
}));

function readCache(userId: string): Partial<AccountPrefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && raw.u === userId && typeof raw.showEstimator === 'boolean') return { showEstimator: raw.showEstimator };
  } catch {
    /* blocked or corrupt: no cache */
  }
  return {};
}

function writeCache(userId: string | null, prefs: AccountPrefs) {
  try {
    if (userId) localStorage.setItem(CACHE_KEY, JSON.stringify({ u: userId, showEstimator: prefs.showEstimator }));
  } catch {
    /* storage blocked */
  }
}

let loading: Promise<void> | null = null;

/** Reads the account's preferences (after sign-in, or on boot). Never throws. */
export function loadPrefs(): Promise<void> {
  const userId = usePrefs.getState().userId;
  if (!userId) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const wire = await accountApi.prefs();
      if (usePrefs.getState().userId !== userId) return;
      const prefs = { ...DEFAULT_PREFS, ...wire.prefs };
      // A choice saved to the account wins; one never saved leaves this browser's own.
      if (wire.saved) applyTheme(prefs.theme);
      else prefs.theme = readThemePref();
      usePrefs.setState({ prefs, loaded: true, emailEnabled: !!wire.emailEnabled });
      writeCache(userId, prefs);
    } catch {
      // Offline or an older server: keep what we have (the defaults, or this browser's copy).
      usePrefs.setState({ loaded: true });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * Changes preferences now (the page reacts at once) and saves them to the account when signed in.
 * Rejects with the server's error after putting the old values back; the appearance stays applied
 * in this browser either way.
 */
export async function setPrefs(patch: Partial<AccountPrefs>): Promise<void> {
  const { userId, prefs: before } = usePrefs.getState();
  const next = { ...before, ...patch };
  if (patch.theme) applyTheme(patch.theme);
  usePrefs.setState({ prefs: next });
  writeCache(userId, next);
  if (!userId) return;
  try {
    const wire = await accountApi.savePrefs(patch);
    if (usePrefs.getState().userId === userId) {
      usePrefs.setState({ prefs: { ...DEFAULT_PREFS, ...wire.prefs }, emailEnabled: !!wire.emailEnabled });
      writeCache(userId, { ...DEFAULT_PREFS, ...wire.prefs });
    }
  } catch (err) {
    if (usePrefs.getState().userId === userId) {
      const restored = { ...before, theme: patch.theme ?? before.theme };
      usePrefs.setState({ prefs: restored });
      writeCache(userId, restored);
    }
    throw err;
  }
}

function follow(userId: string | null) {
  if (usePrefs.getState().userId === userId) return;
  const theme = readThemePref();
  if (!userId) {
    usePrefs.setState({ userId: null, prefs: { ...DEFAULT_PREFS, theme }, loaded: true, emailEnabled: false });
    return;
  }
  usePrefs.setState({ userId, prefs: { ...DEFAULT_PREFS, ...readCache(userId), theme }, loaded: false });
  void loadPrefs();
}

let started = false;

/** Boot (main.tsx): follows the signed-in account. Safe to call more than once. */
export function initPrefs() {
  if (started) return;
  started = true;
  follow(useSession.getState().user?.id ?? null);
  useSession.subscribe((s) => follow(s.user?.id ?? null));
}

/**
 * Whether the editor shows its cost estimator (the Est. chip, the Estimate tab and estimate totals).
 * Off for signed-out and device-only use, and until the person turns it on in Account settings.
 */
export function useShowEstimator(): boolean {
  const user = useSession((s) => s.user?.id ?? null);
  return usePrefs((s) => !!user && s.userId === user && s.prefs.showEstimator);
}
