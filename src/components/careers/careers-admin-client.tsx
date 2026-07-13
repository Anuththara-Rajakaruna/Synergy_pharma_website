"use client";

import { FormEvent, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApplicationRecord, ApplicantStatus, EmailTemplate, Job, TalentPoolRecord } from "@/types/careers";
import { CAREER_DEPARTMENTS } from "@/components/careers/department-options";

// ─── Pipeline definition ─────────────────────────────────────────────────────

type PipelineStage = {
  value: ApplicantStatus;
  label: string;
  color: string;  // CSS class suffix
};

const PIPELINE: PipelineStage[] = [
  { value: "applied",      label: "Applied",        color: "grey"  },
  { value: "phone_screen", label: "Phone Screen",   color: "blue"  },
  { value: "interview",    label: "Interview",      color: "indigo"},
  { value: "offer",        label: "Offer Extended", color: "amber" },
  { value: "hired",        label: "Hired",          color: "green" },
  { value: "rejected",     label: "Rejected",       color: "red"   },
];

// Map legacy statuses to display labels
const LEGACY_LABELS: Partial<Record<string, string>> = {
  pending:    "Applied",
  reviewed:   "Phone Screen",
  shortlisted:"Interview",
};

function statusLabel(s: string | undefined) {
  if (!s) return "Applied";
  return LEGACY_LABELS[s] ?? PIPELINE.find((p) => p.value === s)?.label ?? s;
}

function statusColor(s: string | undefined) {
  if (!s || s === "pending") return "grey";
  if (s === "reviewed")      return "blue";
  if (s === "shortlisted")   return "indigo";
  return PIPELINE.find((p) => p.value === s)?.color ?? "grey";
}

// ─── Types ───────────────────────────────────────────────────────────────────

type JobEditorState = {
  id: string; title: string; department: string; location: string;
  type: "Full-time" | "Internship"; description: string;
  responsibilities: string; requirements: string; preferredRequirements: string;
  salary: string; closingDate: string;
};

const emptyEditor: JobEditorState = {
  id: "", title: "", department: "", location: "",
  type: "Full-time", description: "", responsibilities: "", requirements: "",
  preferredRequirements: "", salary: "", closingDate: "",
};

