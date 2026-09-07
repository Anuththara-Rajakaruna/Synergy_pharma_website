export type JobType = "Full-time" | "Internship";
export type JobStatus = "draft" | "published" | "closed";
export type ApplicationStatus = "new" | "reviewing" | "shortlisted" | "rejected" | "hired";

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
  status?: JobStatus;
  description: string;
  responsibilities: string[];
  requirements: string[];
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
  status: ApplicationStatus;
  notes: string;
  consentGiven: boolean;
  createdAt: string;
  linkedIn?: string;
  portfolio?: string;
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
  consentGiven: boolean;
  createdAt: string;
};
