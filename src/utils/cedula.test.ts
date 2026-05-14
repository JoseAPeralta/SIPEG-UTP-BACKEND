import { describe, expect, it } from 'vitest';

import { isPanamanianCedula, normalizeCedula } from './cedula.js';

describe('cedula utilities', () => {
  it.each([
    '8-123-4567',
    '13-12-123456',
    'E-8-12345',
    'N-12-3456',
    'PE-1-1234',
    'AV-1-1234',
    'PI-1-1234',
  ])('accepts Panamanian cedula format %s', (cedula) => {
    expect(isPanamanianCedula(cedula)).toBe(true);
  });

  it('normalizes cedulas before validation', () => {
    expect(normalizeCedula(' pe-1-1234 ')).toBe('PE-1-1234');
    expect(isPanamanianCedula(' pe-1-1234 ')).toBe(true);
  });

  it.each(['ABC-123', '14-123-4567', '8-123', 'P-1-1234', ''])(
    'rejects invalid cedula format %s',
    (cedula) => {
      expect(isPanamanianCedula(cedula)).toBe(false);
    },
  );
});
