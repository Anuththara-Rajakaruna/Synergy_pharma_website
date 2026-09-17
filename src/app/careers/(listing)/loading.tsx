import "@/components/careers/careers-public.css";

const cardClass =
  "animate-pulse rounded-[28px] border border-[#e0ebf3] bg-white px-6 py-5 shadow-[0_16px_34px_rgba(17,58,83,0.08)] md:px-7 md:py-5";

export default function CareersLoading() {
  return (
    <main className="careers-page careers-skeleton" aria-busy="true">
      {/* Header-height spacer. The client SiteHeader is not rendered in the streamed loading shell:
          its chunk would be emitted as a script tag without the CSP nonce and be blocked. */}
      <div aria-hidden="true" className="h-[88px]" />
      <span className="sr-only" role="status">
        Loading open roles…
      </span>

      <section className="careers-loading-top" aria-hidden="true">
        <div className="careers-shell">
          <div className="mx-auto flex max-w-3xl animate-pulse flex-col items-center gap-4">
            <div className="h-4 w-44 rounded-full bg-[#dcecf5]" />
            <div className="h-10 w-full max-w-xl rounded-2xl bg-[#dcecf5]" />
            <div className="h-5 w-4/5 rounded-full bg-[#e6f2f8]" />
          </div>
        </div>
      </section>

      <section className="careers-jobs-section" aria-hidden="true">
        <div className="careers-shell space-y-6">
          <div className="h-24 animate-pulse rounded-[28px] border border-white/60 bg-white/60 shadow-[0_24px_60px_rgba(16,58,84,0.12)]" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={cardClass}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="h-6 w-28 rounded-full bg-[#dcecf5]" />
                    <div className="mt-4 h-7 w-3/5 rounded-xl bg-[#dcecf5]" />
                    <div className="mt-3 h-4 w-full rounded-full bg-[#e6f2f8]" />
                    <div className="mt-2.5 h-4 w-5/6 rounded-full bg-[#e6f2f8]" />
                  </div>
                  <div className="flex flex-col gap-3 lg:w-52.5 lg:items-end">
                    <div className="h-9 w-9 rounded-full bg-[#e6f2f8]" />
                    <div className="h-4 w-32 rounded-full bg-[#e6f2f8]" />
                    <div className="h-12 w-40 rounded-2xl bg-[#dcecf5]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
