export type JobType = "Full-time" | "Internship";

export type ApplicantStatus =
  // Full pipeline stages
  | "applied"
  | "phone_screen"
  | "interview"
  | "offer"
  | "hired"
  | "rejected"
  // Legacy values — kept for backward compatibility with existing records
  | "pending"
  | "reviewed"
  | "shortlisted";

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredRequirements?: string[];
  salary?: string;
  closingDate?: string;
};

export type ApplicationRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  jobId: string;
  coverLetter: string;
  cvFileName: string;
  cvFilePath: string;
  createdAt: string;
  status?: ApplicantStatus;
  notes?: string;
  interviewLink?: string;  // Calendly / Google Meet link sent to candidate
  source?: string;         // e.g. "direct" | "linkedin" | "referral" | "indeed"
};

export type TalentPoolRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  areaOfInterest: string;
  notes: string;
  cvFileName: string;
  cvFilePath: string;
  createdAt: string;
  status?: ApplicantStatus;
  adminNotes?: string;
  source?: string;
};

export type EmailTemplate = {
  name: string;        // e.g. "interview_invite"
  subject: string;
  body: string;        // Plain-text body with {{name}}, {{position}} placeholders
};
