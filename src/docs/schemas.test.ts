import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { apiErrorResponseSchema, apiSuccessResponse, validationIssueSchema } from './schemas.js';

describe('apiSuccessResponse', () => {
  const schema = apiSuccessResponse(z.object({ userId: z.string() }));

  it('accepts a success envelope wrapping matching data', () => {
    const parsed = schema.parse({
      success: true,
      message: 'Registration successful.',
      data: { userId: 'user-1' },
    });

    expect(parsed.data.userId).toBe('user-1');
  });

  it('rejects a failure envelope', () => {
    expect(() =>
      schema.parse({ success: false, message: 'Nope.', data: { userId: 'user-1' } }),
    ).toThrow();
  });

  it('rejects data that does not match the payload schema', () => {
    expect(() => schema.parse({ success: true, message: 'Ok.', data: { userId: 1 } })).toThrow();
  });
});

describe('validationIssueSchema', () => {
  it('accepts a field/message issue', () => {
    expect(() =>
      validationIssueSchema.parse({ field: 'body.email', message: 'Invalid email format.' }),
    ).not.toThrow();
  });

  it('rejects an issue without a message', () => {
    expect(() => validationIssueSchema.parse({ field: 'body.email' })).toThrow();
  });
});

describe('apiErrorResponseSchema', () => {
  it('accepts a validation error envelope', () => {
    expect(() =>
      apiErrorResponseSchema.parse({
        success: false,
        message: 'Validation error.',
        errors: [{ field: 'body.email', message: 'Invalid email format.' }],
      }),
    ).not.toThrow();
  });

  it('accepts an empty errors array', () => {
    expect(() =>
      apiErrorResponseSchema.parse({ success: false, message: 'Unauthorized.', errors: [] }),
    ).not.toThrow();
  });

  it('rejects a success envelope', () => {
    expect(() =>
      apiErrorResponseSchema.parse({ success: true, message: 'Ok.', errors: [] }),
    ).toThrow();
  });
});
