import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The page has no #root element');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App posApi={window.pos} />
    </ErrorBoundary>
  </StrictMode>,
);
