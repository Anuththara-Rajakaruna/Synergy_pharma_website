"use client";

import { Fragment, FormEvent, startTransition, useEffect, useRef, useState } from "react";
import { ApplicationRecord, ApplicationStatus, Job, TalentPoolRecord } from "@/types/careers";
import { CAREER_DEPARTMENTS } from "@/components/careers/department-options";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "jobs" | "applicants" | "talent";

type JobEditorState = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: "Full-time" | "Internship";
  status: "draft" | "published" | "closed";
  description: string;
  responsibilities: string;
  requirements: string;
};

const emptyEditor: JobEditorState = {
  id: "",
  title: "",
  department: "",
  location: "",
  type: "Full-time",
  status: "published",
  description: "",
  responsibilities: "",
  requirements: "",
};

// ── ConfirmModal ─────────────────────────────────────────────────────────────

type ConfirmModalProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstBtn = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstBtn?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm action"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-white/70 bg-white p-6 shadow-[0_32px_80px_rgba(7,25,38,0.22)]"
      >
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
          <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-[0.95rem] font-semibold text-[#0a1f35] mb-1">Are you sure?</p>
        <p className="text-[0.85rem] text-[#5f89a4] mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="career-secondary-button flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-red-600 px-5 py-2.5 text-[0.76rem] font-bold uppercase tracking-[0.14em] text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StatusBadge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  reviewing: "bg-amber-50 text-amber-700 border-amber-200",
  shortlisted: "bg-purple-50 text-purple-700 border-purple-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
  hired: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STATUS_DOT: Record<ApplicationStatus, string> = {
  new: "bg-blue-500",
  reviewing: "bg-amber-500",
  shortlisted: "bg-purple-500",
  rejected: "bg-red-500",
  hired: "bg-emerald-500",
};

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] ${STATUS_STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {status}
    </span>
  );
}

// ── JobStatusPill ─────────────────────────────────────────────────────────────

const JOB_STATUS_STYLE: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
};

function JobStatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] ${JOB_STATUS_STYLE[status] ?? JOB_STATUS_STYLE.draft}`}>
      {status}
    </span>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/70 backdrop-blur-sm px-4 py-3.5 shadow-sm">
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[#6b8fa8] mb-1">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type CareersAdminClientProps = {
  initialJobs: Job[];
};

const PAGE_SIZE = 10;

export function CareersAdminClient({ initialJobs }: CareersAdminClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("jobs");
  const [jobs, setJobs] = useState(initialJobs);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [talentPool, setTalentPool] = useState<TalentPoolRecord[]>([]);
  const [editor, setEditor] = useState<JobEditorState>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [applicantSearch, setApplicantSearch] = useState("");
  const [applicantStatusFilter, setApplicantStatusFilter] = useState<ApplicationStatus | "">("");
  const [applicantPage, setApplicantPage] = useState(0);
  const [talentSearch, setTalentSearch] = useState("");
  const [talentPage, setTalentPage] = useState(0);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadApplicants() {
      try {
        const response = await fetch("/api/applicants", { cache: "no-store" });
        if (response.status === 401) {
          // Full reload (not router.push) clears any in-memory applicant/admin
          // state now that the session is invalid.
          window.location.href = "/careers/admin/login";
          return;
        }
        const result = (await response.json()) as { applications: ApplicationRecord[]; talentPool: TalentPoolRecord[] };
        if (!ignore) { setApplications(result.applications); setTalentPool(result.talentPool); }
      } catch { /* network error */ }
    }
    void loadApplicants();
    return () => { ignore = true; };
  }, []);

  function startEditing(job: Job) {
    setEditingId(job.id);
    setEditor({
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      type: job.type,
      status: job.status ?? "published",
      description: job.description,
      responsibilities: job.responsibilities.join("\n"),
      requirements: job.requirements.join("\n"),
    });
    setShowEditor(true);
    setMessage("");
    setError("");
  }

  function resetEditor() {
    setEditingId(null);
    setEditor(emptyEditor);
    setShowEditor(false);
    setMessage("");
    setError("");
  }

  async function refreshJobs() {
    const response = await fetch("/api/jobs?all=1", { cache: "no-store" });
    const result = (await response.json()) as Job[];
    setJobs(result);
  }

  function confirmThen(msg: string, action: () => void) {
    setConfirm({ message: msg, onConfirm: action });
  }

  async function handleDeleteJob(id: string) {
    confirmThen("The job posting will be permanently removed.", async () => {
      setConfirm(null);
      const response = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (!response.ok) { setError("Couldn't delete that job right now."); return; }
      await refreshJobs();
      setMessage("Job deleted.");
      if (editingId === id) resetEditor();
    });
  }

  async function handleDeleteApplication(id: string) {
    confirmThen("The application record and uploaded CV will be permanently deleted.", async () => {
      setConfirm(null);
      const response = await fetch(`/api/applicants/${id}`, { method: "DELETE" });
      if (!response.ok) { setError("Could not delete application."); return; }
      setApplications((prev) => prev.filter((a) => a.id !== id));
    });
  }

  async function handleDeleteTalentPool(id: string) {
    confirmThen("The talent pool record and uploaded CV will be permanently deleted.", async () => {
      setConfirm(null);
      const response = await fetch(`/api/applicants/${id}?type=talent-pool`, { method: "DELETE" });
      if (!response.ok) { setError("Could not delete talent pool record."); return; }
      setTalentPool((prev) => prev.filter((r) => r.id !== id));
    });
  }

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const response = await fetch(`/api/applicants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) { setError("Could not update status."); return; }
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
  }

  async function handleSaveNote(id: string, notes: string) {
    const response = await fetch(`/api/applicants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (!response.ok) { setError("Could not save note."); return; }
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, notes } : a));
    setExpandedNotes(null);
  }

  function exportApplicantsCsv() {
    const cols = ["Name", "Email", "Phone", "Position", "Status", "Submitted", "LinkedIn", "Portfolio"];
    const rows = applications.map((a) => [
      a.name, a.email, a.phone ?? "", a.position, a.status,
      new Date(a.createdAt).toLocaleDateString("en-GB"),
      (a as Record<string, unknown>)["linkedIn"] as string ?? "",
      (a as Record<string, unknown>)["portfolio"] as string ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `applicants-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSignOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    // Full reload (not router.push) clears any in-memory applicant/admin state.
    window.location.href = "/careers/admin/login";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor.id.trim() || !editor.title.trim() || !editor.department.trim() ||
        !editor.location.trim() || !editor.description.trim() ||
        !editor.responsibilities.trim() || !editor.requirements.trim()) {
      setError("Please complete all required fields.");
      setMessage("");
      return;
    }
    setIsSaving(true);
    setError("");
    setMessage("");

    startTransition(async () => {
      try {
        const response = await fetch(editingId ? `/api/jobs/${editingId}` : "/api/jobs", {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editor),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) { setError(result.error ?? "Couldn't save that job right now."); return; }
        await refreshJobs();
        resetEditor();
        setMessage(editingId ? "Job updated successfully." : "Job posted successfully.");
      } catch {
        setError("Couldn't save that job right now.");
      } finally {
        setIsSaving(false);
      }
    });
  }

  // Stats
  const stats = {
    total: applications.length,
    newCount: applications.filter((a) => a.status === "new").length,
    reviewing: applications.filter((a) => a.status === "reviewing").length,
    shortlisted: applications.filter((a) => a.status === "shortlisted").length,
    hired: applications.filter((a) => a.status === "hired").length,
  };

  // Filtered + paginated applicants
  const filteredApplications = applications.filter((a) => {
    const matchSearch = !applicantSearch.trim() ||
      [a.name, a.email, a.position].some((v) => v.toLowerCase().includes(applicantSearch.toLowerCase()));
    const matchStatus = !applicantStatusFilter || a.status === applicantStatusFilter;
    return matchSearch && matchStatus;
  });
  const appPageCount = Math.ceil(filteredApplications.length / PAGE_SIZE);
  const pagedApplications = filteredApplications.slice(applicantPage * PAGE_SIZE, (applicantPage + 1) * PAGE_SIZE);

  const filteredTalentPool = talentPool.filter((r) => {
    if (!talentSearch.trim()) return true;
    const q = talentSearch.toLowerCase();
    return [r.name, r.email, r.areaOfInterest].some((v) => v.toLowerCase().includes(q));
  });
  const talentPageCount = Math.ceil(filteredTalentPool.length / PAGE_SIZE);
  const pagedTalentPool = filteredTalentPool.slice(talentPage * PAGE_SIZE, (talentPage + 1) * PAGE_SIZE);

  const TAB_ITEMS: { id: Tab; label: string; count?: number }[] = [
    { id: "jobs", label: "Job Postings", count: jobs.length },
    { id: "applicants", label: "Applicants", count: applications.length },
    { id: "talent", label: "Talent Pool", count: talentPool.length },
  ];

  return (
    <>
      {confirm ? (
        <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      ) : null}

      <div className="careers-admin-layout">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between rounded-[20px] border border-white/70 bg-white/80 backdrop-blur-sm px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#055f7c]">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <p className="text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#055f7c]">Synergy Pharma</p>
              <p className="text-[0.7rem] text-[#7a9ab0] font-medium">Careers Admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex items-center gap-2 rounded-xl border border-[#d0e4f0] bg-white px-3.5 py-2 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#42677f] shadow-none hover:bg-[#f0f7fb] transition-colors"
            style={{ marginTop: 0, boxShadow: "none" }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            Sign Out
          </button>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Total Applications" value={stats.total} color="text-[#0a1f35]" />
          <StatCard label="New" value={stats.newCount} color="text-blue-600" />
          <StatCard label="Reviewing" value={stats.reviewing} color="text-amber-600" />
          <StatCard label="Shortlisted" value={stats.shortlisted} color="text-purple-600" />
          <StatCard label="Hired" value={stats.hired} color="text-emerald-600" />
        </div>

        {/* ── Tab navigation ── */}
        <div className="flex gap-1 rounded-[16px] border border-white/70 bg-white/60 backdrop-blur-sm p-1.5 shadow-sm">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{ marginTop: 0, boxShadow: "none" }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[0.76rem] font-bold uppercase tracking-[0.1em] transition-all ${
                activeTab === tab.id
                  ? "bg-[#055f7c] text-white shadow-md"
                  : "bg-transparent text-[#42677f] hover:bg-white/80"
              }`}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-black ${activeTab === tab.id ? "bg-white/20 text-white" : "bg-[#e0ecf5] text-[#42677f]"}`}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── Jobs tab ── */}
        {activeTab === "jobs" ? (
          <div className="careers-admin-card">

            {/* Job editor panel */}
            {showEditor ? (
              <div className="mb-6 rounded-[20px] border border-[#d0e8f5] bg-[#f5fafd] p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="eyebrow text-[#1075bd]">{editingId ? "Editing job" : "New job"}</p>
                    <h3 className="text-[1.05rem] font-bold text-[#0a1f35]">
                      {editingId ? editor.title || "Untitled" : "Add a job posting"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={resetEditor}
                    style={{ marginTop: 0, boxShadow: "none", background: "none" }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#6b8fa8] hover:bg-[#e0ecf5] hover:text-[#0a1f35] transition-colors"
                    aria-label="Close editor"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form className="career-form" onSubmit={handleSubmit}>
                  <div className="career-form-grid">
                    <label className="careers-field">
                      <span>Job ID / slug</span>
                      <input
                        type="text"
                        value={editor.id}
                        disabled={Boolean(editingId)}
                        placeholder="e.g. qa-specialist-2026"
                        onChange={(e) => setEditor((c) => ({ ...c, id: e.target.value }))}
                      />
                    </label>
                    <label className="careers-field">
                      <span>Job Title</span>
                      <input
                        type="text"
                        value={editor.title}
                        placeholder="e.g. Quality Assurance Specialist"
                        onChange={(e) => setEditor((c) => ({ ...c, title: e.target.value }))}
                      />
                    </label>
                    <label className="careers-field">
                      <span>Department</span>
                      <select value={editor.department} onChange={(e) => setEditor((c) => ({ ...c, department: e.target.value }))}>
                        <option value="">Select a department</option>
                        {CAREER_DEPARTMENTS.map((dept) => (<option key={dept} value={dept}>{dept}</option>))}
                      </select>
                    </label>
                    <label className="careers-field">
                      <span>Location</span>
                      <input
                        type="text"
                        value={editor.location}
                        placeholder="e.g. Colombo, Sri Lanka"
                        onChange={(e) => setEditor((c) => ({ ...c, location: e.target.value }))}
                      />
                    </label>
                    <label className="careers-field">
                      <span>Type</span>
                      <select value={editor.type} onChange={(e) => setEditor((c) => ({ ...c, type: e.target.value === "Internship" ? "Internship" : "Full-time" }))}>
                        <option value="Full-time">Full-time</option>
                        <option value="Internship">Internship</option>
                      </select>
                    </label>
                    <label className="careers-field">
                      <span>Status</span>
                      <select value={editor.status} onChange={(e) => setEditor((c) => ({ ...c, status: e.target.value as "draft" | "published" | "closed" }))}>
                        <option value="published">Published — visible to candidates</option>
                        <option value="draft">Draft — hidden from candidates</option>
                        <option value="closed">Closed — no longer accepting</option>
                      </select>
                    </label>
                    <label className="careers-field careers-field-full">
                      <span>Description</span>
                      <textarea rows={4} value={editor.description} placeholder="Brief overview of the role..." onChange={(e) => setEditor((c) => ({ ...c, description: e.target.value }))} />
                    </label>
                    <label className="careers-field careers-field-full">
                      <span>Responsibilities (one per line)</span>
                      <textarea rows={5} value={editor.responsibilities} placeholder="Lead QA testing cycles&#10;Review SOPs..." onChange={(e) => setEditor((c) => ({ ...c, responsibilities: e.target.value }))} />
                    </label>
                    <label className="careers-field careers-field-full">
                      <span>Requirements (one per line)</span>
                      <textarea rows={5} value={editor.requirements} placeholder="BSc in Pharmacy or Chemistry&#10;2+ years experience..." onChange={(e) => setEditor((c) => ({ ...c, requirements: e.target.value }))} />
                    </label>
                  </div>
                  {error ? <p className="career-form-message career-form-error">{error}</p> : null}
                  {message ? <p className="career-form-message career-form-success">{message}</p> : null}
                  <div className="career-form-actions">
                    <button type="button" className="career-secondary-button" onClick={resetEditor}>Cancel</button>
                    <button type="submit" disabled={isSaving} style={{ marginTop: 0 }}>
                      {isSaving ? "Saving…" : editingId ? "Save Changes" : "Publish Job"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="eyebrow">Job Postings</p>
                  <h2 style={{ fontSize: "1.2rem", marginBottom: 0 }}>{jobs.length} role{jobs.length !== 1 ? "s" : ""} total</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditor(true)}
                  style={{ marginTop: 0 }}
                  className="flex items-center gap-2"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add Job
                </button>
              </div>
            )}

            {/* Jobs list */}
            <div className="careers-admin-jobs">
              {jobs.length === 0 ? (
                <div className="rounded-[16px] border-2 border-dashed border-[#d0e4f0] py-12 text-center">
                  <p className="text-[0.9rem] text-[#7a9ab0]">No job postings yet. Add your first role above.</p>
                </div>
              ) : null}
              {jobs.map((job) => (
                <article key={job.id} className="careers-admin-job-row group">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#eaf3fa] text-[#1075bd]">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[0.95rem] font-bold text-[#0a1f35]">{job.title}</h3>
                        <JobStatusPill status={job.status ?? "published"} />
                      </div>
                      <p className="text-[0.82rem] text-[#5f89a4] mt-0.5">
                        {job.department} · {job.location} · {job.type}
                      </p>
                    </div>
                  </div>
                  <div className="careers-admin-job-actions flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditing(job)}
                      className="career-secondary-button flex items-center gap-1.5"
                      style={{ marginTop: 0, fontSize: "0.72rem" }}
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                      </svg>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteJob(job.id)}
                      style={{ marginTop: 0, fontSize: "0.72rem", background: "#fef2f2", color: "#dc2626", boxShadow: "none" }}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 hover:bg-red-100 transition-colors"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Applicants tab ── */}
        {activeTab === "applicants" ? (
          <div className="careers-admin-card" style={{ padding: "1.5rem" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <p className="eyebrow">Applications</p>
                <h2 style={{ fontSize: "1.2rem", marginBottom: 0 }}>
                  {filteredApplications.length} result{filteredApplications.length !== 1 ? "s" : ""}
                  {filteredApplications.length !== applications.length ? ` of ${applications.length}` : ""}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="search"
                  placeholder="Search name, email, position…"
                  value={applicantSearch}
                  onChange={(e) => { setApplicantSearch(e.target.value); setApplicantPage(0); }}
                  className="rounded-xl border border-[#d0e4f0] bg-white px-3.5 py-2 text-[0.85rem] outline-none focus:border-[#2f85ba] focus:ring-2 focus:ring-[#2f85ba]/15 min-w-50"
                  style={{ fontFamily: "inherit" }}
                />
                <select
                  value={applicantStatusFilter}
                  onChange={(e) => { setApplicantStatusFilter(e.target.value as ApplicationStatus | ""); setApplicantPage(0); }}
                  className="rounded-xl border border-[#d0e4f0] bg-white px-3.5 py-2 text-[0.85rem] outline-none focus:border-[#2f85ba]"
                  style={{ fontFamily: "inherit" }}
                >
                  <option value="">All statuses</option>
                  <option value="new">New</option>
                  <option value="reviewing">Reviewing</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="rejected">Rejected</option>
                  <option value="hired">Hired</option>
                </select>
                <button
                  type="button"
                  onClick={exportApplicantsCsv}
                  disabled={applications.length === 0}
                  className="career-secondary-button flex items-center gap-1.5"
                  style={{ marginTop: 0, fontSize: "0.76rem" }}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>

            {pagedApplications.length === 0 ? (
              <div className="rounded-[16px] border-2 border-dashed border-[#d0e4f0] py-14 text-center">
                <svg className="mx-auto mb-3 h-8 w-8 text-[#b0cfe0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                </svg>
                <p className="text-[0.9rem] text-[#7a9ab0]">
                  {applicantSearch || applicantStatusFilter ? "No applications match your filters." : "No applications yet."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#e0ecf5]">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                  <thead>
                    <tr style={{ background: "#f5fafd", borderBottom: "2px solid #e0ecf5" }}>
                      {["Name", "Position", "Email", "Phone", "Submitted", "Status", "CV", ""].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "0.65rem 0.9rem",
                            textAlign: "left",
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            color: "#6b8fa8",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedApplications.map((app, i) => (
                      <Fragment key={app.id}>
                        <tr
                          style={{
                            borderBottom: expandedNotes === app.id ? "none" : (i < pagedApplications.length - 1 ? "1px solid #edf4f9" : "none"),
                            background: i % 2 === 0 ? "#fff" : "#fafcfe",
                          }}
                        >
                          <td style={{ padding: "0.75rem 0.9rem", fontWeight: 700, color: "#0a1f35", whiteSpace: "nowrap" }}>
                            <div className="flex items-center gap-2">
                              {app.name}
                              <StatusBadge status={app.status} />
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem", color: "#3d6478", maxWidth: "180px" }}>
                            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {app.position}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem", color: "#5f89a4", whiteSpace: "nowrap" }}>
                            {app.email}
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem", color: "#7a9ab0", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                            {app.phone ?? "—"}
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem", color: "#8aacbf", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                            {new Date(app.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem" }}>
                            <select
                              value={app.status}
                              onChange={(e) => void handleStatusChange(app.id, e.target.value as ApplicationStatus)}
                              aria-label={`Update status for ${app.name}`}
                              style={{
                                fontFamily: "inherit",
                                fontSize: "0.78rem",
                                fontWeight: 600,
                                border: "1px solid #d0e4f0",
                                borderRadius: "0.5rem",
                                padding: "0.3rem 0.5rem",
                                background: "#fff",
                                color: "#2c4a5e",
                                outline: "none",
                                cursor: "pointer",
                              }}
                            >
                              <option value="new">New</option>
                              <option value="reviewing">Reviewing</option>
                              <option value="shortlisted">Shortlisted</option>
                              <option value="rejected">Rejected</option>
                              <option value="hired">Hired</option>
                            </select>
                          </td>
                          <td style={{ padding: "0.75rem 0.9rem" }}>
                            <a
                              href={app.cvFilePath}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                color: "#1075bd",
                                border: "1px solid #c6dce9",
                                borderRadius: "0.5rem",
                                padding: "0.3rem 0.65rem",
                                background: "#fff",
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <svg style={{ width: "0.75rem", height: "0.75rem", flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                              </svg>
                              CV
                            </a>
                          </td>
                          <td style={{ padding: "0.75rem 0.6rem", textAlign: "center", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              title={expandedNotes === app.id ? "Close notes" : "Add/edit note"}
                              onClick={() => {
                                if (expandedNotes === app.id) { setExpandedNotes(null); }
                                else { setExpandedNotes(app.id); setNoteDraft(app.notes ?? ""); }
                              }}
                              style={{ marginTop: 0, background: "none", boxShadow: "none", padding: "0.3rem", color: app.notes ? "#1075bd" : "#c0c8d0", cursor: "pointer", border: "none", borderRadius: "0.4rem", display: "inline-flex" }}
                            >
                              <svg style={{ width: "1rem", height: "1rem" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteApplication(app.id)}
                              aria-label={`Delete application from ${app.name}`}
                              style={{ marginTop: 0, background: "none", boxShadow: "none", padding: "0.3rem", color: "#c0c8d0", cursor: "pointer", border: "none", borderRadius: "0.4rem", display: "inline-flex" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#dc2626"; (e.currentTarget as HTMLButtonElement).style.background = "#fff0f0"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#c0c8d0"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                            >
                              <svg style={{ width: "1rem", height: "1rem" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                        {expandedNotes === app.id ? (
                          <tr style={{ background: i % 2 === 0 ? "#f7fbfd" : "#f2f8fc", borderBottom: i < pagedApplications.length - 1 ? "1px solid #edf4f9" : "none" }}>
                            <td colSpan={8} style={{ padding: "0.5rem 1.25rem 0.75rem" }}>
                              <p style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b8fa8", marginBottom: "0.35rem" }}>
                                Notes for {app.name}
                              </p>
                              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                                <textarea
                                  rows={3}
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  placeholder="Add internal notes about this applicant…"
                                  style={{
                                    flex: 1,
                                    fontFamily: "inherit",
                                    fontSize: "0.84rem",
                                    border: "1px solid #d0e4f0",
                                    borderRadius: "0.75rem",
                                    padding: "0.6rem 0.8rem",
                                    resize: "vertical",
                                    outline: "none",
                                    background: "#fff",
                                    color: "#0a1f35",
                                  }}
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveNote(app.id, noteDraft)}
                                    style={{
                                      marginTop: 0,
                                      padding: "0.45rem 0.9rem",
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.1em",
                                      background: "#055f7c",
                                      color: "#fff",
                                      border: "none",
                                      borderRadius: "0.6rem",
                                      cursor: "pointer",
                                      boxShadow: "0 4px 12px rgba(5,95,124,0.2)",
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedNotes(null)}
                                    className="career-secondary-button"
                                    style={{ marginTop: 0, padding: "0.45rem 0.9rem", fontSize: "0.72rem" }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {appPageCount > 1 ? (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#e0ecf5]">
                <button type="button" className="career-secondary-button" style={{ marginTop: 0 }} disabled={applicantPage === 0} onClick={() => setApplicantPage((p) => p - 1)}>← Previous</button>
                <span className="text-[0.82rem] text-[#5f89a4] font-semibold">Page {applicantPage + 1} of {appPageCount}</span>
                <button type="button" className="career-secondary-button" style={{ marginTop: 0 }} disabled={applicantPage >= appPageCount - 1} onClick={() => setApplicantPage((p) => p + 1)}>Next →</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Talent Pool tab ── */}
        {activeTab === "talent" ? (
          <div className="careers-admin-card" style={{ padding: "1.5rem" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <p className="eyebrow">Talent Pool</p>
                <h2 style={{ fontSize: "1.2rem", marginBottom: 0 }}>
                  {filteredTalentPool.length} entr{filteredTalentPool.length !== 1 ? "ies" : "y"}
                  {filteredTalentPool.length !== talentPool.length ? ` of ${talentPool.length}` : ""}
                </h2>
              </div>
              <input
                type="search"
                placeholder="Search name, email, area…"
                value={talentSearch}
                onChange={(e) => { setTalentSearch(e.target.value); setTalentPage(0); }}
                className="rounded-xl border border-[#d0e4f0] bg-white px-3.5 py-2 text-[0.85rem] outline-none focus:border-[#2f85ba] focus:ring-2 focus:ring-[#2f85ba]/15 min-w-50"
                style={{ fontFamily: "inherit" }}
              />
            </div>

            {pagedTalentPool.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-[#d0e4f0] py-14 text-center">
                <svg className="mx-auto mb-3 h-8 w-8 text-[#b0cfe0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
                <p className="text-[0.9rem] text-[#7a9ab0]">
                  {talentSearch.trim() ? "No matches found for your search." : "No talent pool submissions yet."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#e0ecf5]">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                  <thead>
                    <tr style={{ background: "#f5fafd", borderBottom: "2px solid #e0ecf5" }}>
                      {["Name", "Area of Interest", "Email", "Notes", "Submitted", "CV", ""].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "0.65rem 0.9rem",
                            textAlign: "left",
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            color: "#6b8fa8",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTalentPool.map((entry, i) => (
                      <tr
                        key={entry.id}
                        style={{
                          borderBottom: i < pagedTalentPool.length - 1 ? "1px solid #edf4f9" : "none",
                          background: i % 2 === 0 ? "#fff" : "#fafcfe",
                        }}
                      >
                        <td style={{ padding: "0.75rem 0.9rem", fontWeight: 700, color: "#0a1f35", whiteSpace: "nowrap" }}>
                          {entry.name}
                        </td>
                        <td style={{ padding: "0.75rem 0.9rem" }}>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "9999px",
                            border: "1px solid #c8e0f0",
                            background: "#edf6fb",
                            padding: "0.2rem 0.65rem",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            color: "#1075bd",
                            whiteSpace: "nowrap",
                          }}>
                            {entry.areaOfInterest}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 0.9rem", color: "#5f89a4", whiteSpace: "nowrap" }}>
                          {entry.email}
                        </td>
                        <td style={{ padding: "0.75rem 0.9rem", color: "#7a9ab0", maxWidth: "220px" }}>
                          {entry.notes ? (
                            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                              {entry.notes}
                            </span>
                          ) : (
                            <span style={{ color: "#c0d4e0", fontSize: "0.78rem" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 0.9rem", color: "#8aacbf", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                          {new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td style={{ padding: "0.75rem 0.9rem" }}>
                          <a
                            href={entry.cvFilePath}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.3rem",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              color: "#1075bd",
                              border: "1px solid #c6dce9",
                              borderRadius: "0.5rem",
                              padding: "0.3rem 0.65rem",
                              background: "#fff",
                              textDecoration: "none",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <svg style={{ width: "0.75rem", height: "0.75rem", flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            View CV
                          </a>
                        </td>
                        <td style={{ padding: "0.75rem 0.6rem", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTalentPool(entry.id)}
                            aria-label={`Delete talent pool entry from ${entry.name}`}
                            style={{ marginTop: 0, background: "none", boxShadow: "none", padding: "0.3rem", color: "#c0c8d0", cursor: "pointer", border: "none", borderRadius: "0.4rem", display: "inline-flex" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#dc2626"; (e.currentTarget as HTMLButtonElement).style.background = "#fff0f0"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#c0c8d0"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                          >
                            <svg style={{ width: "1rem", height: "1rem" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {talentPageCount > 1 ? (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#e0ecf5]">
                <button type="button" className="career-secondary-button" style={{ marginTop: 0 }} disabled={talentPage === 0} onClick={() => setTalentPage((p) => p - 1)}>← Previous</button>
                <span className="text-[0.82rem] text-[#5f89a4] font-semibold">Page {talentPage + 1} of {talentPageCount}</span>
                <button type="button" className="career-secondary-button" style={{ marginTop: 0 }} disabled={talentPage >= talentPageCount - 1} onClick={() => setTalentPage((p) => p + 1)}>Next →</button>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>
    </>
  );
}
