import { useSyncExternalStore } from 'react';
import { fixturesVersion, subscribeFixtures } from './fixtures';

/** Re-renders when a faucet, pull or knob is registered (the retail chunk, an opened kitchen's snapshots). */
export function useFixtureVersion(): number {
  return useSyncExternalStore(subscribeFixtures, fixturesVersion, fixturesVersion);
}
