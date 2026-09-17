"use client";

import "./admin.css";

import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ADMIN_ROLE_LABELS } from "@/lib/careers/constants";
import type { AdminSessionUser, AdminStats } from "@/types/careers";
import { ADMIN_AUTO_REFRESH_MS, ADMIN_EVENTS, useAdminQuery } from "./api";
import { ApplicationsPanel } from "./applications-panel";
import { AuditPanel } from "./audit-panel";
import {
  IconBriefcase,
  IconClipboardList,
  IconCube,
  IconIdentification,
  IconKey,
  IconSignOut,
  IconUserGroup,
} from "./icons";
import { JobsPanel } from "./jobs-panel";
import { PasswordDialog } from "./password-dialog";
import { TalentPanel } from "./talent-panel";
import { ErrorBanner, Notice, Spinner, ToastProvider, initials, pluralize, useToast } from "./ui";
import { UsersPanel } from "./users-panel";

export type AdminTab = "jobs" | "applications" | "talent" | "users" | "audit";

type TabDefinition = { id: AdminTab; label: string; icon: ReactNode; adminOnly: boolean };

const TABS: readonly TabDefinition[] = [
  { id: "jobs", label: "Job Postings", icon: <IconBriefcase className="adm-icon" />, adminOnly: false },
  { id: "applications", label: "Applications", icon: <IconIdentification className="adm-icon" />, adminOnly: false },
  { id: "talent", label: "Talent Pool", icon: <IconUserGroup className="adm-icon" />, adminOnly: false },
  { id: "users", label: "Team", icon: <IconKey className="adm-icon" />, adminOnly: true },
  { id: "audit", label: "Activity Log", icon: <IconClipboardList className="adm-icon" />, adminOnly: true },
];

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export type AdminAppProps = {
  currentUser: AdminSessionUser;
  initialTab?: string;
  initialApplicationId?: string;
  initialTalentId?: string;
};

type DeepLink = { id: string | undefined; version: number };

function tabsFor(user: AdminSessionUser): TabDefinition[] {
  return TABS.filter((tab) => !tab.adminOnly || user.role === "admin");
}

function resolveInitialTab(props: AdminAppProps): AdminTab {
  const allowed = tabsFor(props.currentUser);
  const requested = allowed.find((tab) => tab.id === props.initialTab);
  if (requested) return requested.id;
  if (props.initialApplicationId) return "applications";
  if (props.initialTalentId) return "talent";
  return "jobs";
}

function validId(value: string | undefined): string | undefined {
  return value && OBJECT_ID.test(value) ? value : undefined;
}

// Reads an id from a CustomEvent detail such as { id }, { applicationId } or { talentId }.
function readEventId(event: Event, keys: string[]): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail === "string") return OBJECT_ID.test(detail) ? detail : null;
  if (!detail || typeof detail !== "object") return null;
  for (const key of keys) {
    const value = (detail as Record<string, unknown>)[key];
    if (typeof value === "string" && OBJECT_ID.test(value)) return value;
  }
  return null;
}

function tabElementId(tab: AdminTab): string {
  return `admin-tab-${tab}`;
}

function panelElementId(tab: AdminTab): string {
  return `admin-panel-${tab}`;
}

export function AdminApp(props: AdminAppProps) {
  return (
    <ToastProvider>
      <AdminWorkspace {...props} />
    </ToastProvider>
  );
}

