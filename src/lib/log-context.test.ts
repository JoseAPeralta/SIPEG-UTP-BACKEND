import { describe, expect, it } from 'vitest';

import { getLogContext, runWithLogContext } from './log-context.js';

describe('log context', () => {
  it('returns an empty context outside of runWithLogContext', () => {
    expect(getLogContext()).toEqual({});
  });

  it('exposes requestId and actorId inside the context', () => {
    runWithLogContext({ requestId: 'req-1', actorId: 'user-1' }, () => {
      expect(getLogContext()).toEqual({ requestId: 'req-1', actorId: 'user-1' });
    });
  });

  it('restores the previous context after exiting', () => {
    runWithLogContext({ requestId: 'outer' }, () => {
      runWithLogContext({ requestId: 'inner' }, () => {
        expect(getLogContext().requestId).toBe('inner');
      });
      expect(getLogContext().requestId).toBe('outer');
    });
    expect(getLogContext()).toEqual({});
  });

  it('propagates the context through awaited promises', async () => {
    const value = await runWithLogContext({ requestId: 'req-z' }, async () => {
      await Promise.resolve();
      return getLogContext().requestId;
    });
    expect(value).toBe('req-z');
  });

  it('keeps concurrent contexts isolated', async () => {
    const read = (delay: number, requestId: string) =>
      runWithLogContext({ requestId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getLogContext().requestId;
      });
    const [first, second] = await Promise.all([read(20, 'req-a'), read(5, 'req-b')]);
    expect(first).toBe('req-a');
    expect(second).toBe('req-b');
  });
});
