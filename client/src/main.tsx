import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Modal';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { listenForAlerts } from './lib/alertSound';

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 15_000 } } });

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

listenForAlerts();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
