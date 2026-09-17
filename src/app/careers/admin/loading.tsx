
// Skeleton of the admin workspace (top bar, stat cards, tabs, list) using the admin card styles.

function Bar({ className }: { className: string }) {
  return <div className={`rounded-full bg-[#dbe9f2] ${className}`} />;
}

export default function CareersAdminLoading() {
  return (
    <main className="careers-admin-page">
      {/* Header-height spacer. The client SiteHeader is not rendered in the streamed loading shell:
          its chunk would be emitted as a script tag without the CSP nonce and be blocked. */}
      <div aria-hidden="true" className="h-[88px]" />
      <section className="careers-admin-section" style={{ paddingTop: "clamp(7rem, 12vw, 9rem)" }}>
        <div className="careers-shell">
          <div className="careers-admin-layout animate-pulse motion-reduce:animate-none" role="status" aria-live="polite">
            <span className="sr-only">Loading the careers admin workspace…</span>

            <div
              className="flex items-center justify-between rounded-[20px] border border-white/70 bg-white/80 px-5 py-3 shadow-sm"
              aria-hidden="true"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-[#c9dfeb]" />
                <div className="space-y-2">
                  <Bar className="h-2.5 w-28" />
                  <Bar className="h-2 w-20" />
                </div>
              </div>
              <Bar className="h-8 w-24 rounded-xl" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="rounded-2xl border border-white/80 bg-white/70 px-4 py-3.5 shadow-sm">
                  <Bar className="mb-2 h-2 w-20" />
                  <Bar className="h-6 w-10 rounded-lg" />
                </div>
              ))}
            </div>

            <div className="flex gap-1 rounded-[16px] border border-white/70 bg-white/60 p-1.5 shadow-sm" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className={`h-10 flex-1 rounded-[11px] ${index === 0 ? "bg-[#9cc3d6]" : "bg-white/70"}`}
                />
              ))}
            </div>

            <div className="careers-admin-card" aria-hidden="true">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <Bar className="h-9 w-full max-w-xs rounded-xl" />
                <Bar className="h-9 w-28 rounded-xl" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="rounded-[20px] border border-[#e3eef5] bg-white/70 p-4">
                    <Bar className="mb-3 h-3 w-1/2 max-w-sm" />
                    <Bar className="h-2.5 w-3/4 max-w-md" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
