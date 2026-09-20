-- CreateEnum
CREATE TYPE "PermissionGrantSource" AS ENUM ('ROLE_DEFAULT', 'OVERRIDE');

-- AlterTable
ALTER TABLE "collaboration_permissions" ADD COLUMN     "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "granted_by_id" TEXT,
ADD COLUMN     "source" "PermissionGrantSource" NOT NULL DEFAULT 'OVERRIDE',
ADD COLUMN     "valid_from" TIMESTAMPTZ(3),
ADD COLUMN     "valid_until" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "collaboration_permissions_valid_until_idx" ON "collaboration_permissions"("valid_until");

-- CreateIndex
CREATE INDEX "collaboration_permissions_granted_by_id_idx" ON "collaboration_permissions"("granted_by_id");

-- AddForeignKey
ALTER TABLE "collaboration_permissions" ADD CONSTRAINT "collaboration_permissions_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "collaboration_permissions"
  ADD CONSTRAINT "collaboration_permissions_valid_window_check"
  CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from");

