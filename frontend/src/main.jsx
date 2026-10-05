import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';

import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ease } from './lib/motion';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user" transition={{ ease, duration: 0.22 }}>
        <AuthProvider>
          <App />
          <Toaster
            position="bottom-right"
            // Phones: sit above the tab bar instead of covering it.
            mobileOffset={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
            duration={3200}
            theme="dark"
            toastOptions={{
              style: {
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border-strong)',
                color: 'var(--color-foreground)',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.8125rem',
              },
            }}
          />
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>
);
