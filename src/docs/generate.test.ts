import { describe, expect, it } from 'vitest';

import { serializeOpenApiDocument } from './generate.js';

describe('serializeOpenApiDocument', () => {
  it('serializes the document deterministically with a trailing newline', () => {
    const first = serializeOpenApiDocument();
    const second = serializeOpenApiDocument();

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(JSON.parse(first).openapi).toBe('3.1.0');
  });

  it('includes the documented routes', () => {
    const parsed = JSON.parse(serializeOpenApiDocument()) as {
      paths: Record<string, unknown>;
    };

    expect(parsed.paths).toHaveProperty('/api/v1/users/me');
    expect(parsed.paths).toHaveProperty('/api/v1/activities');
  });
});