function AdminWorkspace(props: AdminAppProps) {
  const toast = useToast();
  const [user, setUser] = useState(props.currentUser);
  const [activeTab, setActiveTab] = useState<AdminTab>(() => resolveInitialTab(props));
  const [applicationLink, setApplicationLink] = useState<DeepLink>(() => ({ id: validId(props.initialApplicationId), version: 0 }));
  const [talentLink, setTalentLink] = useState<DeepLink>(() => ({ id: validId(props.initialTalentId), version: 0 }));
  const [passwordRequired, setPasswordRequired] = useState(props.currentUser.mustChangePassword);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // A filter-applications event that arrived while the Applications panel was not mounted.
  const pendingApplicationsFilterRef = useRef<unknown>(null);
  const tabRefs = useRef(new Map<AdminTab, HTMLButtonElement>());

  const tabs = tabsFor(user);
  const locked = passwordRequired;
  const stats = useAdminQuery<AdminStats>(locked ? null : "/api/admin/stats", [], { autoRefreshMs: ADMIN_AUTO_REFRESH_MS });
  const reloadStats = stats.reload;

  function writeTabToUrl(tab: AdminTab) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    // Record deep links belong to the tab they were opened from.
    url.searchParams.delete("application");
    url.searchParams.delete("talent");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function selectTab(tab: AdminTab) {
    setActiveTab(tab);
    setApplicationLink((link) => (link.id ? { id: undefined, version: link.version } : link));
    setTalentLink((link) => (link.id ? { id: undefined, version: link.version } : link));
    writeTabToUrl(tab);
  }

  const handleFilterApplications = useEffectEvent((event: Event) => {
    // A mounted Applications panel receives the event itself.
    if (activeTab === "applications" && !locked) return;
    pendingApplicationsFilterRef.current = event instanceof CustomEvent ? event.detail : null;
    selectTab("applications");
  });

  const handleOpenApplication = useEffectEvent((event: Event) => {
    const id = readEventId(event, ["id", "applicationId"]);
    if (!id) return;
    setActiveTab("applications");
    writeTabToUrl("applications");
    // A new key remounts the panel, which opens initialApplicationId on mount.
    setApplicationLink((link) => ({ id, version: link.version + 1 }));
  });

  const handleOpenTalent = useEffectEvent((event: Event) => {
    const id = readEventId(event, ["id", "talentId", "talentPoolEntryId"]);
    if (!id) return;
    setActiveTab("talent");
    writeTabToUrl("talent");
    setTalentLink((link) => ({ id, version: link.version + 1 }));
  });

  useEffect(() => {
    const onPasswordRequired = () => setPasswordRequired(true);
    const onFilterApplications = (event: Event) => handleFilterApplications(event);
    const onOpenApplication = (event: Event) => handleOpenApplication(event);
    const onOpenTalent = (event: Event) => handleOpenTalent(event);
    window.addEventListener(ADMIN_EVENTS.passwordChangeRequired, onPasswordRequired);
    window.addEventListener(ADMIN_EVENTS.filterApplications, onFilterApplications);
    window.addEventListener(ADMIN_EVENTS.openApplication, onOpenApplication);
    window.addEventListener(ADMIN_EVENTS.openTalent, onOpenTalent);
    return () => {
      window.removeEventListener(ADMIN_EVENTS.passwordChangeRequired, onPasswordRequired);
      window.removeEventListener(ADMIN_EVENTS.filterApplications, onFilterApplications);
      window.removeEventListener(ADMIN_EVENTS.openApplication, onOpenApplication);
      window.removeEventListener(ADMIN_EVENTS.openTalent, onOpenTalent);
    };
  }, []);

  // Replays a queued job filter once the Applications panel has mounted. Child effects run
  // before this one, so the panel's listener is already registered.
  useEffect(() => {
    if (activeTab !== "applications" || locked) return;
    const detail = pendingApplicationsFilterRef.current;
    if (detail === null) return;
    pendingApplicationsFilterRef.current = null;
    window.dispatchEvent(new CustomEvent(ADMIN_EVENTS.filterApplications, { detail }));
  }, [activeTab, locked]);

  // Admin-only tabs disappear if the role changes; fall back to jobs.
  const visibleTab: AdminTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : "jobs";

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    selectTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    } catch {
      // The session cookie is cleared server-side when reachable; navigate away regardless.
    } finally {
      // Full page load so no candidate data stays in memory.
      window.location.replace(new URL("/careers/admin/login", window.location.origin).href);
    }
  }

  function handlePasswordChanged() {
    setPasswordDialogOpen(false);
    setPasswordRequired(false);
    setUser((current) => ({ ...current, mustChangePassword: false }));
    toast.success("Your password was changed.");
  }

  const data = stats.data;
  const statValue = (value: number | undefined) => (data && value !== undefined ? value.toLocaleString("en-GB") : "—");
  const tabCounts: Partial<Record<AdminTab, number>> = data
    ? {
        jobs: data.jobs.draft + data.jobs.published + data.jobs.closed,
        applications: data.applications.total,
        talent: data.talentPool.total,
      }
    : {};

  const statCards: { label: string; value: string; tone: string; note?: string }[] = [
    { label: "Open jobs", value: statValue(data?.jobs.open), tone: "teal" },
    {
      label: "Total applications",
      value: statValue(data?.applications.total),
      tone: "ink",
      note: data ? `${data.applications.last7Days.toLocaleString("en-GB")} in the last 7 days` : undefined,
    },
    { label: "Submitted", value: statValue(data?.applications.byStatus.submitted), tone: "blue" },
    { label: "Under review", value: statValue(data?.applications.byStatus.under_review), tone: "amber" },
    { label: "Shortlisted", value: statValue(data?.applications.byStatus.shortlisted), tone: "purple" },
    { label: "Interview", value: statValue(data?.applications.byStatus.interview), tone: "indigo" },
    { label: "Selected", value: statValue(data?.applications.byStatus.selected), tone: "green" },
  ];

  let panel: ReactNode;
  if (visibleTab === "jobs") panel = <JobsPanel onChanged={reloadStats} />;
  else if (visibleTab === "applications") {
    panel = (
      <ApplicationsPanel
        key={`applications-${applicationLink.version}`}
        currentUser={user}
        initialApplicationId={applicationLink.id}
        onChanged={reloadStats}
      />
    );
  } else if (visibleTab === "talent") {
    panel = <TalentPanel key={`talent-${talentLink.version}`} currentUser={user} initialTalentId={talentLink.id} onChanged={reloadStats} />;
  } else if (visibleTab === "users") panel = <UsersPanel currentUser={user} />;
  else panel = <AuditPanel />;

  return (
    <div className="careers-admin-layout adm-root">
      <header className="adm-topbar">
        <div className="adm-brand">
          <span className="adm-brand-mark" aria-hidden="true">
            <IconCube className="adm-icon" />
          </span>
          <div>
            <p className="adm-brand-name">Synergy Pharma</p>
            <p className="adm-brand-sub">Careers Admin</p>
          </div>
        </div>
        <div className="adm-topbar-user">
          <div className="adm-user">
            <span className="adm-avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div className="adm-user-text">
              <p className="adm-user-name" title={user.email}>
                {user.name}
              </p>
              <p className="adm-user-role">{ADMIN_ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <div className="adm-topbar-actions">
            <button
              type="button"
              className="adm-btn adm-btn-secondary adm-btn-sm"
              onClick={() => setPasswordDialogOpen(true)}
              disabled={locked || signingOut}
            >
              <IconKey className="adm-icon" />
              Change password
            </button>
            <button
              type="button"
              className="adm-btn adm-btn-secondary adm-btn-sm"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              aria-busy={signingOut || undefined}
            >
              {signingOut ? <Spinner size="sm" /> : <IconSignOut className="adm-icon" />}
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      {locked ? (
        <section className="adm-card adm-panel" aria-labelledby="admin-locked-heading">
          <div className="adm-panel-heading">
            <p className="adm-eyebrow">Account security</p>
            <h2 id="admin-locked-heading" className="adm-title">
              Change your password to continue
            </h2>
          </div>
          <Notice tone="warning">
            You&apos;re signed in with a temporary password. Set a new password to open job postings, applications and the talent pool.
          </Notice>
        </section>
      ) : (
        <>
          <section aria-label="Recruitment summary" className="adm-stack">
            <ul className="adm-stats" aria-busy={stats.loading || undefined}>
              {statCards.map((card) => (
                <li key={card.label} className="adm-stat" data-tone={card.tone}>
                  <p className="adm-stat-label">{card.label}</p>
                  <p className="adm-stat-value">{card.value}</p>
                  {card.note ? <p className="adm-stat-note">{card.note}</p> : null}
                </li>
              ))}
            </ul>
            {stats.error ? <ErrorBanner title="Couldn't load the dashboard counts." error={stats.error} onRetry={reloadStats} /> : null}
            {user.role === "admin" && data && data.emails.failed > 0 ? (
              <Notice tone="warning">
                {pluralize(data.emails.failed, "notification email")} could not be delivered. Check the email (SMTP) settings and the server
                logs.
              </Notice>
            ) : null}
          </section>

          <div className="adm-tabs" role="tablist" aria-label="Admin sections">
            {tabs.map((tab, index) => {
              const selected = tab.id === visibleTab;
              const count = tabCounts[tab.id];
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(tab.id, element);
                    else tabRefs.current.delete(tab.id);
                  }}
                  type="button"
                  role="tab"
                  id={tabElementId(tab.id)}
                  className="adm-tab"
                  aria-selected={selected}
                  aria-controls={selected ? panelElementId(tab.id) : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    if (!selected) selectTab(tab.id);
                  }}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.icon}
                  {tab.label}
                  {count !== undefined ? <span className="adm-tab-count">{count.toLocaleString("en-GB")}</span> : null}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={panelElementId(visibleTab)} aria-labelledby={tabElementId(visibleTab)} className="adm-tabpanel">
            {panel}
          </div>
        </>
      )}

      <PasswordDialog
        open={locked || passwordDialogOpen}
        required={locked}
        email={user.email}
        onClose={() => setPasswordDialogOpen(false)}
        onChanged={handlePasswordChanged}
        onSignOut={() => void handleSignOut()}
        signingOut={signingOut}
      />
    </div>
  );
}
