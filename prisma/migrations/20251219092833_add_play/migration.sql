-- CreateTable
CREATE TABLE "Play" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "playedAt" DATETIME NOT NULL,
    "contextType" TEXT,
    "contextUri" TEXT,
    CONSTRAINT "Play_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Play_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Play_userId_playedAt_idx" ON "Play"("userId", "playedAt");

-- CreateIndex
CREATE INDEX "Play_trackId_idx" ON "Play"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "Play_userId_trackId_playedAt_key" ON "Play"("userId", "trackId", "playedAt");
