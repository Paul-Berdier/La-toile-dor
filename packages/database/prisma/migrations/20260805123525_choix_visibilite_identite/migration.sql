-- CreateEnum
CREATE TYPE "IdentityVisibility" AS ENUM ('MODERATORS', 'MY_GROUPS', 'EVERYONE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "identityVisibility" "IdentityVisibility" NOT NULL DEFAULT 'MY_GROUPS';
