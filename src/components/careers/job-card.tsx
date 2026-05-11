"use client";

import Link from "next/link";
import { MapPin, BriefcaseBusiness, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";
import { Job } from "@/types/careers";

type JobCardProps = {
  job: Job;
  index: number;
};

export function JobCard({ job, index }: JobCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: "easeOut" }}
      whileHover={{ y: -3 }}
      style={{ backgroundColor: "#fff" }}
      className="group relative flex w-full overflow-hidden rounded-[28px] border border-[#dceaf3] bg-white px-6 py-5 text-left shadow-[0_16px_34px_rgba(17,58,83,0.08)] outline-none transition-all duration-300 hover:border-[#87c3e5] hover:bg-[linear-gradient(180deg,#ffffff_0%,#f8fcff_100%)] hover:shadow-[0_24px_42px_rgba(17,58,83,0.14)] focus-within:border-[#57a6d8] focus-within:shadow-[0_0_0_5px_rgba(16,117,189,0.12)] md:px-7 md:py-5"
    >
      <Link href={`/careers/${job.id}`} className="absolute inset-0 z-10 rounded-[28px]">
        <span className="sr-only">View details for {job.title}</span>
      </Link>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(71,154,210,0.10),transparent_28%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent via-[#8ecceb] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-7">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-start justify-between gap-4">
            <span className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 group-hover:border-[#a8d4ec] group-hover:bg-[#f7fbfe]">
              {job.department}
            </span>
            <span className="rounded-full bg-[#edf6fb] p-2 text-[#1075bd] transition-all duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:bg-[#dff0fb] lg:hidden">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>

          <h3 className="text-[1.35rem] font-bold leading-tight text-[#0a1f35] transition-colors duration-300 group-hover:text-[#0c4f8f]">
            {job.title}
          </h3>
          <p
            className="mt-2.5 max-w-3xl text-[0.98rem] leading-7 text-[#4d6578]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {job.description}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d7e8f1] bg-white/85 px-3.5 py-2 text-sm font-medium text-[#34596f] transition-all duration-300 group-hover:border-[#b6d8ea] group-hover:bg-[#f7fbfe] group-hover:text-[#1075bd]">
              <MapPin className="h-4 w-4" />
              {job.location}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d7e8f1] bg-white/85 px-3.5 py-2 text-sm font-medium text-[#34596f] transition-all duration-300 group-hover:border-[#b6d8ea] group-hover:bg-[#f7fbfe] group-hover:text-[#1075bd]">
              <BriefcaseBusiness className="h-4 w-4" />
              {job.type}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:w-52.5 lg:items-end">
          <div className="hidden rounded-full bg-[#edf6fb] p-2 text-[#1075bd] transition-all duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:bg-[#dff0fb] lg:block">
            <ArrowUpRight className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-[#6a8191] transition-colors duration-300 group-hover:text-[#355b73] lg:text-right">
            Tap to view details
          </p>
          <div className="pointer-events-none w-full translate-y-0.5 opacity-100 transition-all duration-300 lg:opacity-95 lg:group-hover:-translate-y-0.5 lg:group-hover:opacity-100">
            <span className="relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl bg-[#1075bd] px-4 py-3 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_12px_24px_rgba(16,117,189,0.24)] transition-all duration-300 group-hover:bg-[#0e6dac] group-hover:shadow-[0_16px_32px_rgba(16,117,189,0.30)]">
              <span className="absolute inset-0 scale-0 rounded-full bg-white/30 transition-transform duration-500 group-hover:scale-[2.5]" />
              <span className="relative">View Details</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
