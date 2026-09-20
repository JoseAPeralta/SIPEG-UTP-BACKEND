const TTL_PATTERN = /^(\d+)([smhd])$/;

const TTL_MULTIPLIERS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

export const parseTtlToMilliseconds = (ttl: string): number => {
  const match = TTL_PATTERN.exec(ttl);
  if (!match) {
    throw new Error(`Invalid TTL: ${ttl}`);
  }

  const value = Number(match[1]);
  const unit = match[2] as keyof typeof TTL_MULTIPLIERS;
  return value * TTL_MULTIPLIERS[unit];
};

export const parseTtlToSeconds = (ttl: string): number => parseTtlToMilliseconds(ttl) / 1000;
