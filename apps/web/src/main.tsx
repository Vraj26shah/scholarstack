import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initAnalytics } from './lib/analytics';
import { installOfflineCache } from './lib/offline-cache';
import { installProblemReporting } from './lib/problems';
import { installReleaseSync } from './lib/release-sync';
import './styles/index.css';

initAnalytics();
installProblemReporting();
installOfflineCache();
installReleaseSync();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
