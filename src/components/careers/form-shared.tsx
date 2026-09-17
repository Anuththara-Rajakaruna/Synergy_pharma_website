"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { fileDescriptor } from "@/components/careers/upload-client";
import { UPLOAD_LIMITS, type DocumentKind } from "@/lib/careers/constants";
import { formatFileSize } from "@/lib/careers/format";
import { describeFileProblem } from "@/lib/careers/validation";
import "./form-controls.css";

// Building blocks shared by the public careers forms.

export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return list.length > 0 ? list.join(" ") : undefined;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="careers-field-error">
      {message}
    </p>
  );
}

export type FieldControlProps = {
  id: string;
  required: boolean | undefined;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

type FormFieldProps = {
  id: string;
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  counter?: { length: number; max: number };
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

// A labelled `.careers-field` whose control receives ids for its hint, counter and error. The
// error sits outside the <label> so it is not read as part of the field's name.
export function FormField({ id, label, required = false, optional = false, hint, counter, error, className, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : null;
  const counterId = counter ? `${id}-count` : null;
  const errorId = error ? `${id}-error` : null;
  return (
    <div className={className ? `careers-field ${className}` : "careers-field"}>
      <span>
        <label htmlFor={id}>{label}</label>
        {required ? (
          <>
            {" "}
            <span aria-hidden="true">*</span>
          </>
        ) : null}
        {optional ? (
          <>
            {" "}
            <span className="text-[#587285] font-normal">(optional)</span>
          </>
        ) : null}
      </span>
      {children({
        id,
        required: required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy(hintId, counterId, errorId),
      })}
      {hint || counter ? (
        <span className="careers-field-meta">
          {hint ? (
            <span id={hintId ?? undefined} className="text-xs text-[#587285] mt-1">
              {hint}
            </span>
          ) : null}
          {counter ? (
            <span id={counterId ?? undefined} className={`careers-char-count${counter.length > counter.max ? " is-over" : ""}`}>
              {counter.length} / {counter.max} characters
            </span>
          ) : null}
        </span>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes("Files");
}

type DocumentUploadFieldProps = {
  id: string;
  kind: DocumentKind;
  label: string;
  required?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  error?: string;
  onErrorChange: (message: string) => void;
  disabled?: boolean;
  prompt: string;
  hint: string;
};

// PDF picker with drag and drop. The native file input stays focusable (visually hidden) and
// the drop area is its <label>, so there are no nested interactive controls; selected files are
// listed separately, each with its own Remove button.
export function DocumentUploadField({
  id,
  kind,
  label,
  required = false,
  files,
  onChange,
  error,
  onErrorChange,
  disabled = false,
  prompt,
  hint,
}: DocumentUploadFieldProps) {
  const maxFiles = kind === "cv" ? 1 : UPLOAD_LIMITS.maxSupportingDocuments;
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInputRef = useRef(false);

  useEffect(() => {
    if (!focusInputRef.current) return;
    focusInputRef.current = false;
    inputRef.current?.focus();
  }, [files]);

  // A file dropped just outside the drop area would make the browser open it and discard the
  // half-completed form. Drops the field handles itself are already default-prevented.
  useEffect(() => {
    const blockStrayDrop = (event: globalThis.DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer && event.type === "dragover") event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", blockStrayDrop);
    window.addEventListener("drop", blockStrayDrop);
    return () => {
      window.removeEventListener("dragover", blockStrayDrop);
      window.removeEventListener("drop", blockStrayDrop);
    };
  }, []);

  function addFiles(incoming: File[]) {
    if (disabled || incoming.length === 0) return;
    const problems: string[] = [];

    if (maxFiles === 1) {
      const file = incoming[0];
      const problem = describeFileProblem(fileDescriptor(file), kind);
      if (problem) {
        onChange([]);
        onErrorChange(problem);
        setAnnouncement(problem);
        return;
      }
      onChange([file]);
      onErrorChange(incoming.length > 1 ? "Only one CV can be attached. We kept the first file." : "");
      setAnnouncement(`${label} attached: ${file.name}`);
      return;
    }

    const next = [...files];
    const added: string[] = [];
    for (const file of incoming) {
      const duplicate = next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified);
      if (duplicate) continue;
      const problem = describeFileProblem(fileDescriptor(file), kind);
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
        continue;
      }
      if (next.length >= maxFiles) {
        problems.push(`You can attach up to ${maxFiles} supporting documents.`);
        break;
      }
      next.push(file);
      added.push(file.name);
    }
    onChange(next);
    onErrorChange(problems.join(" "));
    setAnnouncement([added.length > 0 ? `Attached: ${added.join(", ")}.` : "", ...problems].filter(Boolean).join(" "));
  }

  function removeFile(index: number) {
    if (disabled) return;
    const removed = files[index];
    focusInputRef.current = true;
    onChange(files.filter((_, position) => position !== index));
    onErrorChange("");
    if (removed) setAnnouncement(`Removed ${removed.name}.`);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    // Reset so choosing the same file again still triggers a change.
    event.target.value = "";
    addFiles(selected);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    if (!disabled) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const canAdd = files.length < maxFiles;

  return (
    <div
      className={`careers-field careers-field-full careers-upload-field${dragging ? " is-dragging" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span id={labelId}>
        {label}{" "}
        {required ? <span aria-hidden="true">*</span> : <span className="text-[#587285] font-normal">(optional)</span>}
      </span>

      {files.length > 0 ? (
        <ul className="careers-upload-list" aria-labelledby={labelId}>
          {files.map((file, index) => (
            <li key={`${index}-${file.name}-${file.size}-${file.lastModified}`} className="careers-upload-file">
              <span className="careers-upload-file-icon" aria-hidden="true">
                📄
              </span>
              <span className="careers-upload-file-meta">
                <span className="careers-upload-file-name">{file.name}</span>
                <span className="careers-upload-file-size">{formatFileSize(file.size)}</span>
              </span>
              <button
                type="button"
                className="careers-upload-remove"
                aria-label={`Remove ${file.name}`}
                onClick={() => removeFile(index)}
                disabled={disabled}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd ? (
        <div className="careers-dropzone-wrap">
          <input
            ref={inputRef}
            id={id}
            type="file"
            className="careers-upload-input"
            accept="application/pdf,.pdf"
            multiple={maxFiles > 1}
            required={required || undefined}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={describedBy(hintId, error && errorId)}
            aria-invalid={error ? true : undefined}
            onChange={handleInputChange}
          />
          <label htmlFor={id} className="careers-dropzone">
            <span className="careers-dropzone-title">{prompt}</span>
            <span id={hintId} className="careers-dropzone-hint">
              {hint}
            </span>
          </label>
        </div>
      ) : maxFiles > 1 ? (
        <p className="careers-upload-note">You have attached the maximum of {maxFiles} supporting documents.</p>
      ) : null}

      <FieldError id={errorId} message={error} />
      <span className="careers-sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

type UploadProgressProps = {
  id: string;
  phase: "uploading" | "submitting";
  fraction: number;
  uploadingLabel?: string;
  submittingLabel: string;
  onCancel?: () => void;
};

// Combined progress for all files (role=progressbar), then an indeterminate bar while the
// submission itself is processed. Cancel is offered only while files are uploading.
export function UploadProgress({ id, phase, fraction, uploadingLabel = "Uploading your documents", submittingLabel, onCancel }: UploadProgressProps) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const uploading = phase === "uploading";
  const labelId = `${id}-label`;
  return (
    <div className="careers-upload-progress">
      <div className="careers-upload-progress-head">
        <span id={labelId}>{uploading ? uploadingLabel : submittingLabel}…</span>
        {uploading ? <span aria-hidden="true">{percent}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={uploading ? percent : undefined}
        aria-valuetext={uploading ? `${percent}% uploaded` : "Processing"}
        className={`careers-upload-progress-track${uploading ? "" : " is-indeterminate"}`}
      >
        <div className="careers-upload-progress-bar" style={{ width: uploading ? `${percent}%` : undefined }} />
      </div>
      {uploading && onCancel ? (
        <button type="button" className="career-secondary-button careers-upload-cancel" onClick={onCancel}>
          Cancel upload
        </button>
      ) : null}
      <span className="careers-sr-only" aria-live="polite">
        {uploading ? `${uploadingLabel}.` : `${submittingLabel}.`}
      </span>
    </div>
  );
}
