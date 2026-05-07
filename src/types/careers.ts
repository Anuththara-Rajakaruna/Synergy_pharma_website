export type JobType = "Full-time" | "Internship";

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
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
  createdAt: string;
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
};
