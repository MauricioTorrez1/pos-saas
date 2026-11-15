import { describe, expect, it } from 'vitest';

import {
  actionOf,
  comboLabel,
  comboOf,
  DEFAULT_KEYMAP,
  DEFAULT_TICKET_DESIGN,
  isKeymap,
  isTicketDesign,
  KEY_ACTIONS,
  normalizePrinterShare,
  problemWithCombo,
} from './register-tools';

const press = (key: string, modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('the keys of the register', () => {
  it('gives every action a different key out of the box', () => {
    expect(isKeymap(DEFAULT_KEYMAP)).toBe(true);
    expect(new Set(Object.values(DEFAULT_KEYMAP)).size).toBe(KEY_ACTIONS.length);
  });

  it('writes a key press the way the keymap stores it', () => {
    expect(comboOf(press('F12'))).toBe('F12');
    expect(comboOf(press('F11', { shiftKey: true }))).toBe('Shift+F11');
    expect(comboOf(press('p', { ctrlKey: true }))).toBe('Ctrl+P');
    expect(comboOf(press('Delete', { shiftKey: true }))).toBe('Shift+Delete');
  });

  it('refuses the keys the sale and the scanner count on', () => {
    for (const key of ['Enter', 'Escape', 'ArrowDown', '+', '-', 'a', '7', 'Delete', 'Tab']) {
      expect(comboOf(press(key)), key).toBeNull();
    }
    expect(problemWithCombo('A')).toContain('Ctrl o Alt');
    expect(problemWithCombo('Delete')).toContain('Combínala');
    expect(problemWithCombo('Shift+Shift+F1')).not.toBeNull();
  });

  it('finds the action of a key, and nothing for a key without one', () => {
    expect(actionOf(DEFAULT_KEYMAP, press('F12'))).toBe('checkout');
    expect(actionOf(DEFAULT_KEYMAP, press('F11', { shiftKey: true }))).toBe('supplierOrder');
    expect(actionOf({ ...DEFAULT_KEYMAP, checkout: 'Ctrl+K' }, press('k', { ctrlKey: true }))).toBe('checkout');
    expect(actionOf(DEFAULT_KEYMAP, press('F12', { ctrlKey: true }))).toBeNull();
  });

  it('refuses a keymap with a key twice, a missing action, or a key that cannot be used', () => {
    expect(isKeymap({ ...DEFAULT_KEYMAP, misc: 'F12' })).toBe(false);
    expect(isKeymap({ ...DEFAULT_KEYMAP, misc: 'Enter' })).toBe(false);
    const { misc: _misc, ...withoutMisc } = DEFAULT_KEYMAP;
    expect(isKeymap(withoutMisc)).toBe(false);
    expect(isKeymap(null)).toBe(false);
  });

  it('shows a key the way the keyboard is labelled in Spanish', () => {
    expect(comboLabel('Shift+Delete')).toBe('Mayús Supr');
    expect(comboLabel('Ctrl+P')).toBe('Ctrl P');
  });
});

describe('the design of the ticket', () => {
  it('accepts the plain ticket and refuses what does not fit the paper', () => {
    expect(isTicketDesign(DEFAULT_TICKET_DESIGN)).toBe(true);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, columns: 40 })).toBe(false);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, copies: 4 })).toBe(false);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, headerLines: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, footerLines: ['x'.repeat(49)] })).toBe(false);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, headerLines: ['salto\nde línea'] })).toBe(false);
  });
});

describe('the printer the owner types', () => {
  it('takes a bare name as a printer of this computer, and a full path as it is', () => {
    expect(normalizePrinterShare('  TM-T20 ')).toBe('\\\\localhost\\TM-T20');
    expect(normalizePrinterShare('\\\\caja2\\EPSON')).toBe('\\\\caja2\\EPSON');
    expect(normalizePrinterShare('')).toBe('');
  });

  it('refuses a path that is not a shared printer', () => {
    expect(normalizePrinterShare('C:\\impresora')).toBeNull();
    expect(normalizePrinterShare('\\\\solo-pc')).toBeNull();
  });
});
