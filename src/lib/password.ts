import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: Number(process.env['AUTH_ARGON2_MEMORY_COST'] ?? 19_456),
  timeCost: Number(process.env['AUTH_ARGON2_TIME_COST'] ?? 2),
  parallelism: Number(process.env['AUTH_ARGON2_PARALLELISM'] ?? 1),
} as const;

export const hashPassword = async (password: string): Promise<string> => {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password length must be between 12 and 128 characters.');
  }
  return argon2.hash(password, ARGON2_OPTIONS);
};

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};
