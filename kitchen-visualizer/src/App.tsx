import { useEffect } from 'react';
import { navigate, useRoute } from './lib/router';
import { useSession } from './store/useSession';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SetupWizard } from './screens/SetupWizard';
import { KitchenEditor, LocalEditor } from './screens/Editor';

export default function App() {
  const route = useRoute();
  const status = useSession((s) => s.status);
  const init = useSession((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  const needsAccount = route.name === 'home' || route.name === 'new' || route.name === 'kitchen';
  const authPage = route.name === 'signin' || route.name === 'signup';

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'signedIn' && needsAccount) navigate({ name: 'signin' }, true);
    if (status === 'signedIn' && authPage) navigate({ name: 'home' }, true);
  }, [status, needsAccount, authPage]);

  if (route.name === 'local') return <LocalEditor />;
  if (status === 'loading') return <div className="screen-msg">Loading…</div>;
  if (status !== 'signedIn') return <AuthScreen mode={route.name === 'signup' ? 'signup' : 'signin'} />;
  switch (route.name) {
    case 'new':
      return <SetupWizard />;
    case 'kitchen':
      return <KitchenEditor key={route.id} id={route.id} />;
    default:
      return <HomeScreen />;
  }
}
