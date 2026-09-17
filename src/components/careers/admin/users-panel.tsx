"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, FIELD_LIMITS, type AdminRole } from "@/lib/careers/constants";
import { formatDate } from "@/lib/careers/format";
import { hasControlCharacters, isAdminRole, validateEmail, validatePersonName, type FieldErrors } from "@/lib/careers/validation";
import type {
  AdminSessionUser,
  AdminUserInfo,
  CreateAdminUserPayload,
  CreateAdminUserResponse,
  UpdateAdminUserPayload,
} from "@/types/careers";
import { adminFetch, toAdminApiError, useAdminQuery, type AdminApiError } from "./api";
import { IconKey, IconPencil, IconRefresh, IconUserGroup, IconUserPlus } from "./icons";
import {
  Badge,
  CheckboxField,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Modal,
  Notice,
  SelectField,
  SkeletonRows,
  Spinner,
  TextField,
  initials,
  pluralize,
  useToast,
} from "./ui";

const ROLE_OPTIONS = ADMIN_ROLES.map((role) => ({ value: role, label: ADMIN_ROLE_LABELS[role] }));

const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  admin: "Full access, including team accounts, the activity log, permanent deletion and candidate data exports.",
  hr: "Job postings, applications and the talent pool. Can't manage accounts, view the activity log or permanently delete records.",
};

type UserField = "email" | "name" | "role" | "active";

// A temporary password returned by the API. It lives only in this component's state and is
// dropped as soon as the dialog showing it is closed.
type PasswordReveal = {
  kind: "created" | "reset";
  name: string;
  email: string;
  password: string;
};

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// The shared validator words its "letters only" message for applicants ("your name"); reword it
// for someone entering a colleague's name. Missing, over-long and control-character errors keep
// the validator's own wording.
function checkName(value: string, errors: FieldErrors): string {
  const name = validatePersonName(value, errors);
  if (errors.name && name && name.length <= FIELD_LIMITS.name && !hasControlCharacters(name)) {
    errors.name = "Use letters only (spaces, apostrophes, full stops and hyphens are allowed).";
  }
  return name;
}

function pickFieldErrors(apiError: AdminApiError, fields: readonly UserField[]): Partial<Record<UserField, string>> {
  const result: Partial<Record<UserField, string>> = {};
  for (const field of fields) {
    const message = apiError.fields?.[field];
    if (message) result[field] = message;
  }
  return result;
}

