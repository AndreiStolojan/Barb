// ─────────────────────────────────────────────────────────────────────────────
// Rail.jsx — navigation.
//
// Desktop: a 68px icon rail on the graphite chrome. The active destination
// gets the panel colour, so it reads as the tab the panel belongs to. A label
// appears beside each icon on hover and keyboard focus.
// Mobile: the same four destinations as a bottom tab bar.
// ─────────────────────────────────────────────────────────────────────────────

import { NavLink } from 'react-router-dom';
import { Command, Inbox, LayoutGrid, LifeBuoy, LogOut, SlidersHorizontal, UsersRound } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useMailAccount } from '@/context/MailAccountContext';
import { cn } from '@/lib/utils';

export const NAV = [
  { to: '/dashboard', label: 'Briefing', icon: LayoutGrid, keys: 'g b' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, keys: 'g i' },
  { to: '/senders', label: 'Senders', icon: UsersRound, keys: 'g s' },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal, keys: 'g ,' },
];

/** Initials for an avatar: "Andrei Stolojan" → "AS", "github" → "G". */
export const initials = (name, fallback = '?') => {
  const source = String(name || fallback).replace(/[<>"]/g, '').trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.[0] || '?').toUpperCase();
};

/* The mark: a shield with a check, drawn so it follows the tokens. */
export function Mark({ className }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-5 w-5', className)}>
      <path
        d="M12 2.75 4.75 5.6v5.5c0 4.36 2.94 8.43 7.25 9.65 4.31-1.22 7.25-5.29 7.25-9.65V5.6L12 2.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="m8.9 11.9 2.2 2.2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const railButton =
  'focus-ring flex h-[42px] w-[42px] items-center justify-center rounded-xl text-muted-foreground-subtle transition-colors duration-[var(--duration-fast)] hover:text-foreground';

/* A hover / focus label to the right of a rail icon. */
function Tip({ label, children }) {
  return (
    <div className="group relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-[0.8125rem] text-foreground opacity-0 shadow-md ring-1 ring-white/[0.06] transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

function AccountMenu({ onOpenPalette, onOpenSupport, side = 'right', align = 'end' }) {
  const { user, logout } = useAuth();
  const { account, isConnected } = useMailAccount();
  const address = account?.accountEmail || account?.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account" className="focus-ring relative rounded-full">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.09] text-[0.6875rem] font-semibold text-muted-foreground">
          {initials(user?.name || user?.email)}
        </span>
        <span
          aria-hidden="true"
          className={cn('absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full ring-2 ring-background', isConnected ? 'bg-risk-safe' : 'bg-risk-unscanned')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={10} className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{user?.name || 'Signed in'}</span>
          <span className="block truncate">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuLabel className="flex items-center gap-2 pt-0">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isConnected ? 'bg-risk-safe' : 'bg-risk-unscanned')} />
          <span className="truncate">{isConnected ? address || 'Gmail connected' : 'Gmail not connected'}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenPalette}>
          <Command />
          Commands
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSupport}>
          <LifeBuoy />
          Contact support
        </DropdownMenuItem>
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
    <aside aria-label="Primary" className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col items-center gap-1 py-[18px] md:flex">
      <NavLink to="/dashboard" aria-label="SecureInbox" className="focus-ring mb-5 flex h-[42px] w-[42px] items-center justify-center rounded-xl text-foreground">
        <Mark />
      </NavLink>

      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Tip key={to} label={label}>
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) => cn(railButton, isActive && 'bg-panel text-foreground')}
            >
              <Icon className="h-5 w-5" strokeWidth={1.6} />
            </NavLink>
          </Tip>
        ))}
      </nav>

      <div className="mt-auto">
        <AccountMenu onOpenPalette={onOpenPalette} onOpenSupport={onOpenSupport} />
      </div>
    </aside>
  );
}

/* Mobile: the four destinations along the bottom edge. */
export function MobileTabs() {
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
            cn('focus-ring flex flex-1 flex-col items-center gap-1 py-2 text-[0.6875rem] font-medium', isActive ? 'text-foreground' : 'text-muted-foreground-subtle')
          }
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/* Mobile top bar: mark, screen title, account. */
export function MobileTopbar({ title, onOpenPalette, onOpenSupport }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2.5 bg-background/95 px-4 backdrop-blur md:hidden">
      <Mark className="h-5 w-5" />
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
      <AccountMenu onOpenPalette={onOpenPalette} onOpenSupport={onOpenSupport} side="bottom" align="end" />
    </header>
  );
}
