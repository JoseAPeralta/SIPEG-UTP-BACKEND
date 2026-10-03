import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 20;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: Number(process.env['AUTH_ARGON2_MEMORY_COST'] ?? 12_288),
  timeCost: Number(process.env['AUTH_ARGON2_TIME_COST'] ?? 3),
  parallelism: Number(process.env['AUTH_ARGON2_PARALLELISM'] ?? 1),
} as const;

export const hashPassword = async (password: string): Promise<string> => {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Password length must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
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
