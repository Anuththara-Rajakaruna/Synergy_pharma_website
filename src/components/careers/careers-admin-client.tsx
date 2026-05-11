"use client";

import { FormEvent, startTransition, useEffect, useState } from "react";
import { ApplicationRecord, Job, TalentPoolRecord } from "@/types/careers";
import { CAREER_DEPARTMENTS } from "@/components/careers/department-options";

type JobEditorState = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: "Full-time" | "Internship";
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
  description: "",
  responsibilities: "",
  requirements: "",
};

type CareersAdminClientProps = {
  initialJobs: Job[];
};

export function CareersAdminClient({ initialJobs }: CareersAdminClientProps) {
  const [jobs, setJobs] = useState(initialJobs);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [talentPool, setTalentPool] = useState<TalentPoolRecord[]>([]);
  const [editor, setEditor] = useState<JobEditorState>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadApplicants() {
      const response = await fetch("/api/applicants", { cache: "no-store" });
      const result = (await response.json()) as {
        applications: ApplicationRecord[];
        talentPool: TalentPoolRecord[];
      };

      if (!ignore) {
        setApplications(result.applications);
        setTalentPool(result.talentPool);
      }
    }

    void loadApplicants();
    return () => {
      ignore = true;
    };
  }, []);

  function startEditing(job: Job) {
    setEditingId(job.id);
    setEditor({
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      type: job.type,
      description: job.description,
      responsibilities: job.responsibilities.join("\n"),
      requirements: job.requirements.join("\n"),
    });
    setMessage("");
    setError("");
  }

  function resetEditor() {
    setEditingId(null);
    setEditor(emptyEditor);
  }

  async function refreshJobs() {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const result = (await response.json()) as Job[];
    setJobs(result);
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this job posting?");

    if (!confirmed) {
      return;
    }

    const response = await fetch(`/api/jobs/${id}`, { method: "DELETE" });

    if (!response.ok) {
      setError("We couldn't delete that job right now.");
      return;
    }

    await refreshJobs();
    setMessage("Job deleted.");

    if (editingId === id) {
      resetEditor();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !editor.id.trim() ||
      !editor.title.trim() ||
      !editor.department.trim() ||
      !editor.location.trim() ||
      !editor.description.trim() ||
      !editor.responsibilities.trim() ||
      !editor.requirements.trim()
    ) {
      setError("Please complete all job fields before saving.");
      setMessage("");
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");

    const payload = {
      ...editor,
      responsibilities: editor.responsibilities,
      requirements: editor.requirements,
    };

    startTransition(async () => {
      try {
        const response = await fetch(editingId ? `/api/jobs/${editingId}` : "/api/jobs", {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as { error?: string };

        if (!response.ok) {
          setError(result.error ?? "We couldn't save that job right now.");
          return;
        }

        await refreshJobs();
        resetEditor();
        setMessage(editingId ? "Job updated successfully." : "Job added successfully.");
      } catch {
        setError("We couldn't save that job right now.");
      } finally {
        setIsSaving(false);
      }
    });
  }

  return (
    <div className="careers-admin-layout">
      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Admin Tools</p>
          <h2>{editingId ? "Edit job posting" : "Add a new job posting"}</h2>
        </div>

        <form className="career-form" onSubmit={handleSubmit}>
          <div className="career-form-grid">
            <label className="careers-field">
              <span>Job ID / slug</span>
              <input
                type="text"
                value={editor.id}
                disabled={Boolean(editingId)}
                onChange={(event) => setEditor((current) => ({ ...current, id: event.target.value }))}
              />
            </label>
            <label className="careers-field">
              <span>Title</span>
              <input
                type="text"
                value={editor.title}
                onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label className="careers-field">
              <span>Department</span>
              <select
                value={editor.department}
                onChange={(event) => setEditor((current) => ({ ...current, department: event.target.value }))}
              >
                <option value="">Select a department</option>
                {CAREER_DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>
            <label className="careers-field">
              <span>Location</span>
              <input
                type="text"
                value={editor.location}
                onChange={(event) => setEditor((current) => ({ ...current, location: event.target.value }))}
              />
            </label>
            <label className="careers-field">
              <span>Type</span>
              <select
                value={editor.type}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    type: event.target.value === "Internship" ? "Internship" : "Full-time",
                  }))
                }
              >
                <option value="Full-time">Full-time</option>
                <option value="Internship">Internship</option>
              </select>
            </label>
            <label className="careers-field careers-field-full">
              <span>Description</span>
              <textarea
                rows={5}
                value={editor.description}
                onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label className="careers-field careers-field-full">
              <span>Responsibilities (one per line)</span>
              <textarea
                rows={6}
                value={editor.responsibilities}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, responsibilities: event.target.value }))
                }
              />
            </label>
            <label className="careers-field careers-field-full">
              <span>Requirements (one per line)</span>
              <textarea
                rows={6}
                value={editor.requirements}
                onChange={(event) => setEditor((current) => ({ ...current, requirements: event.target.value }))}
              />
            </label>
          </div>

          {error ? <p className="career-form-message career-form-error">{error}</p> : null}
          {message ? <p className="career-form-message career-form-success">{message}</p> : null}

          <div className="career-form-actions">
            <button type="button" className="career-secondary-button" onClick={resetEditor}>
              Clear
            </button>
            <button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Job"}
            </button>
          </div>
        </form>
      </section>

      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Open Roles</p>
          <h2>Manage job postings</h2>
        </div>

        <div className="careers-admin-jobs">
          {jobs.map((job) => (
            <article key={job.id} className="careers-admin-job-row">
              <div>
                <h3>{job.title}</h3>
                <p>
                  {job.department} · {job.location} · {job.type}
                </p>
              </div>
              <div className="careers-admin-job-actions">
                <button type="button" className="career-secondary-button" onClick={() => startEditing(job)}>
                  Edit
                </button>
                <button type="button" onClick={() => void handleDelete(job.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="careers-admin-card">
        <div className="careers-admin-section-header">
          <p className="eyebrow">Applicants</p>
          <h2>View submissions</h2>
        </div>

        <div className="careers-admin-applicants">
          <div>
            <h3>Role applications</h3>
            <div className="careers-admin-list">
              {applications.length === 0 ? <p>No applications yet.</p> : null}
              {applications.map((application) => (
                <article key={application.id} className="careers-admin-application-row">
                  <strong>{application.name}</strong>
                  <span>{application.position}</span>
                  <span>{application.email}</span>
                  <a href={application.cvFilePath} target="_blank" rel="noreferrer">
                    View CV
                  </a>
                </article>
              ))}
            </div>
          </div>

          <div>
            <h3>Talent pool</h3>
            <div className="careers-admin-list">
              {talentPool.length === 0 ? <p>No talent pool submissions yet.</p> : null}
              {talentPool.map((entry) => (
                <article key={entry.id} className="careers-admin-application-row">
                  <strong>{entry.name}</strong>
                  <span>{entry.areaOfInterest}</span>
                  <span>{entry.email}</span>
                  <a href={entry.cvFilePath} target="_blank" rel="noreferrer">
                    View CV
                  </a>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
