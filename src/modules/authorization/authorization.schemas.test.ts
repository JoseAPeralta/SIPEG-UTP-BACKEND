import { describe, expect, it } from 'vitest';

import { addCollaboratorSchema, collaboratorParamsSchema } from './authorization.schemas.js';

describe('collaborator request schemas', () => {
  it('trims the scope identifier', () => {
    const parsed = collaboratorParamsSchema.parse({ params: { id: '  program-001  ' } });

    expect(parsed.params.id).toBe('program-001');
  });

  it('rejects a blank scope identifier', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects a scope identifier longer than 100 characters', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });

  it('parses a collaborator payload with a known role', () => {
    const parsed = addCollaboratorSchema.parse({
      params: { id: 'program-001' },
      body: { userId: ' user-002 ', role: 'EDITOR' },
    });

    expect(parsed.body).toEqual({ userId: 'user-002', role: 'EDITOR' });
  });

  it('rejects an unknown role', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'OWNER' },
      }),
    ).toThrow();
  });

  it('rejects a missing user', () => {
    expect(() =>
      addCollaboratorSchema.parse({ params: { id: 'p1' }, body: { role: 'VIEWER' } }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'VIEWER', permissions: ['activity:read'] },
      }),
    ).toThrow();
  });
});
