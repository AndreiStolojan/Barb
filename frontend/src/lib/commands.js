// ─────────────────────────────────────────────────────────────────────────────
// commands.js — one registry for everything a keyboard can do.
//
// A page registers the actions it offers (`registerCommands`), and two things
// read that registry: the command palette (Cmd+K) lists them, and the global
// key listener (`useCommandHotkeys`) fires them. So a shortcut and a palette
// entry are never out of sync — they are literally the same object.
//
// A command: { id, label, group, keys?, hint?, run, disabled? }
//   keys  — 'j', 'mod+k', '?' or a two-key sequence like 'g i'.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useSyncExternalStore } from 'react';

const registry = new Map();
const listeners = new Set();
let snapshot = [];

const emit = () => {
  snapshot = [...registry.values()].flat();
  listeners.forEach((l) => l());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Register a page's commands for as long as it is mounted. */
export function registerCommands(key, commands) {
  registry.set(key, commands.filter(Boolean));
  emit();
  return () => {
    registry.delete(key);
    emit();
  };
}

/** React hook: register commands, re-registering when they change. */
export function useRegisterCommands(key, commands, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerCommands(key, commands), deps);
}

/** Every registered command, flat, newest page last. */
export const useCommands = () => useSyncExternalStore(subscribe, () => snapshot);

const isEditable = (el) =>
  Boolean(el) &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/** Normalise a KeyboardEvent to the 'mod+k' / 'j' / '?' vocabulary. */
export function describeKey(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = event.metaKey || event.ctrlKey;
  if (key === 'Shift' || key === 'Meta' || key === 'Control' || key === 'Alt') return null;
  return `${mod ? 'mod+' : ''}${event.altKey ? 'alt+' : ''}${key === '?' ? '?' : key}`;
}

const SEQUENCE_WINDOW_MS = 900;

/**
 * Global key dispatcher. Typing in a field only lets `mod+` shortcuts and
 * Escape through, so a "j" in the search box stays a "j".
 */
export function useCommandHotkeys() {
  useEffect(() => {
    let prefix = null;
    let prefixTimer = null;

    const clearPrefix = () => {
      prefix = null;
      clearTimeout(prefixTimer);
    };

    const onKeyDown = (event) => {
      const desc = describeKey(event);
      if (!desc) return;
      const typing = isEditable(document.activeElement);
      if (typing && !desc.startsWith('mod+') && desc !== 'Escape') return;

      const commands = snapshot.filter((c) => c.keys && !c.disabled);
      const combo = prefix ? `${prefix} ${desc}` : desc;

      const exact = commands.find((c) => c.keys === combo);
      if (exact) {
        event.preventDefault();
        clearPrefix();
        exact.run();
        return;
      }

      // A key that starts a two-key sequence ("g" in "g i") waits briefly.
      if (!prefix && commands.some((c) => c.keys.startsWith(`${desc} `))) {
        event.preventDefault();
        prefix = desc;
        prefixTimer = setTimeout(clearPrefix, SEQUENCE_WINDOW_MS);
        return;
      }
      clearPrefix();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearPrefix();
    };
  }, []);
}

/** 'mod+k' → ['⌘', 'K'] on Mac, ['Ctrl', 'K'] elsewhere. */
export function keyCaps(keys) {
  if (!keys) return [];
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  return keys.split(' ').flatMap((chord) =>
    chord.split('+').map((k) => {
      if (k === 'mod') return mac ? '⌘' : 'Ctrl';
      if (k === 'alt') return mac ? '⌥' : 'Alt';
      if (k === 'Escape') return 'Esc';
      if (k === 'Enter') return '↵';
      if (k === 'ArrowUp') return '↑';
      if (k === 'ArrowDown') return '↓';
      return k.length === 1 ? k.toUpperCase() : k;
    })
  );
}