function focusById(id: string | null) {
  if (!id) return;
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export function UsersPanel({ currentUser }: { currentUser: AdminSessionUser }) {
  const toast = useToast();
  const headingId = useId();
  const { data, error, loading, reload } = useAdminQuery<{ items: AdminUserInfo[] }>("/api/admin/users");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserInfo | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserInfo | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reveal, setReveal] = useState<PasswordReveal | null>(null);

  const users = data?.items ?? null;
  const activeCount = users ? users.filter((user) => user.active).length : 0;
  const activeAdminCount = users ? users.filter((user) => user.active && user.role === "admin").length : 0;

  function handleCreated(response: CreateAdminUserResponse) {
    setCreateOpen(false);
    // The password dialog doubles as the success message.
    setReveal({ kind: "created", name: response.user.name, email: response.user.email, password: response.temporaryPassword });
    reload();
  }

  function handleSaved(before: AdminUserInfo, after: AdminUserInfo) {
    setEditing(null);
    let message = `Saved changes to ${after.name}'s account.`;
    if (before.active && !after.active) message = `${after.name}'s account was deactivated and signed out of every device.`;
    else if (!before.active && after.active) message = `${after.name}'s account was reactivated.`;
    if (after.id === currentUser.id && before.name !== after.name) {
      message += " Your new name appears in the top bar the next time the page loads.";
    }
    toast.success(message);
    reload();
  }

  function handleMissing() {
    setEditing(null);
    toast.error("This account no longer exists.");
    reload();
  }

  async function confirmReset() {
    const target = resetTarget;
    if (!target || resetting) return;
    setResetting(true);
    try {
      const result = await adminFetch<{ temporaryPassword: string }>(
        `/api/admin/users/${encodeURIComponent(target.id)}/reset-password`,
        { method: "POST" }
      );
      setResetTarget(null);
      setReveal({ kind: "reset", name: target.name, email: target.email, password: result.temporaryPassword });
      reload();
    } catch (err) {
      const apiError = toAdminApiError(err);
      setResetTarget(null);
      toast.error(apiError.status === 404 ? "This account no longer exists." : apiError.message);
      if (apiError.status === 404) reload();
    } finally {
      setResetting(false);
    }
  }

  let content: ReactNode;
  if (users === null && error) {
    content = <ErrorBanner title="Couldn't load team accounts." error={error} onRetry={reload} />;
  } else if (users === null) {
    content = <SkeletonRows rows={3} label="Loading team accounts…" />;
  } else if (users.length === 0) {
    content = (
      <EmptyState
        icon={<IconUserGroup className="adm-icon" />}
        title="No accounts yet."
        description="Add the people who manage job postings and candidates."
      />
    );
  } else {
    const rowProps = (user: AdminUserInfo) => ({
      user,
      isSelf: user.id === currentUser.id,
      disabled: resetting,
      onEdit: () => setEditing(user),
      onReset: () => setResetTarget(user),
    });
    content = (
      <>
        {error ? <ErrorBanner title="Couldn't refresh team accounts." error={error} onRetry={reload} /> : null}
        {activeAdminCount === 1 ? (
          <Notice>
            There is only one active administrator. Consider giving a second trusted person the Administrator role so access can be
            recovered if that account is locked or unavailable.
          </Notice>
        ) : null}

        <div className="adm-table-wrap adm-only-desktop">
          <table className="adm-table" aria-busy={loading || undefined}>
            <caption className="adm-sr-only">Team accounts</caption>
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col" className="adm-cell-actions">
                  <span className="adm-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserTableRow key={user.id} {...rowProps(user)} />
              ))}
            </tbody>
          </table>
        </div>

        <ul className="adm-cards adm-only-mobile" aria-label="Team accounts" aria-busy={loading || undefined}>
          {users.map((user) => (
            <UserCard key={user.id} {...rowProps(user)} />
          ))}
        </ul>
      </>
    );
  }

  const resultText =
    users === null
      ? loading
        ? "Loading team accounts…"
        : ""
      : `${pluralize(users.length, "account")} · ${activeCount.toLocaleString("en-GB")} active`;

  return (
    <section className="adm-card adm-panel" aria-labelledby={headingId}>
      <div className="adm-panel-header">
        <div className="adm-panel-heading">
          <p className="adm-eyebrow">Team</p>
          <h2 id={headingId} className="adm-title">
            Admin accounts
          </h2>
          <p className="adm-results" aria-live="polite">
            {resultText}
          </p>
        </div>
        <div className="adm-panel-actions">
          <button type="button" className="adm-btn adm-btn-secondary" onClick={reload} disabled={loading} aria-busy={loading || undefined}>
            {loading ? <Spinner size="sm" /> : <IconRefresh className="adm-icon" />}
            Refresh
          </button>
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => setCreateOpen(true)}>
            <IconUserPlus className="adm-icon" />
            Add user
          </button>
        </div>
      </div>

      <p className="adm-subtitle">
        <strong>{ADMIN_ROLE_LABELS.admin}:</strong> {ROLE_DESCRIPTIONS.admin} <strong>{ADMIN_ROLE_LABELS.hr}:</strong> {ROLE_DESCRIPTIONS.hr}
      </p>

      {content}

      {createOpen ? <CreateUserDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} /> : null}

      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          isSelf={editing.id === currentUser.id}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onMissing={handleMissing}
        />
      ) : null}

      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset this password?"
        message={
          resetTarget ? (
            <>
              <strong>{resetTarget.name}</strong>&apos;s current password stops working immediately and they are signed out of every device.
              You&apos;ll receive a temporary password to pass on, which they must change when they next sign in.
              {resetTarget.lockedUntil ? " This also unlocks the account." : ""}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Reset password"
        tone="danger"
        busy={resetting}
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
      />

      {reveal ? <TemporaryPasswordDialog reveal={reveal} onDone={() => setReveal(null)} /> : null}
    </section>
  );
}

// ── List rows ────────────────────────────────────────────────────────────────

type UserRowProps = {
  user: AdminUserInfo;
  isSelf: boolean;
  disabled: boolean;
  onEdit: () => void;
  onReset: () => void;
};

