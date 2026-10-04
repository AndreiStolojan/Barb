// ─────────────────────────────────────────────────────────────────────────────
// AppShell.jsx — the frame around every signed-in screen.
//
// Desktop: the icon rail on the graphite chrome, and the page beside it. A
// page decides what sits on the chrome (the inbox list) and what sits on the
// raised panel (everything you read). Phones: a top bar, the page edge to
// edge, and tabs along the bottom.
//
// The shell owns what exists on every screen: the command palette, the
// shortcut sheet, the support dialog, and the commands that open them.
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
      ...NAV.map((n) => ({ id: `go-${n.to}`, label: `Go to ${n.label}`, group: 'Go to', keys: n.keys, run: () => navigate(n.to) })),
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
        <div className="flex min-h-dvh bg-background md:h-dvh md:overflow-hidden">
          <Rail onOpenPalette={() => setPalette(true)} onOpenSupport={() => setSupport(true)} />

          <div className="flex min-w-0 flex-1 flex-col pb-16 md:py-2.5 md:pb-2.5 md:pr-2.5">
            <MobileTopbar title={titleFor(location.pathname)} onOpenPalette={() => setPalette(true)} onOpenSupport={() => setSupport(true)} />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={<LoadingState />}>
                <Outlet />
              </Suspense>
            </main>
          </div>

          <MobileTabs />
        </div>

        <CommandPalette open={palette} onOpenChange={setPalette} />
        <ShortcutsHelp open={help} onOpenChange={setHelp} />
        <SupportDialog open={support} onOpenChange={setSupport} />
      </TimeRangeProvider>
    </MailAccountProvider>
  );
}

/*
  The raised panel a page reads on. On desktop it scrolls on its own, inside
  the fixed-height shell; on phones it is just the page.
*/
export function PagePanel({ children, className }) {
  return <div className={`panel flex min-h-0 min-w-0 flex-1 flex-col md:overflow-y-auto ${className || ''}`}>{children}</div>;
}
