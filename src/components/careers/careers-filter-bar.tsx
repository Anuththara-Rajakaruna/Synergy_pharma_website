"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

type CareersFilterBarProps = {
  searchTerm: string;
  department: string;
  departments: string[];
  resultCount: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onSearchChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onClear: () => void;
};

export function CareersFilterBar({
  searchTerm,
  department,
  departments,
  resultCount,
  isLoading,
  hasActiveFilters,
  onSearchChange,
  onDepartmentChange,
  onClear,
}: CareersFilterBarProps) {
  return (
    <div className="sticky top-24 z-20">
      <div className="rounded-[28px] border border-white/60 bg-white/60 p-4 shadow-[0_24px_60px_rgba(16,58,84,0.12)] backdrop-blur-2xl supports-[backdrop-filter]:bg-white/55 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="group flex-1">
            <span className="mb-2 block text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#42677f]">
              Search by title
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f89a4] transition-colors group-focus-within:text-[#1075bd]" />
              <input
                type="search"
                name="search"
                placeholder="Search open positions"
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-14 w-full rounded-2xl border border-white/70 bg-white/85 pl-11 pr-4 text-[0.98rem] text-[#12334a] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition-all duration-300 placeholder:text-[#7d97a9] focus:border-[#57a6d8] focus:bg-white focus:shadow-[0_0_0_5px_rgba(16,117,189,0.12),0_16px_30px_rgba(16,117,189,0.12)]"
              />
            </div>
          </label>

          <label className="group lg:w-[270px]">
            <span className="mb-2 block text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#42677f]">
              Department
            </span>
            <div className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f89a4] transition-colors group-focus-within:text-[#1075bd]" />
              <select
                value={department}
                onChange={(event) => onDepartmentChange(event.target.value)}
                className="h-14 w-full appearance-none rounded-2xl border border-white/70 bg-white/85 pl-11 pr-10 text-[0.98rem] text-[#12334a] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition-all duration-300 focus:border-[#57a6d8] focus:bg-white focus:shadow-[0_0_0_5px_rgba(16,117,189,0.12),0_16px_30px_rgba(16,117,189,0.12)]"
              >
                {departments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-[#5f89a4]" />
            </div>
          </label>

          <button
            type="button"
            onClick={onClear}
            disabled={!hasActiveFilters}
            className="group relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden rounded-2xl border border-[#d2e4ef] bg-[#edf6fb] px-5 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-[#144564] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b4d4e8] hover:bg-white hover:shadow-[0_16px_30px_rgba(20,69,100,0.12)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-w-[180px]"
          >
            <span className="absolute inset-0 scale-0 rounded-full bg-[#cae7f7] opacity-0 transition-all duration-500 group-hover:scale-[2.3] group-hover:opacity-35" />
            <X className="relative h-4 w-4" />
            <span className="relative">Clear Filters</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-white/60 pt-4 text-sm text-[#456274] sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-[#2f678f]">
            {isLoading ? "Loading roles..." : `${resultCount} roles currently open`}
          </p>
          <p className="text-[#6a8191]">Explore opportunities across quality, manufacturing, and scientific teams.</p>
        </div>
      </div>
    </div>
  );
}
