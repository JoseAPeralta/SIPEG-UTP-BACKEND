-- CreateIndex
CREATE INDEX "activities_status_date_start_time_idx" ON "activities"("status", "date", "start_time");