function RoleBadge({ role }: { role: AdminRole }) {
  return <Badge tone={role === "admin" ? "teal" : "sky"}>{ADMIN_ROLE_LABELS[role] ?? role}</Badge>;
}

function StatusBadges({ user }: { user: AdminUserInfo }) {
  return (
    <span className="adm-badge-group">
      {user.active ? (
        <Badge tone="green" dot>
          Active
        </Badge>
      ) : (
        <Badge tone="gray">Inactive</Badge>
      )}
      {user.lockedUntil ? (
        <Badge tone="rose">Locked</Badge>
      ) : null}
      {user.mustChangePassword ? <Badge tone="amber">Temporary password</Badge> : null}
    </span>
  );
}

function LockNote({ lockedUntil }: { lockedUntil: string | null }) {
  if (!lockedUntil) return null;
  return (
    <span className="adm-text-sm adm-muted">
      Too many failed sign-ins. Unlocks <time dateTime={lockedUntil}>{formatDate(lockedUntil, { withTime: true })}</time>.
    </span>
  );
}

function lastSignIn(user: AdminUserInfo): ReactNode {
  if (!user.lastLoginAt) return <span className="adm-muted">Never</span>;
  return <time dateTime={user.lastLoginAt}>{formatDate(user.lastLoginAt, { withTime: true })}</time>;
}

function UserActions({ user, isSelf, disabled, onEdit, onReset }: UserRowProps) {
  return (
    <>
      <button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={onEdit} disabled={disabled}>
        <IconPencil className="adm-icon" />
        Edit<span className="adm-sr-only"> {user.name}</span>
      </button>
      {isSelf ? null : (
        <button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={onReset} disabled={disabled}>
          <IconKey className="adm-icon" />
          Reset password<span className="adm-sr-only"> for {user.name}</span>
        </button>
      )}
    </>
  );
}

function UserTableRow(props: UserRowProps) {
  const { user, isSelf } = props;
  return (
    <tr>
      <td>
        <div className="adm-user">
          <span className="adm-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <div className="adm-user-text">
            <span className="adm-cell-strong">
              {user.name}
              {isSelf ? <span className="adm-muted"> (you)</span> : null}
            </span>
            <span className="adm-text-sm adm-muted">{user.email}</span>
          </div>
        </div>
      </td>
      <td className="adm-cell-nowrap">
        <RoleBadge role={user.role} />
      </td>
      <td>
        <div className="adm-user-text">
          <StatusBadges user={user} />
          <LockNote lockedUntil={user.lockedUntil} />
        </div>
      </td>
      <td className="adm-cell-nowrap">{lastSignIn(user)}</td>
      <td className="adm-cell-actions">
        <div className="adm-row-actions">
          <UserActions {...props} />
        </div>
      </td>
    </tr>
  );
}

function UserCard(props: UserRowProps) {
  const { user, isSelf } = props;
  return (
    <li className="adm-record-card">
      <div className="adm-record-card-header">
        <div className="adm-user">
          <span className="adm-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <div className="adm-user-text">
            <p className="adm-record-card-title">
              {user.name}
              {isSelf ? <span className="adm-muted"> (you)</span> : null}
            </p>
            <p className="adm-record-card-meta">{user.email}</p>
          </div>
        </div>
        <RoleBadge role={user.role} />
      </div>
      <StatusBadges user={user} />
      <LockNote lockedUntil={user.lockedUntil} />
      <p className="adm-record-card-meta">Last sign-in: {lastSignIn(user)}</p>
      <div className="adm-record-card-actions">
        <UserActions {...props} />
      </div>
    </li>
  );
}

