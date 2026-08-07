-- Images de preuve jointes aux rapports de mission (jusqu'à 5 par rapport).
-- Stockées en base comme les images de groupe (FS Railway éphémère) et
-- servies via une route authentifiée aux mêmes règles d'accès que le rapport.
CREATE TABLE "MissionReportImage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "imageData" BYTEA NOT NULL,
    "imageMime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionReportImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MissionReportImage_reportId_idx"
ON "MissionReportImage"("reportId");

ALTER TABLE "MissionReportImage"
ADD CONSTRAINT "MissionReportImage_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "MissionReport"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
