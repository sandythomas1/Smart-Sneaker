import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../packages/design-system/src/tokens.css';
import './app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
