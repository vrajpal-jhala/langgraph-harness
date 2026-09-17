import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { ErrorBoundary } from '@/components/error-boundary';
import App from './App.tsx';
import { AuthProvider } from './AuthContext.tsx';
import { ContextProvider } from './Context.tsx';
import { theme } from './theme.ts';

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import './styles/index.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications />
      <ErrorBoundary>
        <BrowserRouter>
          <ContextProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ContextProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </MantineProvider>
  </StrictMode>,
);
