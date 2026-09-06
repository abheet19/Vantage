/**
 * main.tsx — mount the SPA. The only side-effecting module: everything else is a pure component or helper.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ProjectProvider } from './state/ProjectContext.js';
import './ui/tokens.css';
import './ui/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </StrictMode>,
);