// ── Add user ─────────────────────────────────────────────────────────────────

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (response: CreateAdminUserResponse) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("hr");
  const [errors, setErrors] = useState<Partial<Record<UserField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const idPrefix = useId();
  const formErrorId = `${idPrefix}-form-error`;

  function fieldId(field: UserField) {
    return `${idPrefix}-${field}`;
  }

  function clearError(field: UserField) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function firstErrorTarget(fieldErrors: Partial<Record<UserField, string>>): string | null {
    const first = (["email", "name", "role"] as const).find((field) => fieldErrors[field]);
    return first ? fieldId(first) : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const clientErrors: FieldErrors = {};
    const checkedEmail = validateEmail(email, clientErrors, "email", "Email address");
    const checkedName = checkName(name, clientErrors);
    if (!isAdminRole(role)) clientErrors.role = "Choose a role.";
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(null);
      focusById(firstErrorTarget(clientErrors));
      return;
    }

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const payload: CreateAdminUserPayload = { email: checkedEmail, name: checkedName, role };
      const response = await adminFetch<CreateAdminUserResponse>("/api/admin/users", { method: "POST", json: payload });
      onCreated(response);
    } catch (err) {
      const apiError = toAdminApiError(err);
      const fieldErrors = pickFieldErrors(apiError, ["email", "name", "role"]);
      const messages = Object.values(fieldErrors);
      setErrors(fieldErrors);
      setFormError(messages.includes(apiError.message) ? null : apiError.message);
      setSaving(false);
      focusById(firstErrorTarget(fieldErrors) ?? (messages.includes(apiError.message) ? null : formErrorId));
    }
  }

  return (
    <Modal
      open
      size="md"
      title="Add user"
      description="They receive a temporary password from you and must choose their own password when they first sign in."
      onClose={onClose}
      dismissible={!saving}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : <IconUserPlus className="adm-icon" />}
            {saving ? "Creating…" : "Create account"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        {formError ? (
          <div id={formErrorId} className="adm-form-error" role="alert" tabIndex={-1}>
            {formError}
          </div>
        ) : null}
        <TextField
          id={fieldId("email")}
          label="Work email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearError("email");
          }}
          maxLength={FIELD_LIMITS.email}
          required
          disabled={saving}
          hint="Used to sign in. It can't be changed later."
          error={errors.email}
        />
        <TextField
          id={fieldId("name")}
          label="Full name"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearError("name");
          }}
          maxLength={FIELD_LIMITS.name}
          required
          disabled={saving}
          hint="Shown in status history, notes and the activity log."
          error={errors.name}
        />
        <SelectField
          id={fieldId("role")}
          label="Role"
          value={role}
          onChange={(event) => {
            if (isAdminRole(event.target.value)) setRole(event.target.value);
            clearError("role");
          }}
          options={ROLE_OPTIONS}
          disabled={saving}
          hint={ROLE_DESCRIPTIONS[role]}
          error={errors.role}
        />
      </form>
    </Modal>
  );
}

// ── Edit user ────────────────────────────────────────────────────────────────

type EditUserDialogProps = {
  user: AdminUserInfo;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (before: AdminUserInfo, after: AdminUserInfo) => void;
  onMissing: () => void;
};

