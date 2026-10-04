// ─────────────────────────────────────────────────────────────────────────────
// AppShell.jsx — the frame around every signed-in screen.
//
// Rail on the left (desktop) or tabs along the bottom (mobile), the page in the
// middle. The shell also owns the three things that exist on every screen:
// the command palette, the shortcuts sheet and the support dialog, plus the
// global commands that open them and move between screens.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { MailAccountProvider } from '@/context/MailAccountContext';
import { TimeRangeProvider } from '@/context/TimeRangeContext';
import { LoadingState } from '@/components/common/states';
import { useAuth } from '@/hooks/useAuth';
import { useCommandHotkeys, useRegisterCommands } from '@/lib/commands';
import { CommandPalette } from './CommandPalette';
import { MobileTabs, MobileTopbar, NAV, Rail } from './Rail';
import { ShortcutsHelp } from './ShortcutsHelp';
import { SupportDialog } from './SupportDialog';

const titleFor = (pathname) => NAV.find((n) => pathname.startsWith(n.to))?.label || 'SecureInbox';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [support, setSupport] = useState(false);

  useCommandHotkeys();

  useRegisterCommands(
    'shell',
    [
      ...NAV.map((n) => ({
        id: `go-${n.to}`,
        label: `Go to ${n.label}`,
        group: 'Go to',
        keys: n.keys,
        run: () => navigate(n.to),
      })),
      { id: 'palette', label: 'Open commands', group: 'Help', keys: 'mod+k', hidden: true, run: () => setPalette((v) => !v) },
      { id: 'help', label: 'Keyboard shortcuts', group: 'Help', keys: '?', run: () => setHelp(true) },
      { id: 'support', label: 'Contact support', group: 'Help', run: () => setSupport(true) },
      { id: 'logout', label: 'Log out', group: 'Account', run: logout },
    ],
    [navigate, logout]
  );

  return (
    <MailAccountProvider>
      <TimeRangeProvider>
        <div className="flex min-h-dvh bg-background">
          <Rail onOpenPalette={() => setPalette(true)} onOpenSupport={() => setSupport(true)} />

          <div className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
            <MobileTopbar title={titleFor(location.pathname)} />
            <main className="flex min-w-0 flex-1 flex-col">
              <Suspense fallback={<LoadingState />}>
                <Outlet />
              </Suspense>
            </main>
          </div>

          <MobileTabs onOpenPalette={() => setPalette(true)} />
        </div>

        <CommandPalette open={palette} onOpenChange={setPalette} />
        <ShortcutsHelp open={help} onOpenChange={setHelp} />
        <SupportDialog open={support} onOpenChange={setSupport} />
      </TimeRangeProvider>
    </MailAccountProvider>
  );
}
