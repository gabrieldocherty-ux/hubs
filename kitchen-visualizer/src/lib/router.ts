import { useEffect, useState } from 'react';

export type Route =
  | { name: 'signin' }
  | { name: 'signup' }
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'kitchen'; id: string }
  | { name: 'local' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'signin') return { name: 'signin' };
  if (h === 'signup') return { name: 'signup' };
  if (h === 'new') return { name: 'new' };
  if (h === 'local') return { name: 'local' };
  const m = h.match(/^k\/([0-9a-f-]{36})$/);
  if (m) return { name: 'kitchen', id: m[1] };
  return { name: 'home' };
}

export function hrefFor(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'kitchen':
      return `#/k/${r.id}`;
    default:
      return `#/${r.name}`;
  }
}

export function navigate(r: Route, replace = false) {
  const href = hrefFor(r);
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return route;
}
