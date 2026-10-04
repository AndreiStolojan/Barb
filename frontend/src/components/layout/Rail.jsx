// ─────────────────────────────────────────────────────────────────────────────
// Rail.jsx — navigation.
//
// Desktop: a 56px icon rail on the left. The inbox is the workspace, so the
// navigation gives it the whole width and stays out of the way. Labels appear
// beside the icon on hover and on keyboard focus.
// Mobile: the same four destinations as a bottom tab bar.
//
// No severity colour here — nothing in the rail is dangerous, only places to go.
// ─────────────────────────────────────────────────────────────────────────────

import { NavLink } from 'react-router-dom';
import { Command, Gauge, Inbox, LifeBuoy, LogOut, Settings, UsersRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { useAuth } from '@/hooks/useAuth';
import { useMailAccount } from '@/context/MailAccountContext';
import { cn } from '@/lib/utils';

export const NAV = [
  { to: '/dashboard', label: 'Briefing', icon: Gauge, keys: 'g b' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, keys: 'g i' },
  { to: '/senders', label: 'Senders', icon: UsersRound, keys: 'g s' },
  { to: '/settings', label: 'Settings', icon: Settings, keys: 'g ,' },
];

const initials = (name, email) => {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

/* The mark: a shield with a check, drawn, so it follows the tokens. */
export function Mark({ className }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-5 w-5', className)}>
      <path
        d="M12 2.75 4.75 5.6v5.5c0 4.36 2.94 8.43 7.25 9.65 4.31-1.22 7.25-5.29 7.25-9.65V5.6L12 2.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m8.9 11.9 2.2 2.2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* A rail button with a hover/focus label to its right. */
function RailItem({ label, keys, children, className, ...props }) {
  return (
    <div className="group relative">
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-full top-1/2 z-50 ml-2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-border-strong bg-popover px-2 py-1 text-xs text-foreground opacity-0 shadow-md transition-opacity duration-[var(--duration-fast)]',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          className
        )}
        {...props}
      >
        {label}
        {keys && (
          <span className="flex items-center gap-0.5">
            {keys.split(' ').map((k) => (
              <Kbd key={k}>{k.toUpperCase()}</Kbd>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

const railButton =
  'focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.07] hover:text-foreground';

function AccountMenu({ align = 'start', side = 'right' }) {
  const { user, logout } = useAuth();
  const { account, isConnected } = useMailAccount();
  const address = account?.accountEmail || account?.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className={cn(railButton, 'relative')}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.1] text-[0.625rem] font-semibold text-foreground">
          {initials(user?.name, user?.email)}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full ring-2 ring-background',
            isConnected ? 'bg-risk-safe' : 'bg-risk-unscanned'
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{user?.name || 'Signed in'}</span>
          <span className="data block truncate">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isConnected ? 'bg-risk-safe' : 'bg-risk-unscanned')} />
          <span className="data truncate">{isConnected ? address || 'Gmail connected' : 'Gmail not connected'}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Rail({ onOpenPalette, onOpenSupport }) {
  return (
    <aside
      aria-label="Primary"
      className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center border-r border-border bg-background py-3 md:flex"
    >
      <NavLink to="/dashboard" aria-label="SecureInbox" className="focus-ring mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-foreground">
        <Mark />
      </NavLink>

      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ to, label, icon: Icon, keys }) => (
          <RailItem key={to} label={label} keys={keys}>
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(railButton, isActive && 'bg-white/[0.09] text-foreground')
              }
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </NavLink>
          </RailItem>
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailItem label="Commands" keys="⌘ k">
          <button type="button" onClick={onOpenPalette} aria-label="Open commands" className={railButton}>
            <Command className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </RailItem>
        <RailItem label="Support">
          <button type="button" onClick={onOpenSupport} aria-label="Contact support" className={railButton}>
            <LifeBuoy className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </RailItem>
        <AccountMenu />
      </div>
    </aside>
  );
}

/* Mobile: the four destinations along the bottom edge. */
export function MobileTabs({ onOpenPalette }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'focus-ring flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium',
              isActive ? 'text-foreground' : 'text-muted-foreground'
            )
          }
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenPalette}
        className="focus-ring flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium text-muted-foreground"
      >
        <Command className="h-5 w-5" strokeWidth={1.75} />
        More
      </button>
    </nav>
  );
}

/* Mobile top bar: mark, screen title, account. */
export function MobileTopbar({ title }) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur md:hidden">
      <Mark className="h-[18px] w-[18px]" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      <AccountMenu align="end" side="bottom" />
    </header>
  );
}