type CareersAdminClientProps = { initialJobs: Job[] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

function truncate(text: string | undefined, max = 60) {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CareersAdminClient({ initialJobs }: CareersAdminClientProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [talentPool, setTalentPool] = useState<TalentPoolRecord[]>([]);
  const [jobViews, setJobViews] = useState<Record<string, number>>({});
  const [editor, setEditor] = useState<JobEditorState>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [activeTab, setActiveTab] = useState<"applications" | "talent" | "templates">("applications");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Search / filter
  const [applicantSearch, setApplicantSearch] = useState("");
  const [applicantStatusFilter, setApplicantStatusFilter] = useState<ApplicantStatus | "all">("all");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ApplicantStatus | "">("");
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  // Notes editing
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  // Interview link editing
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState("");

  // Email templates
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      const [appRes, tplRes] = await Promise.all([
        fetch("/api/applicants", { cache: "no-store" }),
        fetch("/api/admin/templates", { cache: "no-store" }),
      ]);
      const appData = (await appRes.json()) as {
        applications: ApplicationRecord[];
        talentPool: TalentPoolRecord[];
        jobViews: Record<string, number>;
      };
      const tplData = (await tplRes.json()) as EmailTemplate[];

      if (!ignore) {
        setApplications(appData.applications ?? []);
        setTalentPool(appData.talentPool ?? []);
        setJobViews(appData.jobViews ?? {});
        setTemplates(Array.isArray(tplData) ? tplData : []);
      }
    }
    void load();
    return () => { ignore = true; };
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const appsThisWeek = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return applications.filter((a) => new Date(a.createdAt) >= sevenDaysAgo).length;
  }, [applications]);

  const totalViews = useMemo(() => Object.values(jobViews).reduce((a, b) => a + b, 0), [jobViews]);

  const conversionRate = useMemo(() => {
    if (totalViews === 0) return 0;
    return Math.round((applications.length / totalViews) * 100);
  }, [applications.length, totalViews]);

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredApplications = useMemo(() => {
    const q = applicantSearch.toLowerCase();
    return applications.filter((a) => {
      const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || a.position.toLowerCase().includes(q);
      const matchesStatus = applicantStatusFilter === "all" || (a.status ?? "applied") === applicantStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [applications, applicantSearch, applicantStatusFilter]);

  const filteredTalentPool = useMemo(() => {
    const q = applicantSearch.toLowerCase();
    return talentPool.filter((t) => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q) || t.areaOfInterest.toLowerCase().includes(q);
      const matchesStatus = applicantStatusFilter === "all" || (t.status ?? "applied") === applicantStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [talentPool, applicantSearch, applicantStatusFilter]);

  // ── Job editor ─────────────────────────────────────────────────────────────
  function handleTitleChange(value: string) {
    setEditor((c) => ({ ...c, title: value, ...(slugManuallyEdited ? {} : { id: toSlug(value) }) }));
  }
  function handleSlugChange(value: string) {
    setSlugManuallyEdited(true);
    setEditor((c) => ({ ...c, id: value }));
  }
  function startEditing(job: Job) {
    setEditingId(job.id); setSlugManuallyEdited(true);
    setEditor({
      id: job.id, title: job.title, department: job.department, location: job.location,
      type: job.type, description: job.description,
      responsibilities: job.responsibilities.join("\n"),
      requirements: job.requirements.join("\n"),
      preferredRequirements: (job.preferredRequirements ?? []).join("\n"),
      salary: job.salary ?? "", closingDate: job.closingDate ?? "",
    });
    setMessage(""); setError("");
  }
  function resetEditor() {
    setEditingId(null); setSlugManuallyEdited(false); setEditor(emptyEditor);
  }
  async function refreshJobs() {
    const res = await fetch("/api/jobs?all=true", { cache: "no-store" });
    setJobs((await res.json()) as Job[]);
  }
  async function handleDelete(id: string) {
    if (!window.confirm("Delete this job posting?")) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) { setError("We couldn't delete that job."); return; }
    await refreshJobs();
    setMessage("Job deleted.");
    if (editingId === id) resetEditor();
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor.id.trim() || !editor.title.trim() || !editor.department.trim() ||
        !editor.location.trim() || !editor.description.trim() ||
        !editor.responsibilities.trim() || !editor.requirements.trim()) {
      setError("Please complete all required job fields."); setMessage(""); return;
    }
    setIsSaving(true); setError(""); setMessage("");
    startTransition(async () => {
      try {
        const res = await fetch(editingId ? `/api/jobs/${editingId}` : "/api/jobs", {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editor),
        });
        const result = (await res.json()) as { error?: string };
        if (!res.ok) { setError(result.error ?? "Could not save job."); return; }
        await refreshJobs(); resetEditor();
        setMessage(editingId ? "Job updated." : "Job added.");
      } catch { setError("Could not save job."); }
      finally { setIsSaving(false); }
    });
  }

  // ── Status change ──────────────────────────────────────────────────────────
  async function handleStatusChange(id: string, type: "application" | "talent", status: ApplicantStatus) {
    const res = await fetch("/api/applicants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type, status }),
    });
    if (!res.ok) return;
    if (type === "application") setApplications((p) => p.map((a) => a.id === id ? { ...a, status } : a));
    else setTalentPool((p) => p.map((t) => t.id === id ? { ...t, status } : t));
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function selectAll() {
    const list = activeTab === "applications" ? filteredApplications : filteredTalentPool;
    setSelectedIds(new Set(list.map((r) => r.id)));
  }
  function clearSelection() { setSelectedIds(new Set()); setBulkStatus(""); }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0) return;
    setIsBulkSaving(true);
    const type = activeTab === "talent" ? "talent" : "application";
    const res = await fetch("/api/applicants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], type, action: "bulk_status", status: bulkStatus }),
    });
    if (res.ok) {
      const ids = selectedIds;
      if (type === "application") setApplications((p) => p.map((a) => ids.has(a.id) ? { ...a, status: bulkStatus } : a));
      else setTalentPool((p) => p.map((t) => ids.has(t.id) ? { ...t, status: bulkStatus } : t));
      clearSelection();
    }
    setIsBulkSaving(false);
  }

  // ── Notes ──────────────────────────────────────────────────────────────────
  function openNotes(id: string, type: "application" | "talent") {
    const existing = type === "application"
      ? applications.find((a) => a.id === id)?.notes ?? ""
      : talentPool.find((t) => t.id === id)?.adminNotes ?? "";
    setEditingNotesId(`${type}:${id}`); setNotesValue(existing);
    setTimeout(() => notesRef.current?.focus(), 50);
  }
  async function saveNotes(id: string, type: "application" | "talent") {
    const res = await fetch("/api/applicants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type, action: "notes", notes: notesValue }),
    });
    if (!res.ok) return;
    if (type === "application") setApplications((p) => p.map((a) => a.id === id ? { ...a, notes: notesValue } : a));
    else setTalentPool((p) => p.map((t) => t.id === id ? { ...t, adminNotes: notesValue } : t));
    setEditingNotesId(null);
  }

  // ── Interview link ─────────────────────────────────────────────────────────
  function openLink(id: string) {
    const existing = applications.find((a) => a.id === id)?.interviewLink ?? "";
    setEditingLinkId(id); setLinkValue(existing);
  }
  async function saveLink(id: string) {
    const res = await fetch("/api/applicants", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type: "application", action: "interview_link", interviewLink: linkValue }),
    });
    if (!res.ok) return;
    setApplications((p) => p.map((a) => a.id === id ? { ...a, interviewLink: linkValue } : a));
    setEditingLinkId(null);
  }

  // ── Email templates ────────────────────────────────────────────────────────
  async function saveTemplate() {
    if (!editingTemplate) return;
    setIsSavingTemplate(true);
    const res = await fetch("/api/admin/templates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingTemplate),
    });
    if (res.ok) {
      const updated = (await res.json()) as EmailTemplate;
      setTemplates((p) => p.map((t) => t.name === updated.name ? updated : t));
      setEditingTemplate(null);
    }
    setIsSavingTemplate(false);
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/careers/admin/login"); router.refresh();
  }

  function downloadCsv(type: "applications" | "talent") {
    window.open(`/api/admin/export?type=${type === "talent" ? "talent" : "applications"}`, "_blank");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="careers-admin-layout">
      {/* Topbar */}
      <div className="careers-admin-topbar">
        <p className="careers-admin-topbar-label">Signed in as admin</p>
        <button type="button" className="career-secondary-button careers-admin-logout-btn" onClick={() => void handleLogout()}>
          Sign Out
        </button>
      </div>

      {/* Stats row */}
      <div className="careers-admin-stats-row">
        <div className="careers-admin-stat-card">
          <strong>{jobs.length}</strong><span>Active Jobs</span>
        </div>
        <div className="careers-admin-stat-card">
          <strong>{applications.length}</strong><span>Applications</span>
        </div>
        <div className="careers-admin-stat-card">
          <strong>{talentPool.length}</strong><span>Talent Pool</span>
        </div>
        <div className="careers-admin-stat-card">
          <strong>{appsThisWeek}</strong><span>This Week</span>
        </div>
        <div className="careers-admin-stat-card">
          <strong>{totalViews}</strong><span>Job Views</span>
        </div>
        <div className="careers-admin-stat-card">
          <strong>{conversionRate}%</strong><span>Apply Rate</span>
        </div>
      </div>

      {/* Job editor */}
      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Admin Tools</p>
          <h2>{editingId ? "Edit job posting" : "Add a new job posting"}</h2>
        </div>
        <form className="career-form" onSubmit={handleSubmit}>
          <div className="career-form-grid">
            <label className="careers-field">
              <span>Job ID / slug</span>
              <input type="text" value={editor.id} disabled={Boolean(editingId)}
                onChange={(e) => handleSlugChange(e.target.value)} />
              {!slugManuallyEdited && !editingId && (
                <p className="careers-field-hint">Auto-generated from title — edit to override</p>
              )}
            </label>
            <label className="careers-field">
              <span>Title</span>
              <input type="text" value={editor.title} onChange={(e) => handleTitleChange(e.target.value)} />
            </label>
            <label className="careers-field">
              <span>Department</span>
              <select value={editor.department} onChange={(e) => setEditor((c) => ({ ...c, department: e.target.value }))}>
                <option value="">Select a department</option>
                {CAREER_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="careers-field">
              <span>Location</span>
              <input type="text" value={editor.location} onChange={(e) => setEditor((c) => ({ ...c, location: e.target.value }))} />
            </label>
            <label className="careers-field">
              <span>Type</span>
              <select value={editor.type} onChange={(e) => setEditor((c) => ({ ...c, type: e.target.value === "Internship" ? "Internship" : "Full-time" }))}>
                <option value="Full-time">Full-time</option>
                <option value="Internship">Internship</option>
              </select>
            </label>
            <label className="careers-field">
              <span>Salary range (optional)</span>
              <input type="text" placeholder="e.g. LKR 80,000 – 120,000 / month"
                value={editor.salary} onChange={(e) => setEditor((c) => ({ ...c, salary: e.target.value }))} />
            </label>
            <label className="careers-field">
              <span>Closing date (optional)</span>
              <input type="date" value={editor.closingDate} onChange={(e) => setEditor((c) => ({ ...c, closingDate: e.target.value }))} />
            </label>
            <label className="careers-field careers-field-full">
              <span>Description</span>
              <textarea rows={5} value={editor.description} onChange={(e) => setEditor((c) => ({ ...c, description: e.target.value }))} />
            </label>
            <label className="careers-field careers-field-full">
              <span>Responsibilities (one per line)</span>
              <textarea rows={6} value={editor.responsibilities} onChange={(e) => setEditor((c) => ({ ...c, responsibilities: e.target.value }))} />
            </label>
            <label className="careers-field careers-field-full">
              <span>Requirements — Essential (one per line)</span>
              <textarea rows={6} value={editor.requirements} onChange={(e) => setEditor((c) => ({ ...c, requirements: e.target.value }))} />
            </label>
            <label className="careers-field careers-field-full">
              <span>Requirements — Preferred / Nice to have (one per line, optional)</span>
              <textarea rows={4} value={editor.preferredRequirements} onChange={(e) => setEditor((c) => ({ ...c, preferredRequirements: e.target.value }))} />
            </label>
          </div>
          {error ? <p className="career-form-message career-form-error">{error}</p> : null}
          {message ? <p className="career-form-message career-form-success">{message}</p> : null}
          <div className="career-form-actions">
            <button type="button" className="career-secondary-button" onClick={resetEditor}>Clear</button>
            <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Job"}</button>
          </div>
        </form>
      </section>

      {/* Open roles with analytics */}
      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Open Roles</p>
          <h2>Manage job postings</h2>
        </div>
        <div className="careers-admin-jobs">
          {jobs.map((job) => {
            const isExpired = job.closingDate ? new Date(job.closingDate) < new Date() : false;
            const views = jobViews[job.id] ?? 0;
            const applies = applications.filter((a) => a.jobId === job.id).length;
            const rate = views > 0 ? Math.round((applies / views) * 100) : 0;
            return (
              <article key={job.id} className={`careers-admin-job-row${isExpired ? " careers-admin-job-expired" : ""}`}>
                <div>
                  <h3>
                    {job.title}
                    {isExpired && <span className="careers-expired-badge">Expired</span>}
                  </h3>
                  <p>{job.department} · {job.location} · {job.type}{job.salary ? ` · ${job.salary}` : ""}</p>
                  <p className="careers-admin-job-analytics">
                    <span title="Page views">{views} views</span>
                    <span>·</span>
                    <span title="Applications">{applies} applied</span>
                    <span>·</span>
                    <span title="Apply conversion rate">{rate}% conversion</span>
                  </p>
                </div>
                <div className="careers-admin-job-actions">
                  <button type="button" className="career-secondary-button" onClick={() => startEditing(job)}>Edit</button>
                  <button type="button" onClick={() => void handleDelete(job.id)}>Delete</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Applicants */}
      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Applicants</p>
          <h2>View submissions</h2>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="careers-admin-bulk-bar">
            <span className="careers-admin-bulk-count">{selectedIds.size} selected</span>
            <select className="careers-admin-filter-select" value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as ApplicantStatus | "")}>
              <option value="">Change status to…</option>
              {PIPELINE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button type="button" disabled={!bulkStatus || isBulkSaving}
              onClick={() => void applyBulkStatus()}>
              {isBulkSaving ? "Applying…" : "Apply"}
            </button>
            <button type="button" className="career-secondary-button" onClick={clearSelection}>Clear</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="careers-admin-applicant-toolbar">
          <input type="search" className="careers-admin-search"
            placeholder="Search by name, email or position…"
            value={applicantSearch} onChange={(e) => setApplicantSearch(e.target.value)}
            aria-label="Search applicants" />
          <select className="careers-admin-filter-select" value={applicantStatusFilter}
            onChange={(e) => setApplicantStatusFilter(e.target.value as ApplicantStatus | "all")}
            aria-label="Filter by status">
            <option value="all">All statuses</option>
            {PIPELINE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button type="button" className="career-secondary-button careers-admin-export-btn"
            onClick={() => downloadCsv(activeTab === "talent" ? "talent" : "applications")}>
            ↓ Export CSV
          </button>
        </div>

        {/* Tabs */}
        <div className="careers-admin-tabs-bar">
          <button type="button" className="careers-admin-tab-btn" aria-selected={activeTab === "applications"}
            onClick={() => { setActiveTab("applications"); clearSelection(); }}>
            Role applications<span className="careers-admin-tab-count">{applications.length}</span>
          </button>
          <button type="button" className="careers-admin-tab-btn" aria-selected={activeTab === "talent"}
            onClick={() => { setActiveTab("talent"); clearSelection(); }}>
            Talent pool<span className="careers-admin-tab-count">{talentPool.length}</span>
          </button>
          <button type="button" className="careers-admin-tab-btn" aria-selected={activeTab === "templates"}
            onClick={() => { setActiveTab("templates"); clearSelection(); }}>
            Email Templates
          </button>
        </div>

        <div className="careers-admin-tab-panel">

          {/* ── Applications table ── */}
          {activeTab === "applications" && (
            <div className="careers-admin-table-wrap">
              {filteredApplications.length === 0 ? (
                <p>{applications.length === 0 ? "No applications yet." : "No results for current filters."}</p>
              ) : (
                <table className="careers-admin-table">
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox"
                          checked={selectedIds.size === filteredApplications.length && filteredApplications.length > 0}
                          onChange={(e) => e.target.checked ? selectAll() : clearSelection()} />
                      </th>
                      <th>Name</th><th>Position</th><th>Source</th><th>Email</th><th>Phone</th>
                      <th>Date</th><th>Cover Letter</th><th>Interview</th><th>Notes</th><th>CV</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApplications.map((a) => {
                      const status = a.status ?? "applied";
                      const noteKey = `application:${a.id}`;
                      return (
                        <tr key={a.id} className={selectedIds.has(a.id) ? "careers-table-row-selected" : ""}>
                          <td>
                            <input type="checkbox" checked={selectedIds.has(a.id)}
                              onChange={() => toggleSelect(a.id)} />
                          </td>
                          <td><strong>{a.name}</strong></td>
                          <td>{a.position}</td>
                          <td>
                            {a.source && <span className="careers-source-badge">{a.source}</span>}
                          </td>
                          <td>{a.email}</td>
                          <td>{a.phone}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDate(a.createdAt)}</td>
                          <td>{truncate(a.coverLetter)}</td>
                          <td>
                            {editingLinkId === a.id ? (
                              <div className="careers-notes-editor">
                                <input type="url" value={linkValue} placeholder="Paste Calendly / Meet link"
                                  onChange={(e) => setLinkValue(e.target.value)}
                                  className="careers-notes-textarea" style={{ rows: 1 } as React.CSSProperties} />
                                <div className="careers-notes-actions">
                                  <button type="button" onClick={() => void saveLink(a.id)}>Send</button>
                                  <button type="button" className="career-secondary-button" onClick={() => setEditingLinkId(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="careers-notes-trigger"
                                onClick={() => openLink(a.id)}
                                title={a.interviewLink ?? "Set interview link"}>
                                {a.interviewLink
                                  ? <span style={{ color: "var(--primary)" }}>✓ Sent</span>
                                  : <span className="careers-notes-empty">+ Schedule</span>}
                              </button>
                            )}
                          </td>
                          <td>
                            {editingNotesId === noteKey ? (
                              <div className="careers-notes-editor">
                                <textarea ref={notesRef} rows={3} value={notesValue}
                                  onChange={(e) => setNotesValue(e.target.value)}
                                  className="careers-notes-textarea" />
                                <div className="careers-notes-actions">
                                  <button type="button" onClick={() => void saveNotes(a.id, "application")}>Save</button>
                                  <button type="button" className="career-secondary-button" onClick={() => setEditingNotesId(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="careers-notes-trigger" onClick={() => openNotes(a.id, "application")}>
                                {a.notes ? truncate(a.notes, 40) : <span className="careers-notes-empty">+ Add note</span>}
                              </button>
                            )}
                          </td>
                          <td>
                            <a href={a.cvFilePath} target="_blank" rel="noreferrer" className="careers-admin-link">View CV</a>
                          </td>
                          <td>
                            <select className={`careers-status-select careers-status--${statusColor(status)}`}
                              value={status}
                              onChange={(e) => void handleStatusChange(a.id, "application", e.target.value as ApplicantStatus)}>
                              {PIPELINE.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Talent pool table ── */}
          {activeTab === "talent" && (
            <div className="careers-admin-table-wrap">
              {filteredTalentPool.length === 0 ? (
                <p>{talentPool.length === 0 ? "No talent pool submissions yet." : "No results for current filters."}</p>
              ) : (
                <table className="careers-admin-table">
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox"
                          checked={selectedIds.size === filteredTalentPool.length && filteredTalentPool.length > 0}
                          onChange={(e) => e.target.checked ? selectAll() : clearSelection()} />
                      </th>
                      <th>Name</th><th>Area of Interest</th><th>Email</th><th>Phone</th>
                      <th>Date</th><th>Notes</th><th>Admin Notes</th><th>CV</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTalentPool.map((t) => {
                      const status = t.status ?? "applied";
                      const noteKey = `talent:${t.id}`;
                      return (
                        <tr key={t.id} className={selectedIds.has(t.id) ? "careers-table-row-selected" : ""}>
                          <td>
                            <input type="checkbox" checked={selectedIds.has(t.id)}
                              onChange={() => toggleSelect(t.id)} />
                          </td>
                          <td><strong>{t.name}</strong></td>
                          <td>{t.areaOfInterest}</td>
                          <td>{t.email}</td>
                          <td>{t.phone}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDate(t.createdAt)}</td>
                          <td>{truncate(t.notes)}</td>
                          <td>
                            {editingNotesId === noteKey ? (
                              <div className="careers-notes-editor">
                                <textarea rows={3} value={notesValue}
                                  onChange={(e) => setNotesValue(e.target.value)}
                                  className="careers-notes-textarea" />
                                <div className="careers-notes-actions">
                                  <button type="button" onClick={() => void saveNotes(t.id, "talent")}>Save</button>
                                  <button type="button" className="career-secondary-button" onClick={() => setEditingNotesId(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="careers-notes-trigger" onClick={() => openNotes(t.id, "talent")}>
                                {t.adminNotes ? truncate(t.adminNotes, 40) : <span className="careers-notes-empty">+ Add note</span>}
                              </button>
                            )}
                          </td>
                          <td>
                            <a href={t.cvFilePath} target="_blank" rel="noreferrer" className="careers-admin-link">View CV</a>
                          </td>
                          <td>
                            <select className={`careers-status-select careers-status--${statusColor(status)}`}
                              value={status}
                              onChange={(e) => void handleStatusChange(t.id, "talent", e.target.value as ApplicantStatus)}>
                              {PIPELINE.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Email templates ── */}
          {activeTab === "templates" && (
            <div className="careers-templates-panel">
              {editingTemplate ? (
                <div className="careers-template-editor">
                  <h3>Editing: {editingTemplate.name.replace(/_/g, " ")}</h3>
                  <label className="careers-field">
                    <span>Subject</span>
                    <input type="text" value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate((c) => c ? { ...c, subject: e.target.value } : c)} />
                  </label>
                  <label className="careers-field careers-field-full" style={{ marginTop: "0.75rem" }}>
                    <span>Body (use {"{{name}}"}, {"{{position}}"}, {"{{interviewLink}}"} as placeholders)</span>
                    <textarea rows={14} value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate((c) => c ? { ...c, body: e.target.value } : c)} />
                  </label>
                  <div className="career-form-actions" style={{ marginTop: "1rem" }}>
                    <button type="button" className="career-secondary-button" onClick={() => setEditingTemplate(null)}>Cancel</button>
                    <button type="button" disabled={isSavingTemplate} onClick={() => void saveTemplate()}>
                      {isSavingTemplate ? "Saving…" : "Save Template"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="careers-templates-list">
                  {templates.map((tpl) => (
                    <article key={tpl.name} className="careers-template-card">
                      <div>
                        <h3>{tpl.name.replace(/_/g, " ")}</h3>
                        <p className="careers-template-subject">{tpl.subject}</p>
                        <p className="careers-template-preview">{tpl.body.slice(0, 100)}…</p>
                      </div>
                      <button type="button" className="career-secondary-button"
                        onClick={() => setEditingTemplate({ ...tpl })}>
                        Edit
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
