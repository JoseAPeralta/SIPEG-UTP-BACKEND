import { hashPassword } from '../../src/lib/password.js';
import { startOfInstitutionalDay } from '../../src/utils/date.js';

export const SEED_PREFIX = 'seed';
export const DEFAULT_DEMO_PASSWORD = 'Sipeg2026*UTP';

export type SeedWriteMode = 'sync' | 'ensure';

export interface InitialAdminConfig {
  email: string;
  password: string;
  identificationNumber: string;
  firstName: string;
  lastName: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const seedId = (...parts: string[]): string => [SEED_PREFIX, ...parts].join('_');

export const seedCode = (...parts: string[]): string => seedId('code', ...parts);

export const institutionalToday = (now: Date = new Date()): Date => startOfInstitutionalDay(now);

export const dateOffset = (days: number, now: Date = new Date()): Date =>
  new Date(institutionalToday(now).getTime() + days * DAY_MS);

export const instantOffset = (
  days: number,
  hours = 0,
  minutes = 0,
  now: Date = new Date(),
): Date => {
  const value = new Date(now.getTime() + days * DAY_MS);
  value.setUTCHours(hours, minutes, 0, 0);
  return value;
};

export const timeOfDay = (hours: number, minutes = 0): Date =>
  new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));

export const requireEntry = <T>(map: Map<string, T>, key: string, label: string): T => {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Seed catalog error: missing ${label} "${key}".`);
  }
  return value;
};

export const resolveDemoPassword = (): string => {
  if (process.env['NODE_ENV'] === 'production' && process.env['SEED_ALLOW_PRODUCTION'] !== 'true') {
    throw new Error(
      'Refusing to seed test data while NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true to override.',
    );
  }

  const password = process.env['SEED_DEMO_PASSWORD'] ?? DEFAULT_DEMO_PASSWORD;

  if (password.length < 12 || password.length > 128) {
    throw new Error('SEED_DEMO_PASSWORD must be between 12 and 128 characters.');
  }

  return password;
};

export const hashDemoPassword = async (): Promise<string> => hashPassword(resolveDemoPassword());

export const readInitialAdminConfig = (
  env: NodeJS.ProcessEnv = process.env,
): InitialAdminConfig | null => {
  const email = env['SEED_ADMIN_EMAIL']?.trim();
  const password = env['SEED_ADMIN_PASSWORD'];
  const identificationNumber = env['SEED_ADMIN_IDENTIFICATION_NUMBER']?.trim();
  const firstName = env['SEED_ADMIN_FIRST_NAME']?.trim() || 'Administrador';
  const lastName = env['SEED_ADMIN_LAST_NAME']?.trim() || 'SIPEG';

  const provided = [email, password, identificationNumber].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );

  if (provided.length === 0) {
    return null;
  }

  if (!email || !password || !identificationNumber) {
    throw new Error(
      'SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_ADMIN_IDENTIFICATION_NUMBER must be set together to bootstrap the initial ADMIN.',
    );
  }

  if (password.length < 12 || password.length > 128) {
    throw new Error('SEED_ADMIN_PASSWORD must be between 12 and 128 characters.');
  }

  return {
    email: email.toLowerCase(),
    password,
    identificationNumber,
    firstName,
    lastName,
  };
};

export const logStep = (message: string): void => {
  console.log(`[seed] ${message}`);
};
