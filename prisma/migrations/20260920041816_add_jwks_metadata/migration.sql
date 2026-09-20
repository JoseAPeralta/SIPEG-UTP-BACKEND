-- AlterTable
ALTER TABLE "jwks" ADD COLUMN     "alg" VARCHAR(20),
ADD COLUMN     "crv" VARCHAR(20),
ADD COLUMN     "expires_at" TIMESTAMPTZ(3);
