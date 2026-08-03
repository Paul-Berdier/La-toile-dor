-- AlterTable
ALTER TABLE "User" ADD COLUMN     "playerLevelId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_playerLevelId_fkey" FOREIGN KEY ("playerLevelId") REFERENCES "PlayerLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
