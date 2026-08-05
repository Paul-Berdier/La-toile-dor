-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "clientProfileId" TEXT,
ADD COLUMN     "targetProfileId" TEXT;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
