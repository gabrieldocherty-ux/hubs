// First: moves browser storage from before the rename to its new keys, before anything reads it.
import './boot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary, QaCrash } from './components/ErrorBoundary';
import { installQaHook } from './lib/interaction';
// Self-hosted faces (public/fonts, SIL OFL), before the styles that name them.
import './fonts.css';
import './styles.css';
// After styles.css: payment notes, the legal footer, the connection banner, error/404 screens, phone rules.
import './launch.css';

installQaHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* The root boundary: anything that escapes a screen's own boundary still gets "Something went wrong · Reload". */}
    <ErrorBoundary>
      <QaCrash where="root" />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
