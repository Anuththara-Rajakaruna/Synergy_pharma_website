"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/careers/constants";
import { validatePassword, type FieldErrors } from "@/lib/careers/validation";
import type { ChangePasswordPayload } from "@/types/careers";
import { adminFetch, toAdminApiError } from "./api";
import { CheckboxField, Modal, Notice, Spinner, TextField } from "./ui";

export type PasswordDialogProps = {
  open: boolean;
  // Forced change (temporary password): the dialog can't be dismissed, only completed or signed out of.
  required: boolean;
  email: string;
  onClose: () => void;
  onChanged: () => void;
  onSignOut: () => void;
  signingOut?: boolean;
};

type FieldName = "currentPassword" | "newPassword" | "confirmPassword";

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

// A rough guide for the user; the server's validatePassword policy is what is enforced.
function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < PASSWORD_MIN_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const unique = new Set(password).size;
  let score = 1;
  if (password.length >= 16) score += 1;
  if (classes >= 3) score += 1;
  if (unique >= 10 && (password.length >= 20 || classes === 4)) score += 1;
  if (unique < 5) score = 1;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

export function PasswordDialog({ open, ...props }: PasswordDialogProps) {
  if (!open) return null;
  // Mounted only while open so every attempt starts with empty fields.
  return <PasswordDialogContent {...props} />;
}

function PasswordDialogContent({ required, email, onClose, onChanged, onSignOut, signingOut = false }: Omit<PasswordDialogProps, "open">) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const idPrefix = useId();
  const currentRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const strength = passwordStrength(newPassword);
  const inputType = showPasswords ? "text" : "password";
  const busy = saving || signingOut;

  function clearError(field: FieldName) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function focusFirstError(fieldErrors: Partial<Record<FieldName, string>>) {
    const order: FieldName[] = ["currentPassword", "newPassword", "confirmPassword"];
    const first = order.find((field) => fieldErrors[field]);
    window.requestAnimationFrame(() => {
      const target = first ? document.getElementById(`${idPrefix}-${first}`) : formErrorRef.current;
      target?.focus();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const clientErrors: FieldErrors = {};
    if (!currentPassword) clientErrors.currentPassword = "Enter your current password.";
    validatePassword(newPassword, clientErrors, "newPassword");
    if (!clientErrors.newPassword && newPassword === currentPassword) {
      clientErrors.newPassword = "Choose a new password that is different from your current password.";
    }
    if (!confirmPassword) clientErrors.confirmPassword = "Re-enter the new password.";
    else if (confirmPassword !== newPassword) clientErrors.confirmPassword = "The passwords don't match.";
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(null);
      focusFirstError(clientErrors);
      return;
    }

    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const payload: ChangePasswordPayload = { currentPassword, newPassword };
      await adminFetch<{ success: true }>("/api/admin/password", { method: "POST", json: payload });
      onChanged();
    } catch (err) {
      const apiError = toAdminApiError(err);
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      if (apiError.fields?.currentPassword) fieldErrors.currentPassword = apiError.fields.currentPassword;
      if (apiError.fields?.newPassword) fieldErrors.newPassword = apiError.fields.newPassword;
      setErrors(fieldErrors);
      const fieldMessages = Object.values(fieldErrors);
      setFormError(fieldMessages.length > 0 && fieldMessages.includes(apiError.message) ? null : apiError.message);
      if (fieldErrors.currentPassword) setCurrentPassword("");
      setSaving(false);
      focusFirstError(fieldErrors);
    }
  }

  const footer = (
    <>
      {required ? (
        <button type="button" className="adm-btn adm-btn-ghost" onClick={onSignOut} disabled={busy}>
          {signingOut ? <Spinner size="sm" /> : null}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      ) : (
        <button type="button" className="adm-btn adm-btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      )}
      <span className="adm-footer-spacer" />
      <button type="submit" form={formId} className="adm-btn adm-btn-primary" disabled={busy} aria-busy={saving || undefined}>
        {saving ? <Spinner size="sm" /> : null}
        {saving ? "Saving…" : "Change password"}
      </button>
    </>
  );

  return (
    <Modal
      open
      size="sm"
      title={required ? "Set a new password" : "Change password"}
      description={
        required
          ? "You're signed in with a temporary password. Choose a new password to continue."
          : "Other devices signed in to your account will be signed out."
      }
      onClose={onClose}
      dismissible={!required && !busy}
      closeOnBackdrop={false}
      initialFocusRef={currentRef}
      footer={footer}
    >
      <form method="post" id={formId} className="adm-form" onSubmit={handleSubmit} noValidate aria-busy={saving}>
        {formError ? (
          <div ref={formErrorRef} className="adm-form-error" role="alert" tabIndex={-1}>
            {formError}
          </div>
        ) : null}

        {/* Lets password managers associate the new password with this account. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

        <TextField
          ref={currentRef}
          id={`${idPrefix}-currentPassword`}
          label={required ? "Temporary password" : "Current password"}
          type={inputType}
          name="current-password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
            clearError("currentPassword");
          }}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          disabled={busy}
          error={errors.currentPassword}
        />

        <div className="adm-field">
          <TextField
            id={`${idPrefix}-newPassword`}
            label="New password"
            type={inputType}
            name="new-password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              clearError("newPassword");
            }}
            maxLength={PASSWORD_MAX_LENGTH}
            required
            disabled={busy}
            aria-describedby={`${idPrefix}-strength`}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. A long passphrase mixing words, numbers and symbols is strongest.`}
            error={errors.newPassword}
          />
          <div className="adm-meter" data-score={newPassword ? strength : 0} aria-hidden="true">
            <span className="adm-meter-segment" />
            <span className="adm-meter-segment" />
            <span className="adm-meter-segment" />
            <span className="adm-meter-segment" />
          </div>
          <p id={`${idPrefix}-strength`} className="adm-hint" aria-live="polite">
            {newPassword ? `Strength: ${STRENGTH_LABELS[strength]}` : ""}
          </p>
        </div>

        <TextField
          id={`${idPrefix}-confirmPassword`}
          label="Confirm new password"
          type={inputType}
          name="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            clearError("confirmPassword");
          }}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          disabled={busy}
          error={errors.confirmPassword}
        />

        <CheckboxField label="Show passwords" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} disabled={busy} />

        {required ? (
          <Notice>
            Your administrator gave you a temporary password. Until you change it, the rest of the admin portal stays locked.
          </Notice>
        ) : null}
      </form>
    </Modal>
  );
}
