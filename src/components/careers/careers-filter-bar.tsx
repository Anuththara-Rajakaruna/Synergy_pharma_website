"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

export type CareersSortOrder = "newest" | "closing" | "az";

export const CAREERS_SORT_OPTIONS: { value: CareersSortOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "closing", label: "Closing soon" },
  { value: "az", label: "A – Z" },
];

type CareersFilterBarProps = {
  searchTerm: string;
  // Option lists exclude the "All …" entry, which is rendered with an empty value.
  department: string;
  departments: string[];
  jobType: string;
  jobTypes: string[];
  location: string;
  locations: string[];
  sortOrder: CareersSortOrder;
  hasActiveFilters: boolean;
  onSearchChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onJobTypeChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onSortChange: (value: CareersSortOrder) => void;
  onClear: () => void;
};

const labelClass = "mb-2 block text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#42677f]";
const controlClass =
  "h-14 w-full appearance-none rounded-2xl border border-white/70 bg-white/85 text-[0.98rem] text-[#12334a] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition-all duration-300 focus:border-[#57a6d8] focus:bg-white focus:shadow-[0_0_0_5px_rgba(16,117,189,0.12),0_16px_30px_rgba(16,117,189,0.12)]";

function SelectChevron() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-[#5f89a4]"
    />
  );
}

function isSortOrder(value: string): value is CareersSortOrder {
  return CAREERS_SORT_OPTIONS.some((option) => option.value === value);
}

export function CareersFilterBar({
  searchTerm,
  department,
  departments,
  jobType,
  jobTypes,
  location,
  locations,
  sortOrder,
  hasActiveFilters,
  onSearchChange,
  onDepartmentChange,
  onJobTypeChange,
  onLocationChange,
  onSortChange,
  onClear,
}: CareersFilterBarProps) {
  return (
    // Sticky only on large screens: stacked controls would cover most of a phone viewport.
    <div className="relative z-20 lg:sticky lg:top-24" role="search" aria-label="Filter open positions">
      <div className="rounded-[28px] border border-white/60 bg-white/60 p-4 shadow-[0_24px_60px_rgba(16,58,84,0.12)] backdrop-blur-2xl supports-backdrop-filter:bg-white/55 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="group flex-1">
            <span className={labelClass}>Search roles</span>
            <div className="relative">
              <span className="career-icon-frame career-filter-icon pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5f89a4] transition-colors group-focus-within:text-[#1075bd]">
                <span className="career-icon-glyph">
                  <Search className="h-4 w-4" aria-hidden="true" />
                </span>
              </span>
              <input
                type="search"
                name="q"
                placeholder="Title, department, location or keyword"
                autoComplete="off"
                enterKeyHint="search"
                maxLength={100}
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                className={`${controlClass} pl-11 pr-4 placeholder:text-[#587285]`}
              />
            </div>
          </label>

          <label className="group lg:w-56">
            <span className={labelClass}>Department</span>
            <div className="relative">
              <span className="career-icon-frame career-filter-icon pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5f89a4] transition-colors group-focus-within:text-[#1075bd]">
                <span className="career-icon-glyph">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </span>
              </span>
              <select
                name="dept"
                value={department}
                onChange={(event) => onDepartmentChange(event.target.value)}
                className={`${controlClass} pl-11 pr-10`}
              >
                <option value="">All departments</option>
                {departments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          <label className="group lg:w-40">
            <span className={labelClass}>Job type</span>
            <div className="relative">
              <select
                name="type"
                value={jobType}
                onChange={(event) => onJobTypeChange(event.target.value)}
                className={`${controlClass} px-4 pr-10`}
              >
                <option value="">All types</option>
                {jobTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          {/* Location is only worth filtering when roles span several locations. */}
          {locations.length > 1 ? (
            <label className="group lg:w-48">
              <span className={labelClass}>Location</span>
              <div className="relative">
                <select
                  name="loc"
                  value={location}
                  onChange={(event) => onLocationChange(event.target.value)}
                  className={`${controlClass} px-4 pr-10`}
                >
                  <option value="">All locations</option>
                  {locations.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </label>
          ) : null}

          <label className="group lg:w-44">
            <span className={labelClass}>Sort</span>
            <div className="relative">
              <select
                name="sort"
                value={sortOrder}
                onChange={(event) => {
                  if (isSortOrder(event.target.value)) onSortChange(event.target.value);
                }}
                className={`${controlClass} px-4 pr-10`}
              >
                {CAREERS_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>

          <button type="button" onClick={onClear} disabled={!hasActiveFilters} className="careers-filter-clear group">
            <span className="career-icon-frame career-icon-frame-inline relative">
              <span className="career-icon-glyph">
                <X className="h-4 w-4" aria-hidden="true" />
              </span>
            </span>
            <span className="relative">Clear Filters</span>
          </button>
        </div>
      </div>
    </div>
  );
}
