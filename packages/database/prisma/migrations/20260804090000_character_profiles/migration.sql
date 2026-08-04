-- CreateEnum
CREATE TYPE "ProfileKnowledgeState" AS ENUM ('UNKNOWN', 'KNOWN', 'NONE_CONFIRMED', 'CONFLICTING');

-- CreateEnum
CREATE TYPE "IntelConfidence" AS ENUM ('RUMOR', 'UNCONFIRMED', 'PROBABLE', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ProfileLifeStatus" AS ENUM ('ALIVE', 'DEAD', 'MISSING');

-- CreateEnum
CREATE TYPE "ProfileSex" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProfileAgeMode" AS ENUM ('UNKNOWN', 'BIRTH_DATE_RP', 'AGE_AT_REFERENCE', 'AGE_RANGE_AT_REFERENCE');

-- CreateEnum
CREATE TYPE "ReferenceSourceScope" AS ENUM ('MANGA_CANON', 'ANIME', 'FILM', 'GAME', 'SERVER_CUSTOM');

-- CreateEnum
CREATE TYPE "ReferenceSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "ProfileRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProfileRelationType" AS ENUM ('PARENT_OF', 'CREATOR_OF', 'SIBLING_OF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'PROFILE_REQUEST_CREATED';
ALTER TYPE "NotificationEvent" ADD VALUE 'PROFILE_REQUEST_APPROVED';
ALTER TYPE "NotificationEvent" ADD VALUE 'PROFILE_REQUEST_REFUSED';
ALTER TYPE "NotificationEvent" ADD VALUE 'PROFILE_UPDATED';

-- CreateTable
CREATE TABLE "ProfileReferenceOption" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kanji" TEXT,
    "romaji" TEXT,
    "category" TEXT,
    "colorHex" TEXT,
    "descriptionShort" TEXT,
    "sourceUrl" TEXT,
    "sourceScope" "ReferenceSourceScope" NOT NULL DEFAULT 'SERVER_CUSTOM',
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileReferenceOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileReferenceSuggestion" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "proposedLabel" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT,
    "sourceScope" "ReferenceSourceScope" NOT NULL DEFAULT 'SERVER_CUSTOM',
    "reason" TEXT,
    "status" "ReferenceSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileReferenceSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterProfile" (
    "id" TEXT NOT NULL,
    "codeNumber" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "characterFirstName" TEXT NOT NULL,
    "firstNameNorm" TEXT NOT NULL,
    "characterLastName" TEXT,
    "sexCode" "ProfileSex",
    "imageData" BYTEA,
    "imageMime" TEXT,
    "heightMinCm" INTEGER,
    "heightMaxCm" INTEGER,
    "hairColorId" TEXT,
    "skinToneId" TEXT,
    "factionId" TEXT,
    "rankId" TEXT,
    "lifeStatus" "ProfileLifeStatus",
    "ageMode" "ProfileAgeMode" NOT NULL DEFAULT 'UNKNOWN',
    "birthRealAt" TIMESTAMP(3),
    "ageYearsAtRef" INTEGER,
    "ageMinAtRef" INTEGER,
    "ageMaxAtRef" INTEGER,
    "ageReferenceRealAt" TIMESTAMP(3),
    "statusChangedRealAt" TIMESTAMP(3),
    "deathRealAt" TIMESTAMP(3),
    "missingSinceRealAt" TIMESTAMP(3),
    "details" TEXT,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "internalNotes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "mergedIntoId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CharacterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterFieldIntel" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "knowledgeState" "ProfileKnowledgeState" NOT NULL DEFAULT 'KNOWN',
    "confidence" "IntelConfidence",
    "sourceMissionId" TEXT,
    "sourceNote" TEXT,
    "observedAtRp" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterFieldIntel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterProfileTrait" (
    "profileId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterProfileTrait_pkey" PRIMARY KEY ("profileId","optionId")
);

-- CreateTable
CREATE TABLE "CharacterSignatureTechnique" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT,
    "jutsuTypeId" TEXT,
    "rank" "MissionRank",
    "knowledgeState" "ProfileKnowledgeState" NOT NULL DEFAULT 'KNOWN',
    "confidence" "IntelConfidence",
    "sourceMissionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterSignatureTechnique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterRelationship" (
    "id" TEXT NOT NULL,
    "fromProfileId" TEXT NOT NULL,
    "toProfileId" TEXT NOT NULL,
    "type" "ProfileRelationType" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterProfileRevision" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedById" TEXT,
    "sourceMissionId" TEXT,
    "confidence" "IntelConfidence",
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterProfileRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePurchaseRequest" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "message" TEXT,
    "status" "ProfileRequestStatus" NOT NULL DEFAULT 'PENDING',
    "priceRyos" INTEGER,
    "moderatorResponse" TEXT,
    "reviewedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProfilePurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileAccessGrant" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "requestId" TEXT,
    "priceRyos" INTEGER,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "ProfileAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileReferenceOption_type_isActive_sortOrder_idx" ON "ProfileReferenceOption"("type", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileReferenceOption_type_code_key" ON "ProfileReferenceOption"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileReferenceOption_type_normalizedLabel_key" ON "ProfileReferenceOption"("type", "normalizedLabel");

-- CreateIndex
CREATE INDEX "ProfileReferenceSuggestion_status_type_idx" ON "ProfileReferenceSuggestion"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterProfile_codeNumber_key" ON "CharacterProfile"("codeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterProfile_code_key" ON "CharacterProfile"("code");

-- CreateIndex
CREATE INDEX "CharacterProfile_firstNameNorm_idx" ON "CharacterProfile"("firstNameNorm");

-- CreateIndex
CREATE INDEX "CharacterProfile_archivedAt_idx" ON "CharacterProfile"("archivedAt");

-- CreateIndex
CREATE INDEX "CharacterProfile_factionId_idx" ON "CharacterProfile"("factionId");

-- CreateIndex
CREATE INDEX "CharacterFieldIntel_sourceMissionId_idx" ON "CharacterFieldIntel"("sourceMissionId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterFieldIntel_profileId_fieldKey_key" ON "CharacterFieldIntel"("profileId", "fieldKey");

-- CreateIndex
CREATE INDEX "CharacterProfileTrait_optionId_idx" ON "CharacterProfileTrait"("optionId");

-- CreateIndex
CREATE INDEX "CharacterSignatureTechnique_profileId_idx" ON "CharacterSignatureTechnique"("profileId");

-- CreateIndex
CREATE INDEX "CharacterRelationship_toProfileId_idx" ON "CharacterRelationship"("toProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterRelationship_fromProfileId_toProfileId_type_key" ON "CharacterRelationship"("fromProfileId", "toProfileId", "type");

-- CreateIndex
CREATE INDEX "CharacterProfileRevision_profileId_createdAt_idx" ON "CharacterProfileRevision"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfilePurchaseRequest_status_requestedAt_idx" ON "ProfilePurchaseRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ProfilePurchaseRequest_groupId_status_idx" ON "ProfilePurchaseRequest"("groupId", "status");

-- CreateIndex
CREATE INDEX "ProfileAccessGrant_groupId_revokedAt_idx" ON "ProfileAccessGrant"("groupId", "revokedAt");

-- CreateIndex
CREATE INDEX "ProfileAccessGrant_profileId_revokedAt_idx" ON "ProfileAccessGrant"("profileId", "revokedAt");

-- AddForeignKey
ALTER TABLE "ProfileReferenceSuggestion" ADD CONSTRAINT "ProfileReferenceSuggestion_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_hairColorId_fkey" FOREIGN KEY ("hairColorId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_skinToneId_fkey" FOREIGN KEY ("skinToneId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "PlayerLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterFieldIntel" ADD CONSTRAINT "CharacterFieldIntel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterFieldIntel" ADD CONSTRAINT "CharacterFieldIntel_sourceMissionId_fkey" FOREIGN KEY ("sourceMissionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfileTrait" ADD CONSTRAINT "CharacterProfileTrait_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfileTrait" ADD CONSTRAINT "CharacterProfileTrait_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProfileReferenceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSignatureTechnique" ADD CONSTRAINT "CharacterSignatureTechnique_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSignatureTechnique" ADD CONSTRAINT "CharacterSignatureTechnique_jutsuTypeId_fkey" FOREIGN KEY ("jutsuTypeId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelationship" ADD CONSTRAINT "CharacterRelationship_fromProfileId_fkey" FOREIGN KEY ("fromProfileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelationship" ADD CONSTRAINT "CharacterRelationship_toProfileId_fkey" FOREIGN KEY ("toProfileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterProfileRevision" ADD CONSTRAINT "CharacterProfileRevision_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePurchaseRequest" ADD CONSTRAINT "ProfilePurchaseRequest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePurchaseRequest" ADD CONSTRAINT "ProfilePurchaseRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAccessGrant" ADD CONSTRAINT "ProfileAccessGrant_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAccessGrant" ADD CONSTRAINT "ProfileAccessGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Garde-fous additionnels (hors périmètre du diff Prisma)
-- ─────────────────────────────────────────────────────────────

-- Une seule demande PENDING par (profil, groupe)
CREATE UNIQUE INDEX "ProfilePurchaseRequest_pending_key"
  ON "ProfilePurchaseRequest"("profileId", "groupId") WHERE "status" = 'PENDING';

-- Un seul acces actif par (profil, groupe)
CREATE UNIQUE INDEX "ProfileAccessGrant_active_key"
  ON "ProfileAccessGrant"("profileId", "groupId") WHERE "revokedAt" IS NULL;

-- Pas de relation d''un profil vers lui-meme
ALTER TABLE "CharacterRelationship"
  ADD CONSTRAINT "CharacterRelationship_no_self" CHECK ("fromProfileId" <> "toProfileId");

-- Plage de taille coherente
ALTER TABLE "CharacterProfile"
  ADD CONSTRAINT "CharacterProfile_height_range"
  CHECK ("heightMinCm" IS NULL OR "heightMaxCm" IS NULL OR "heightMinCm" <= "heightMaxCm");
