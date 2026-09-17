"use client";

// Shared building blocks for the careers admin UI: dialogs, feedback, badges and form fields.
// Styles live in ./admin.css (imported once by AdminApp). Dialogs and toasts render into
// document.body through portals, so they are never clipped by the page's transformed or
// blurred sections.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  APPLICATION_STATUS_LABELS,
  FIELD_LIMITS,
  JOB_STATUS_LABELS,
  type ApplicationStatus,
  type JobStatus,
} from "@/lib/careers/constants";
import { normalizeTags, type FieldErrors } from "@/lib/careers/validation";
import {
  IconCheck,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconClose,
  IconInfo,
  IconRefresh,
  IconSearch,
  IconWarning,
} from "./icons";

// ── Small helpers ────────────────────────────────────────────────────────────

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Collapses whitespace in a display name; empty names become the fallback.
export function formatName(name: string | null | undefined, fallback = "—"): string {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export function initials(name: string | null | undefined): string {
  const parts = formatName(name, "").split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : plural}`;
}

const noopSubscribe = () => () => {};

// True after hydration. Portals need document.body, which does not exist during SSR.
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

// ── Dialog infrastructure ────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable='true']",
  "[tabindex]",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length > 0
  );
}

// Open dialogs, innermost last. Only the top dialog reacts to Escape/Tab and keeps focus.
const dialogStack: HTMLElement[] = [];

let scrollLockCount = 0;
let savedScrollStyles: { htmlOverflow: string; bodyOverflow: string; bodyPaddingRight: string } | null = null;

function lockScroll(): void {
  scrollLockCount += 1;
  if (scrollLockCount > 1) return;
  const html = document.documentElement;
  const body = document.body;
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  savedScrollStyles = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPaddingRight: body.style.paddingRight };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
}

function unlockScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0 || !savedScrollStyles) return;
  document.documentElement.style.overflow = savedScrollStyles.htmlOverflow;
  document.body.style.overflow = savedScrollStyles.bodyOverflow;
  document.body.style.paddingRight = savedScrollStyles.bodyPaddingRight;
  savedScrollStyles = null;
}

type DialogBehaviorOptions = {
  dismissible: boolean;
  onDismiss: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

// Focus trap, Escape handling, scroll lock and focus restoration for a mounted dialog.
function useDialogBehavior(dialogRef: RefObject<HTMLElement | null>, options: DialogBehaviorOptions): void {
  const { initialFocusRef } = options;

  const handleKeyDown = useEffectEvent((event: KeyboardEvent, element: HTMLElement) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented || !options.dismissible) return;
      event.preventDefault();
      event.stopPropagation();
      options.onDismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusable(element);
    if (focusable.length === 0) {
      event.preventDefault();
      element.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && element.contains(active);
    if (event.shiftKey && (!inside || active === first || active === element)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  });

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogStack.push(element);
    lockScroll();

    const target =
      initialFocusRef?.current ??
      element.querySelector<HTMLElement>("[data-autofocus]") ??
      getFocusable(element).find((candidate) => !candidate.hasAttribute("data-dialog-close")) ??
      element;
    target.focus({ preventScroll: true });

    const isTop = () => dialogStack[dialogStack.length - 1] === element;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTop()) handleKeyDown(event, element);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop() || !(event.target instanceof Node) || element.contains(event.target)) return;
      // Toasts live outside the dialog; let their buttons take focus briefly.
      if (event.target instanceof Element && event.target.closest("[data-admin-toasts]")) return;
      (getFocusable(element)[0] ?? element).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const index = dialogStack.lastIndexOf(element);
      if (index >= 0) dialogStack.splice(index, 1);
      unlockScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [dialogRef, initialFocusRef]);
}

type DialogFrameProps = {
  variant: "modal" | "drawer";
  size?: ModalSize;
  role?: "dialog" | "alertdialog";
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  icon?: ReactNode;
};

function DialogFrame({
  variant,
  size = "md",
  role = "dialog",
  title,
  subtitle,
  description,
  children,
  footer,
  onClose,
  dismissible = true,
  closeOnBackdrop = true,
  initialFocusRef,
  className,
  icon,
}: DialogFrameProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const hasDescription = Boolean(description || subtitle);

  useDialogBehavior(dialogRef, { dismissible, onDismiss: onClose, initialFocusRef });

  const isDrawer = variant === "drawer";
  return (
    <div
      className={cx("adm-portal", isDrawer ? "adm-drawer-overlay" : "adm-overlay")}
      data-lenis-prevent=""
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const pressedOnBackdrop = backdropPressRef.current;
        backdropPressRef.current = false;
        if (event.target !== event.currentTarget || !pressedOnBackdrop) return;
        if (dismissible && closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasDescription ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(isDrawer ? "adm-drawer" : "adm-modal", className)}
        data-size={isDrawer ? undefined : size}
      >
        <div className={isDrawer ? "adm-drawer-header" : "adm-modal-header"}>
          {icon}
          <div className="adm-dialog-heading">
            <h2 id={titleId} className={isDrawer ? "adm-drawer-title" : "adm-modal-title"}>
              {title}
            </h2>
            {isDrawer && subtitle ? (
              <div id={descriptionId} className="adm-drawer-subtitle">
                {subtitle}
              </div>
            ) : null}
            {!isDrawer && description ? (
              <div id={descriptionId} className="adm-modal-description">
                {description}
              </div>
            ) : null}
          </div>
          {dismissible ? (
            <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close" data-dialog-close="">
              <IconClose className="adm-icon" strokeWidth={2.5} />
            </button>
          ) : null}
        </div>
        {children !== undefined && children !== null && children !== false ? (
          <div className={isDrawer ? "adm-drawer-body" : "adm-modal-body"}>{children}</div>
        ) : null}
        {footer ? <div className={isDrawer ? "adm-drawer-footer" : "adm-modal-footer"}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export type ModalSize = "sm" | "md" | "lg" | "xl";

export type ModalProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  // Short text under the title, announced as the dialog description.
  description?: ReactNode;
  // false: no close button, Escape and backdrop clicks are ignored (e.g. a forced password change).
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  role?: "dialog" | "alertdialog";
  className?: string;
};

export function Modal({ open, ...props }: ModalProps) {
  const isClient = useIsClient();
  if (!open || !isClient) return null;
  return createPortal(<DialogFrame variant="modal" {...props} />, document.body);
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export type DrawerProps = {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
};

// Right-hand panel on tablets and desktops, full screen on phones.
export function Drawer({ open, ...props }: DrawerProps) {
  const isClient = useIsClient();
  if (!open || !isClient) return null;
  return createPortal(<DialogFrame variant="drawer" {...props} />, document.body);
}

// ── ConfirmDialog ────────────────────────────────────────────────────────────

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  // When set, the confirm button stays disabled until this exact text is typed.
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  const isClient = useIsClient();
  if (!open || !isClient) return null;
  return createPortal(<ConfirmDialogContent {...props} />, document.body);
}

function ConfirmDialogContent({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  requireText,
  busy = false,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, "open">) {
  const [typed, setTyped] = useState("");
  const formId = useId();
  const inputId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textMatches = !requireText || typed.trim() === requireText;
  const canConfirm = !busy && textMatches;
  const initialFocusRef = requireText ? inputRef : tone === "danger" ? cancelRef : confirmRef;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConfirm) void onConfirm();
  }

  return (
    <DialogFrame
      variant="modal"
      size="sm"
      role="alertdialog"
      title={title}
      description={message}
      onClose={onCancel}
      dismissible={!busy}
      initialFocusRef={initialFocusRef}
      className="adm-confirm"
      icon={
        <span className="adm-confirm-icon" data-tone={tone} aria-hidden="true">
          {tone === "danger" ? <IconWarning className="adm-icon" /> : <IconInfo className="adm-icon" />}
        </span>
      }
      footer={
        <>
          <button ref={cancelRef} type="button" className="adm-btn adm-btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type={requireText ? "submit" : "button"}
            form={requireText ? formId : undefined}
            onClick={
              requireText
                ? undefined
                : () => {
                    if (canConfirm) void onConfirm();
                  }
            }
            className={cx("adm-btn", tone === "danger" ? "adm-btn-danger" : "adm-btn-primary")}
            disabled={!canConfirm}
            aria-busy={busy || undefined}
          >
            {busy ? <Spinner size="sm" /> : null}
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {requireText ? (
        <form method="post" id={formId} className="adm-confirm-body" onSubmit={handleSubmit} noValidate>
          <div className="adm-field">
            <label htmlFor={inputId} className="adm-label">
              Type <strong className="adm-kbd">{requireText}</strong> to confirm
            </label>
            <input
              ref={inputRef}
              id={inputId}
              className="adm-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
            />
          </div>
        </form>
      ) : null}
    </DialogFrame>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

export type BadgeTone =
  | "blue"
  | "amber"
  | "purple"
  | "indigo"
  | "teal"
  | "green"
  | "red"
  | "rose"
  | "slate"
  | "gray"
  | "sky";

export function Badge({ tone = "slate", dot = false, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx("adm-badge", className)} data-tone={tone}>
      {dot ? <span className="adm-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const APPLICATION_STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  submitted: "blue",
  under_review: "amber",
  shortlisted: "purple",
  interview: "indigo",
  selected: "green",
  rejected: "red",
  withdrawn: "slate",
};

export function applicationStatusTone(status: ApplicationStatus): BadgeTone {
  return APPLICATION_STATUS_TONES[status] ?? "slate";
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <Badge tone={applicationStatusTone(status)} dot>
      {APPLICATION_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

const JOB_STATUS_TONES: Record<JobStatus, BadgeTone> = {
  draft: "amber",
  published: "green",
  closed: "slate",
  archived: "gray",
};

// isOpen (from AdminJob) marks published jobs whose deadline has passed as "Expired".
export function JobStatusBadge({ status, isOpen }: { status: JobStatus; isOpen?: boolean }) {
  const expired = status === "published" && isOpen === false;
  return (
    <span className="adm-badge-group">
      <Badge tone={JOB_STATUS_TONES[status] ?? "slate"}>{JOB_STATUS_LABELS[status] ?? status}</Badge>
      {expired ? (
        <Badge tone="rose" className="adm-badge-expired">
          Expired
        </Badge>
      ) : null}
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "subtle" | "link";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  busy?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "secondary", size = "md", busy = false, icon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx("adm-btn", `adm-btn-${variant}`, size === "sm" && "adm-btn-sm", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
  tone?: "default" | "danger";
};

export function IconButton({ label, icon, tone = "default", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} className={cx("adm-icon-btn", className)} data-tone={tone} aria-label={label} title={label}>
      {icon}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", copiedLabel = "Copied" }: { text: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
      setCopied(false);
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2500);
  }

  return (
    <button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={() => void handleCopy()}>
      {copied ? <IconCheck className="adm-icon" /> : <IconClipboard className="adm-icon" />}
      <span aria-live="polite">{copied ? copiedLabel : failed ? "Copy failed — select and copy manually" : label}</span>
    </button>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export function Spinner({ size = "md", label }: { size?: "sm" | "md" | "lg"; label?: string }) {
  if (label) {
    return (
      <span className="adm-spinner-wrap" role="status">
        <span className="adm-spinner" data-size={size} aria-hidden="true" />
        <span className="adm-sr-only">{label}</span>
      </span>
    );
  }
  return <span className="adm-spinner" data-size={size} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 3, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div className="adm-skeleton-list" role="status" aria-live="polite">
      <span className="adm-sr-only">{label}</span>
      {Array.from({ length: Math.max(1, rows) }, (_, index) => (
        <div key={index} className="adm-skeleton-row" aria-hidden="true">
          <span className="adm-skeleton adm-skeleton-avatar" />
          <span className="adm-skeleton-lines">
            <span className="adm-skeleton adm-skeleton-line" data-width="wide" />
            <span className="adm-skeleton adm-skeleton-line" data-width="narrow" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="adm-empty">
      {icon ? (
        <span className="adm-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="adm-empty-title">{title}</p>
      {description ? <p className="adm-empty-description">{description}</p> : null}
      {action ? <div className="adm-empty-action">{action}</div> : null}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function ErrorBanner({ error, onRetry, title }: { error: Error | string | null | undefined; onRetry?: () => void; title?: string }) {
  if (!error) return null;
  return (
    <div className="adm-error-banner" role="alert">
      <IconWarning className="adm-icon adm-error-banner-icon" />
      <div className="adm-error-banner-text">
        {title ? <p className="adm-error-banner-title">{title}</p> : null}
        <p className="adm-error-banner-message">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <button type="button" className="adm-btn adm-btn-secondary adm-btn-sm" onClick={onRetry}>
          <IconRefresh className="adm-icon" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "success"; children: ReactNode }) {
  return (
    <div className="adm-notice" data-tone={tone}>
      {tone === "warning" ? <IconWarning className="adm-icon" /> : tone === "success" ? <IconCheckCircle className="adm-icon" /> : <IconInfo className="adm-icon" />}
      <div className="adm-notice-text">{children}</div>
    </div>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

export function Pagination({
  page,
  pageCount,
  total,
  onPage,
  disabled = false,
  itemLabel = ["result", "results"],
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
  itemLabel?: [string, string];
}) {
  const pages = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), pages);
  return (
    <nav className="adm-pagination" aria-label="Pagination">
      <p className="adm-pagination-info">
        {pluralize(total, itemLabel[0], itemLabel[1])}
        {pages > 1 ? ` · Page ${current} of ${pages}` : null}
      </p>
      {pages > 1 || page > pages ? (
        <div className="adm-pagination-controls">
          <button
            type="button"
            className="adm-btn adm-btn-secondary adm-btn-sm"
            onClick={() => onPage(Math.min(page - 1, pages))}
            disabled={disabled || page <= 1}
          >
            <IconChevronLeft className="adm-icon" />
            Previous
          </button>
          <button
            type="button"
            className="adm-btn adm-btn-secondary adm-btn-sm"
            onClick={() => onPage(page + 1)}
            disabled={disabled || page >= pages}
          >
            Next
            <IconChevronRight className="adm-icon" />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: ReactNode };
export type ToastOptions = { durationMs?: number };

export type ToastApi = {
  success: (message: ReactNode, options?: ToastOptions) => void;
  error: (message: ReactNode, options?: ToastOptions) => void;
  info: (message: ReactNode, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, number>());
  const nextIdRef = useRef(1);
  const isClient = useIsClient();

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: ReactNode, options?: ToastOptions) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setToasts((list) => [...list, { id, tone, message }].slice(-MAX_TOASTS));
      const duration = options?.durationMs ?? (tone === "error" ? 10000 : 5000);
      timersRef.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration)
      );
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
    }),
    [push]
  );

  const renderToast = (toast: ToastItem) => (
    <div key={toast.id} className="adm-toast" data-tone={toast.tone}>
      {toast.tone === "error" ? (
        <IconWarning className="adm-icon adm-toast-icon" />
      ) : toast.tone === "success" ? (
        <IconCheckCircle className="adm-icon adm-toast-icon" />
      ) : (
        <IconInfo className="adm-icon adm-toast-icon" />
      )}
      <div className="adm-toast-message">{toast.message}</div>
      <button type="button" className="adm-icon-btn adm-toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
        <IconClose className="adm-icon" strokeWidth={2.5} />
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {isClient
        ? createPortal(
            <div className="adm-portal adm-toasts" data-admin-toasts="">
              <div role="status" aria-live="polite" className="adm-toast-stack">
                {toasts.filter((toast) => toast.tone !== "error").map(renderToast)}
              </div>
              <div role="alert" aria-live="assertive" className="adm-toast-stack">
                {toasts.filter((toast) => toast.tone === "error").map(renderToast)}
              </div>
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

// ── Form fields ──────────────────────────────────────────────────────────────

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="adm-field-error">
      {message}
    </p>
  );
}

type FieldChromeProps = {
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  hideLabel?: boolean;
  // Shows "length / maxLength" under the control (requires value and maxLength).
  counter?: boolean;
  className?: string;
};

function describedByIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

function FieldLabel({ htmlFor, label, optional, hideLabel }: { htmlFor: string; label: ReactNode; optional?: boolean; hideLabel?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={cx("adm-label", hideLabel && "adm-sr-only")}>
      {label}
      {optional ? <span className="adm-label-optional"> (optional)</span> : null}
    </label>
  );
}

function FieldFooter({
  hintId,
  hint,
  counterId,
  length,
  maxLength,
  errorId,
  error,
}: {
  hintId: string;
  hint?: ReactNode;
  counterId: string;
  length: number | null;
  maxLength?: number;
  errorId: string;
  error?: string | null;
}) {
  const showCounter = length !== null && maxLength !== undefined;
  return (
    <>
      {hint || showCounter ? (
        <div className="adm-field-footer">
          {hint ? (
            <div id={hintId} className="adm-hint">
              {hint}
            </div>
          ) : (
            <span />
          )}
          {showCounter ? (
            <span id={counterId} className={cx("adm-counter", length > maxLength && "is-over")}>
              {length.toLocaleString("en-GB")} / {maxLength.toLocaleString("en-GB")}
            </span>
          ) : null}
        </div>
      ) : null}
      <FieldError id={errorId} message={error} />
    </>
  );
}

function valueLength(value: unknown): number | null {
  return typeof value === "string" ? value.length : null;
}

export type TextFieldProps = FieldChromeProps & Omit<ComponentProps<"input">, "className">;

export function TextField({ label, error, hint, optional, hideLabel, counter, className, id, ...inputProps }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const counterId = `${fieldId}-counter`;
  const errorId = `${fieldId}-error`;
  const length = counter ? valueLength(inputProps.value) : null;
  const maxLength = counter ? inputProps.maxLength : undefined;
  return (
    <div className={cx("adm-field", className)}>
      <FieldLabel htmlFor={fieldId} label={label} optional={optional} hideLabel={hideLabel} />
      <input
        {...inputProps}
        id={fieldId}
        className="adm-input"
        aria-invalid={error ? true : inputProps["aria-invalid"]}
        aria-describedby={describedByIds(
          inputProps["aria-describedby"],
          hint ? hintId : null,
          length !== null && maxLength !== undefined && counterId,
          error && errorId
        )}
      />
      <FieldFooter hintId={hintId} hint={hint} counterId={counterId} length={length} maxLength={maxLength} errorId={errorId} error={error} />
    </div>
  );
}

export type TextAreaFieldProps = FieldChromeProps & Omit<ComponentProps<"textarea">, "className">;

export function TextAreaField({ label, error, hint, optional, hideLabel, counter, className, id, rows = 4, ...textareaProps }: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const counterId = `${fieldId}-counter`;
  const errorId = `${fieldId}-error`;
  const length = counter ? valueLength(textareaProps.value) : null;
  const maxLength = counter ? textareaProps.maxLength : undefined;
  return (
    <div className={cx("adm-field", className)}>
      <FieldLabel htmlFor={fieldId} label={label} optional={optional} hideLabel={hideLabel} />
      <textarea
        {...textareaProps}
        id={fieldId}
        rows={rows}
        className="adm-input adm-textarea"
        aria-invalid={error ? true : textareaProps["aria-invalid"]}
        aria-describedby={describedByIds(
          textareaProps["aria-describedby"],
          hint ? hintId : null,
          length !== null && maxLength !== undefined && counterId,
          error && errorId
        )}
      />
      <FieldFooter hintId={hintId} hint={hint} counterId={counterId} length={length} maxLength={maxLength} errorId={errorId} error={error} />
    </div>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectFieldProps = Omit<FieldChromeProps, "counter"> &
  Omit<ComponentProps<"select">, "className"> & {
    options?: readonly SelectOption[];
    // Adds a first option with an empty value.
    placeholder?: string;
  };

export function SelectField({ label, error, hint, optional, hideLabel, className, id, options, placeholder, children, ...selectProps }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx("adm-field", className)}>
      <FieldLabel htmlFor={fieldId} label={label} optional={optional} hideLabel={hideLabel} />
      <select
        {...selectProps}
        id={fieldId}
        className="adm-input adm-select"
        aria-invalid={error ? true : selectProps["aria-invalid"]}
        aria-describedby={describedByIds(selectProps["aria-describedby"], hint ? hintId : null, error && errorId)}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <FieldFooter hintId={hintId} hint={hint} counterId="" length={null} errorId={errorId} error={error} />
    </div>
  );
}

export type CheckboxFieldProps = Omit<ComponentProps<"input">, "className" | "type"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
};

export function CheckboxField({ label, hint, error, className, id, ...inputProps }: CheckboxFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx("adm-field adm-checkbox-field", className)}>
      <div className="adm-checkbox">
        <input
          {...inputProps}
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : inputProps["aria-invalid"]}
          aria-describedby={describedByIds(inputProps["aria-describedby"], hint ? hintId : null, error && errorId)}
        />
        <label htmlFor={fieldId} className="adm-checkbox-label">
          {label}
        </label>
      </div>
      {hint ? (
        <div id={hintId} className="adm-hint adm-checkbox-hint">
          {hint}
        </div>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  hideLabel?: boolean;
  // Delay before onChange fires while typing; 0 reports every keystroke.
  debounceMs?: number;
  id?: string;
  className?: string;
  disabled?: boolean;
};

export function SearchInput({ value, onChange, placeholder, label, hideLabel = false, debounceMs = 0, id, className, disabled }: SearchInputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const [lastEmitted, setLastEmitted] = useState(value);
  const timerRef = useRef<number | null>(null);

  // Adopt values set by the parent (e.g. "Clear filters") without clobbering text the user is
  // still typing, whose debounced value has not been reported yet.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value !== lastEmitted) {
      setDraft(value);
      setLastEmitted(value);
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function emit(next: string) {
    setLastEmitted(next);
    onChange(next);
  }

  function handleChange(next: string) {
    setDraft(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (debounceMs <= 0 || next === "") {
      timerRef.current = null;
      emit(next);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      emit(next);
    }, debounceMs);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (draft !== lastEmitted) emit(draft);
    }
  }

  return (
    <div className={cx("adm-field adm-search-field", className)}>
      <label htmlFor={fieldId} className={cx("adm-label", hideLabel && "adm-sr-only")}>
        {label}
      </label>
      <div className="adm-search">
        <IconSearch className="adm-icon adm-search-icon" />
        <input
          id={fieldId}
          type="search"
          className="adm-input adm-search-input"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={FIELD_LIMITS.searchQuery}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ── TagInput ─────────────────────────────────────────────────────────────────

export type TagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  id?: string;
};

// Tags are normalized exactly like the server does (lowercase, trimmed, unique, limited).
export function TagInput({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  label = "Tags",
  hint = "Press Enter or comma to add a tag.",
  error,
  placeholder = "Add a tag",
  id,
}: TagInputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-suggestions`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const shownError = error ?? problem;
  const available = suggestions.filter((tag) => !value.includes(tag.toLowerCase()));

  function commit(raw: string): void {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setDraft("");
      return;
    }
    const errors: FieldErrors = {};
    const next = normalizeTags([...value, ...parts], errors, "tags");
    if (errors.tags) {
      setProblem(errors.tags);
      return;
    }
    setProblem(null);
    setDraft("");
    if (next.length !== value.length || next.some((tag, index) => tag !== value[index])) onChange(next);
  }

  function remove(tag: string): void {
    setProblem(null);
    onChange(value.filter((item) => item !== tag));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      remove(value[value.length - 1]);
    } else if (event.key === "Escape" && draft !== "") {
      // Clear the draft instead of closing the surrounding dialog.
      event.preventDefault();
      setDraft("");
      setProblem(null);
    }
  }

  return (
    <div className="adm-field">
      <label htmlFor={fieldId} className="adm-label">
        {label}
      </label>
      <div className={cx("adm-tag-input", shownError && "is-invalid", disabled && "is-disabled")}>
        {value.length > 0 ? (
          <ul className="adm-chips" aria-label={`Selected ${label.toLowerCase()}`}>
            {value.map((tag) => (
              <li key={tag} className="adm-chip">
                <span>{tag}</span>
                <button type="button" className="adm-chip-remove" onClick={() => remove(tag)} disabled={disabled} aria-label={`Remove ${tag}`}>
                  <IconClose className="adm-icon" strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          id={fieldId}
          className="adm-tag-input-control"
          value={draft}
          onChange={(event) => {
            setProblem(null);
            const next = event.target.value;
            // Pasted "a, b, c" (or a datalist pick followed by a comma) is split right away.
            if (next.includes(",")) commit(next);
            else setDraft(next);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          placeholder={value.length >= FIELD_LIMITS.tags ? "" : placeholder}
          list={available.length > 0 ? listId : undefined}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedByIds(hint ? hintId : null, shownError && errorId)}
        />
        {available.length > 0 ? (
          <datalist id={listId}>
            {available.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        ) : null}
      </div>
      {hint ? (
        <div id={hintId} className="adm-hint">
          {hint}
        </div>
      ) : null}
      <FieldError id={errorId} message={shownError} />
    </div>
  );
}
