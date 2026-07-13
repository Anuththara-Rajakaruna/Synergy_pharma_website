"use client";

import { useEffect } from "react";

export function JobViewTracker({ jobId }: { jobId: string }) {
  useEffect(() => {
    // Fire-and-forget — only real browsers execute this (bots don't run JS)
    void fetch(`/api/jobs/${jobId}/view`, { method: "POST" }).catch(() => {});
  }, [jobId]);

  return null;
}
