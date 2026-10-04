import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerCommands, useCommandHotkeys } from '../../src/lib/commands.js';

function Hotkeys() {
  useCommandHotkeys();
  return (
    <div>
      <button type="button">page</button>
      <div role="dialog">
        <button type="button">close</button>
      </div>
    </div>
  );
}

const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('useCommandHotkeys', () => {
  let unregister;
  afterEach(() => unregister?.());

  // A key pressed on an open dialog (the shortcut sheet, a confirmation) must
  // never act on the message behind it.
  it('fires on the page but not from inside a dialog', () => {
    const run = vi.fn();
    unregister = registerCommands('test', [{ id: 'p', label: 'Mark phishing', group: 'Message', keys: 'p', run }]);
    const { getByText } = render(<Hotkeys />);

    getByText('close').focus();
    press(getByText('close'), 'p');
    expect(run).not.toHaveBeenCalled();

    getByText('page').focus();
    press(getByText('page'), 'p');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
