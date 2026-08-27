import type { JobState } from "../jobs/job-types";

export interface UnsubscribeReadinessInput {
  job: { state: JobState } | null;
}

export const unsubscribeAllowsDelete = (
  dashboard: UnsubscribeReadinessInput | null,
): boolean =>
  Boolean(
    dashboard &&
      dashboard.job?.state !== "pending" &&
      dashboard.job?.state !== "running",
  );
