// ─────────────────────────────────────────────────────────────────────────────
// CommandPalette.jsx — Cmd+K. Lists every command the current screen offers,
// filtered as you type, grouped, with the key hint beside each one.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { Search } from 'lucide-react';

import { Kbd } from '@/components/ui/kbd';
import { keyCaps, useCommands } from '@/lib/commands';
import { cn } from '@/lib/utils';

const GROUP_ORDER = ['Message', 'Inbox', 'Go to', 'Actions', 'Help', 'Account'];

export function CommandPalette({ open, onOpenChange }) {
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = commands.filter((c) => !c.hidden && (!q || c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)));
    return [...list].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  const run = (command) => {
    if (!command || command.disabled) return;
    onOpenChange(false);
    // Let the dialog close before the command navigates or focuses something.
    setTimeout(() => command.run(), 0);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(visible[cursor]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = null;

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          onEscapeKeyDown={() => onOpenChange(false)}
          className={cn(
            'fixed left-1/2 top-[14vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-popover shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
        >
          <AlertDialogPrimitive.Title className="sr-only">Commands</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="sr-only">
            Type to filter, arrow keys to move, Enter to run.
          </AlertDialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground-subtle" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command…"
              aria-label="Search commands"
              className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div ref={listRef} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto p-1.5">
            {visible.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">No command matches that.</p>
            )}
            {visible.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              const active = index === cursor;
              return (
                <div key={command.id}>
                  {showGroup && (
                    <p className="px-2.5 pb-1 pt-2.5 text-[0.6875rem] font-medium text-muted-foreground-subtle">
                      {command.group}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    disabled={command.disabled}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => run(command)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[0.8125rem] outline-none transition-colors',
                      active ? 'bg-white/[0.08] text-foreground' : 'text-foreground/85',
                      command.disabled && 'opacity-40'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && (
                      <span className="data truncate text-xs text-muted-foreground-subtle">{command.hint}</span>
                    )}
                    {command.keys && (
                      <span className="flex shrink-0 items-center gap-1">
                        {keyCaps(command.keys).map((cap, i) => (
                          <Kbd key={`${cap}-${i}`}>{cap}</Kbd>
                        ))}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