function EditUserDialog({ user, isSelf, onClose, onSaved, onMissing }: EditUserDialogProps) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<AdminRole>(user.role);
  const [active, setActive] = useState(user.active);
  const [errors, setErrors] = useState<Partial<Record<UserField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const idPrefix = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const formErrorId = `${idPrefix}-form-error`;

  const cleanedName = cleanName(name);
  const patch: UpdateAdminUserPayload = {};
  if (cleanedName !== user.name) patch.name = cleanedName;
  if (role !== user.role) patch.role = role;
  if (active !== user.active) patch.active = active;
  const dirty = Object.keys(patch).length > 0;
  const demotingAdmin = user.role === "admin" && role !== "admin";
  const deactivating = user.active && !active;

  function fieldId(field: UserField) {
    return `${idPrefix}-${field}`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;

    if (patch.name !== undefined) {
      const clientErrors: FieldErrors = {};
      checkName(name, clientErrors);
      if (clientErrors.name) {
        setErrors({ name: clientErrors.name });
        setFormError(null);
        focusById(fieldId("name"));
        return;
      }
    }

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const response = await adminFetch<{ user: AdminUserInfo }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        json: patch,
      });
      onSaved(user, response.user);
    } catch (err) {
      const apiError = toAdminApiError(err);
      if (apiError.status === 404) {
        onMissing();
        return;
      }
      const fieldErrors = pickFieldErrors(apiError, ["name", "role", "active"]);
      let message: string | null = apiError.message;
      if (apiError.code === "last_admin") {
        message = `${apiError.message} Give another active user the ${ADMIN_ROLE_LABELS.admin} role first.`;
      } else if (Object.values(fieldErrors).includes(apiError.message)) {
        message = null;
      }
      setErrors(fieldErrors);
      setFormError(message);
      setSaving(false);
      focusById(fieldErrors.name ? fieldId("name") : message ? formErrorId : null);
    }
  }

  return (
    <Modal
      open
      size="md"
      title={isSelf ? "Edit your account" : "Edit account"}
      description={user.email}
      onClose={onClose}
      dismissible={!saving}
      closeOnBackdrop={false}
      initialFocusRef={nameRef}
      footer={
        <>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={saving || !dirty} aria-busy={saving || undefined}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving || undefined}>
        {formError ? (
          <div id={formErrorId} className="adm-form-error" role="alert" tabIndex={-1}>
            {formError}
          </div>
        ) : null}

        {user.lockedUntil ? (
          <Notice tone="warning">
            This account is locked after too many failed sign-in attempts. It unlocks automatically at{" "}
            {formatDate(user.lockedUntil, { withTime: true })}
            {isSelf ? "." : ", or reset the password to unlock it now."}
          </Notice>
        ) : null}

        <TextField
          ref={nameRef}
          id={fieldId("name")}
          label="Full name"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => {
              if (!current.name) return current;
              const next = { ...current };
              delete next.name;
              return next;
            });
          }}
          maxLength={FIELD_LIMITS.name}
          required
          disabled={saving}
          error={errors.name}
        />

        <SelectField
          id={fieldId("role")}
          label="Role"
          value={role}
          onChange={(event) => {
            if (isAdminRole(event.target.value)) setRole(event.target.value);
          }}
          options={ROLE_OPTIONS}
          disabled={saving || isSelf}
          hint={isSelf ? "You can't change your own role. Ask another administrator." : ROLE_DESCRIPTIONS[role]}
          error={errors.role}
        />

        <CheckboxField
          id={fieldId("active")}
          label="Account is active"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          disabled={saving || isSelf}
          hint={
            isSelf
              ? "You can't deactivate your own account."
              : "Inactive accounts can't sign in. Their name stays on the records they worked on."
          }
          error={errors.active}
        />

        {deactivating ? (
          <Notice tone="warning">Deactivating signs {user.name} out of every device immediately.</Notice>
        ) : null}
        {demotingAdmin && !deactivating ? (
          <Notice tone="warning">
            {user.name} will lose access to team accounts, the activity log, permanent deletion and candidate data exports.
          </Notice>
        ) : null}
      </form>
    </Modal>
  );
}

// ── One-time temporary password ──────────────────────────────────────────────

function TemporaryPasswordDialog({ reveal, onDone }: { reveal: PasswordReveal; onDone: () => void }) {
  const inputId = useId();
  const hintId = useId();

  return (
    <Modal
      open
      size="md"
      title={reveal.kind === "created" ? "Account created" : "Password reset"}
      description={
        <>
          Temporary password for <strong>{reveal.name}</strong> ({reveal.email})
        </>
      }
      onClose={onDone}
      // Closing is only possible through "Done", so the password is not lost by a stray Escape
      // key press or backdrop click before it has been copied.
      dismissible={false}
      footer={
        <button type="button" className="adm-btn adm-btn-primary" onClick={onDone}>
          Done
        </button>
      }
    >
      <div className="adm-form">
        <Notice tone="warning">
          <p>
            <strong>This password is shown only once.</strong> Copy it now: it can&apos;t be displayed again after you close this window. If
            it&apos;s lost, reset the password again.
          </p>
        </Notice>

        <div className="adm-field">
          <label htmlFor={inputId} className="adm-label">
            Temporary password
          </label>
          <div className="adm-cluster">
            <input
              id={inputId}
              className="adm-input adm-mono"
              value={reveal.password}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-describedby={hintId}
              style={{ flex: "1 1 14rem", width: "auto", fontSize: "1rem", letterSpacing: "0.04em", cursor: "text" }}
            />
            <CopyButton text={reveal.password} label="Copy password" />
          </div>
          <p id={hintId} className="adm-hint">
            Passwords are case-sensitive.
          </p>
        </div>

        <ul className="adm-subtitle list-disc space-y-1 pl-5">
          <li>
            Give it to {reveal.name} privately, for example in person or by phone. Don&apos;t send it in the same message as their email
            address.
          </li>
          <li>They must choose a new password the first time they sign in with it.</li>
          {reveal.kind === "reset" ? <li>Their previous password no longer works and they have been signed out of every device.</li> : null}
        </ul>
      </div>
    </Modal>
  );
}
