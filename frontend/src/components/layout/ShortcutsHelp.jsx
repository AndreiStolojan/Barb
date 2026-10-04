// The "?" sheet: every registered command that has a key, grouped.

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Kbd } from '@/components/ui/kbd';
import { keyCaps, useCommands } from '@/lib/commands';

export function ShortcutsHelp({ open, onOpenChange }) {
  const commands = useCommands().filter((c) => c.keys);
  const groups = [...new Set(commands.map((c) => c.group))];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Keyboard shortcuts</AlertDialogTitle>
          <AlertDialogDescription>
            Shortcuts change with the screen. These are the ones available right now.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-[0.8125rem] text-muted-foreground-subtle">{group}</p>
              <ul className="divide-y divide-border">
                {commands
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-foreground/85">{c.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {keyCaps(c.keys).map((cap, i) => (
                          <Kbd key={`${cap}-${i}`}>{cap}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
