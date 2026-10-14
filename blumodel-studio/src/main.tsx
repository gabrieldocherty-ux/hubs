// First: moves browser storage from before the rename to its new keys, before anything reads it.
import './boot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installQaHook } from './lib/interaction';
import './styles.css';
// After styles.css: payment notes, the legal footer, the connection banner, error/404 screens, phone rules.
import './launch.css';

installQaHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
