import { createHmac } from 'node:crypto';

import { env } from '../config/env.js';

export const pseudonymize = (value: string): string => {
  const key = env.LOG_PSEUDONYMIZATION_KEY ?? '';
  return createHmac('sha256', key).update(value).digest('hex');
};
