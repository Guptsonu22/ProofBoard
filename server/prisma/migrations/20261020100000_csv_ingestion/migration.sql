-- CreateTable
CREATE TABLE "DatasetRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "sourceLine" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "hasWarnings" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    CONSTRAINT "DatasetRow_datasetId_userId_fkey" FOREIGN KEY ("datasetId", "userId") REFERENCES "Dataset" ("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalFileName" TEXT,
    "sourceRecordCount" INTEGER NOT NULL DEFAULT 0,
    "parsedRowCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedRowCount" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Dataset" ("createdAt", "id", "name", "originalFileName", "updatedAt", "userId") SELECT "createdAt", "id", "name", "originalFileName", "updatedAt", "userId" FROM "Dataset";
DROP TABLE "Dataset";
ALTER TABLE "new_Dataset" RENAME TO "Dataset";
CREATE INDEX "Dataset_userId_createdAt_idx" ON "Dataset"("userId", "createdAt");
CREATE UNIQUE INDEX "Dataset_id_userId_key" ON "Dataset"("id", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DatasetRow_datasetId_userId_ordinal_idx" ON "DatasetRow"("datasetId", "userId", "ordinal");

-- CreateIndex
CREATE INDEX "DatasetRow_datasetId_userId_rejected_idx" ON "DatasetRow"("datasetId", "userId", "rejected");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetRow_datasetId_ordinal_key" ON "DatasetRow"("datasetId", "ordinal");
