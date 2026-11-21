import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Modal';
import { App } from './App';
import { ApiError, isTransient, retryDelay } from './lib/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      // Only retry when trying again can help (busy / waking server, dropped connection), with backoff.
      // Retrying 4xx answers like 401 or 404 just adds load, and piling retries on a 429 makes it worse.
      retry: (count, e) => (e instanceof ApiError ? isTransient(e) && count < 3 : count < 2),
      retryDelay,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <DialogProvider>
              <AuthProvider>
                <ErrorBoundary fullScreen>
                  <App />
                </ErrorBoundary>
              </AuthProvider>
            </DialogProvider>
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
