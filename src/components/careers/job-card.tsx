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
      whileHover={{ y: -4 }}
      style={{ backgroundColor: "#fff" }}
      className="group relative flex w-full overflow-hidden rounded-[28px] border border-white/65 bg-white p-6 text-left shadow-[0_18px_42px_rgba(17,58,83,0.10)] outline-none transition-all duration-300 hover:border-[#8cc7e8] hover:shadow-[0_26px_50px_rgba(17,58,83,0.14)] focus-visible:border-[#57a6d8] focus-visible:shadow-[0_0_0_5px_rgba(16,117,189,0.15)] md:p-7"
    >
      <Link href={`/careers/${job.id}`} className="absolute inset-0 z-10">
        <span className="sr-only">View details for {job.title}</span>
      </Link>
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#8ecceb] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex w-full flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-start justify-between gap-4">
            <span className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              {job.department}
            </span>
            <span className="rounded-full bg-[#edf6fb] p-2 text-[#1075bd] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 lg:hidden">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>

          <h3 className="text-[1.35rem] font-bold leading-tight text-[#0a1f35] transition-colors duration-300 group-hover:text-[#0c4f8f]">
            {job.title}
          </h3>
          <p
            className="mt-3 max-w-3xl text-[0.98rem] leading-7 text-[#4d6578]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {job.description}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d7e8f1] bg-white/85 px-3.5 py-2 text-sm font-medium text-[#34596f] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#9bcce6] hover:bg-[#f5fbfe] hover:text-[#1075bd]">
              <MapPin className="h-4 w-4" />
              {job.location}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d7e8f1] bg-white/85 px-3.5 py-2 text-sm font-medium text-[#34596f] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#9bcce6] hover:bg-[#f5fbfe] hover:text-[#1075bd]">
              <BriefcaseBusiness className="h-4 w-4" />
              {job.type}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-4 lg:w-[220px] lg:items-end">
          <div className="hidden rounded-full bg-[#edf6fb] p-2 text-[#1075bd] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 lg:block">
            <ArrowUpRight className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-[#6a8191] lg:text-right">Tap to view details</p>
          <div className="pointer-events-none w-full translate-y-2 opacity-100 transition-all duration-300 lg:opacity-90 lg:group-hover:translate-y-0 lg:group-hover:opacity-100">
            <span className="relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl bg-[#1075bd] px-4 py-3 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(16,117,189,0.28)]">
              <span className="absolute inset-0 scale-0 rounded-full bg-white/30 transition-transform duration-500 group-hover:scale-[2.5]" />
              <span className="relative">View Details</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
