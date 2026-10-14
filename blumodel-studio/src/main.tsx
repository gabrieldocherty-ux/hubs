// First: moves browser storage from before the rename to its new keys, before anything reads it.
import './boot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installQaHook } from './lib/interaction';
import './styles.css';

installQaHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
