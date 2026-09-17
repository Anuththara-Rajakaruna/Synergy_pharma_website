// Shown instead of the admin workspace skeleton while the sign-in page renders.
export default function AdminLoginLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f7fc] px-4 py-10" role="status" aria-live="polite">
      <span className="sr-only">Loading sign-in…</span>
      <div className="w-full max-w-sm" aria-hidden="true">
        <div className="rounded-[28px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(7,25,38,0.14)] p-8 animate-pulse motion-reduce:animate-none">
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="h-2.5 w-24 rounded-full bg-[#dbe9f2]" />
            <div className="h-6 w-40 rounded-full bg-[#dbe9f2]" />
            <div className="h-3 w-52 rounded-full bg-[#e6f0f6]" />
          </div>
          <div className="space-y-5">
            <div>
              <div className="mb-2 h-2.5 w-24 rounded-full bg-[#dbe9f2]" />
              <div className="h-12 rounded-2xl border border-[#d8eaf3] bg-[#f7fbfd]" />
            </div>
            <div>
              <div className="mb-2 h-2.5 w-20 rounded-full bg-[#dbe9f2]" />
              <div className="h-12 rounded-2xl border border-[#d8eaf3] bg-[#f7fbfd]" />
            </div>
            <div className="h-12 rounded-2xl bg-[#9cc3d6]" />
          </div>
        </div>
      </div>
    </div>
  );
}
