"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { Job } from "@/types/careers";

type JobQuickViewModalProps = {
  job: Job | null;
  onClose: () => void;
};

export function JobQuickViewModal({ job, onClose }: JobQuickViewModalProps) {
  useEffect(() => {
    if (!job) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [job, onClose]);

  return (
    <AnimatePresence>
      {job ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#071926]/55 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
            className="relative w-full max-w-2xl overflow-hidden rounded-[30px] border border-white/65 bg-[linear-gradient(160deg,rgba(255,255,255,0.98),rgba(236,245,250,0.94))] shadow-[0_40px_90px_rgba(7,25,38,0.28)]"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-[#79c4e6] via-[#1075bd] to-[#79c4e6]" />

            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/85 text-[#295a79] transition-all duration-300 hover:rotate-90 hover:border-[#abd5ea] hover:text-[#1075bd]"
              aria-label="Close quick view"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-6 md:p-8">
              <div className="pr-14">
                <p className="text-[0.74rem] font-bold uppercase tracking-[0.18em] text-[#1075bd]">
                  {job.department}
                </p>
                <h3 className="mt-3 text-[1.8rem] font-bold leading-tight text-[#0a1f35]">
                  {job.title}
                </h3>
                <p className="mt-4 text-[1rem] leading-7 text-[#4d6578]">{job.description}</p>
              </div>

              <div className="mt-6 grid gap-4 rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <div className="flex flex-wrap gap-3">
                  <span className="rounded-full bg-[#edf6fb] px-3.5 py-2 text-sm font-medium text-[#34596f]">
                    {job.location}
                  </span>
                  <span className="rounded-full bg-[#edf6fb] px-3.5 py-2 text-sm font-medium text-[#34596f]">
                    {job.type}
                  </span>
                </div>

                <div>
                  <p className="text-[0.74rem] font-bold uppercase tracking-[0.16em] text-[#42677f]">
                    Key requirements
                  </p>
                  <ul className="mt-3 grid gap-3">
                    {job.requirements.slice(0, 3).map((requirement) => (
                      <li
                        key={requirement}
                        className="rounded-2xl border border-[#d8e9f2] bg-[#f7fbfd] px-4 py-3 text-[0.96rem] leading-7 text-[#456274]"
                      >
                        {requirement}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={`/careers/${job.id}#apply`}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#1075bd] px-5 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(16,117,189,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-[#0c68a7]"
                >
                  Apply Now
                </a>
                <Link
                  href={`/careers/${job.id}`}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-[#cce3ef] bg-white px-5 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-[#144564] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#9ccce6] hover:text-[#1075bd]"
                >
                  View Full Details
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
