import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_NAMES,
  ROLE_DEFAULTS,
} from './permissions.js';

describe('permission catalog', () => {
  it('exposes unique resource:action keys', () => {
    expect(new Set(PERMISSION_NAMES).size).toBe(PERMISSION_NAMES.length);

    for (const name of PERMISSION_NAMES) {
      expect(name).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('documents every permission', () => {
    for (const name of PERMISSION_NAMES) {
      expect(PERMISSION_DESCRIPTIONS[name]).toBeTruthy();
    }
  });

  it('never grants permission:grant through role defaults', () => {
    for (const defaults of Object.values(ROLE_DEFAULTS)) {
      expect(defaults).not.toContain(PERMISSIONS.PERMISSION_GRANT);
    }
  });

  it('escalates role defaults monotonically', () => {
    const viewer = new Set(ROLE_DEFAULTS.VIEWER);
    const editor = new Set(ROLE_DEFAULTS.EDITOR);
    const organizer = new Set(ROLE_DEFAULTS.ORGANIZER);

    for (const permission of viewer) {
      expect(editor.has(permission)).toBe(true);
    }

    for (const permission of editor) {
      expect(organizer.has(permission)).toBe(true);
    }
  });

  it('only uses catalog names in role defaults', () => {
    const catalog = new Set<string>(PERMISSION_NAMES);

    for (const defaults of Object.values(ROLE_DEFAULTS)) {
      for (const permission of defaults) {
        expect(catalog.has(permission)).toBe(true);
      }
    }
  });
});
