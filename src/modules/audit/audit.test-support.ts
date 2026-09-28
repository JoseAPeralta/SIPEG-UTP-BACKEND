export const AUDIT_TEST_DATABASE_URL_ENV = 'AUDIT_TEST_DATABASE_URL';

export const resolveAuditTestDatabaseUrl = (): string | undefined => {
  const value = process.env[AUDIT_TEST_DATABASE_URL_ENV];

  if (!value) {
    return undefined;
  }

  return value.includes('sipeg_utp') ? value : undefined;
};
