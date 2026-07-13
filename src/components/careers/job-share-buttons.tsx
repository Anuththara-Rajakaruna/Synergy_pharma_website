"use client";

import { useState } from "react";

type JobShareButtonsProps = {
  title: string;
  url: string;
};

export function JobShareButtons({ title, url }: JobShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(`${title} — Synergy Pharmaceuticals`);

  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="job-share-row">
      <span className="job-share-label">Share this role</span>
      <div className="job-share-buttons">
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="job-share-btn job-share-linkedin"
          aria-label="Share on LinkedIn"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
            <path d="M6.94 8.5A1.56 1.56 0 1 1 6.93 5.4a1.56 1.56 0 0 1 0 3.12ZM5.6 9.7h2.67V18H5.6V9.7Zm4.34 0h2.56v1.13h.04c.36-.68 1.23-1.4 2.52-1.4 2.69 0 3.19 1.77 3.19 4.07V18h-2.67v-4.02c0-.96-.02-2.2-1.34-2.2-1.34 0-1.54 1.05-1.54 2.13V18H9.94V9.7Z" />
          </svg>
          LinkedIn
        </a>

        <a
          href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="job-share-btn job-share-whatsapp"
          aria-label="Share on WhatsApp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.424A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2Zm5.093 13.953c-.213.598-1.244 1.14-1.713 1.213-.468.073-.905.347-3.062-.638-2.6-1.178-4.264-3.8-4.393-3.977-.129-.177-1.05-1.396-1.05-2.662 0-1.266.664-1.888.9-2.145.235-.257.514-.322.685-.322.171 0 .342.002.493.009.158.007.37-.06.579.442.213.515.723 1.781.787 1.91.064.129.107.28.021.45-.086.17-.128.276-.257.425-.128.149-.27.333-.385.447-.129.129-.263.268-.113.526.15.257.666 1.098 1.428 1.779.981.875 1.808 1.145 2.065 1.274.257.128.406.107.556-.064.15-.171.642-.749.812-1.006.17-.257.34-.214.577-.128.236.085 1.499.707 1.756.836.257.128.428.192.492.3.064.106.064.612-.149 1.21Z" />
          </svg>
          WhatsApp
        </a>

        <a
          href={`mailto:?subject=${encodedText}&body=I thought you might be interested in this role at Synergy Pharmaceuticals:%0A%0A${encodedUrl}`}
          className="job-share-btn job-share-email"
          aria-label="Share via email"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Email
        </a>

        <button
          type="button"
          className="job-share-btn job-share-copy"
          onClick={handleCopy}
          aria-label="Copy link"
        >
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
