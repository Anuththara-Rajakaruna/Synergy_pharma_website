import type { JobInput } from "@/lib/careers/validation";

// The current open positions, in the shape the careers store takes (JobInput, minus the deadline,
// which none of these has) plus the fields the static careers pages use. The careers pages read
// them through src/lib/careers/static-jobs.ts; the local emulator also publishes them on first
// start (see bootstrapLocalData in src/lib/google/local-emulator.ts). For a real spreadsheet,
// create the same postings from the admin panel at /careers/admin, using these values.
//
// Field mapping, because the Job model has no dedicated fields for some of this:
//   slug            the job's id and URL: /careers/<slug>
//   type            the employment type
//   benefits        the "Why Join Us" points
//   experience      the years of experience, shown on the job card and the detail page
//   qualifications  the qualifications exactly as advertised
//   requirements    the experience requirement; the store will not publish a job without one
//   summary         one short sentence for the job card; no phone number, it must end naturally
//   description     the overview shown on the detail page, in full
//   contactPhone    shown on the detail page only
//   applyEmail      where the detail page sends applications (mailto)

export type OpenPosition = Omit<JobInput, "applicationDeadline"> & {
  summary: string;
  contactPhone: string;
  applyEmail: string;
};

const LOCATION = "Bingiriya BOI Export Processing Zone, Dummalasuriya, Sri Lanka";
const APPLY_EMAIL = "careers@synergypharma.lk";

const WHY_JOIN_US = [
  "Work with a reputed and growing pharmaceutical company.",
  "Dynamic work environment with career growth opportunities.",
  "Competitive salary and benefits.",
];

function summary(title: string, department: string): string {
  return `Synergy Pharmaceutical Corporation is hiring a ${title} for the ${department}.`;
}

function description(title: string, department: string): string {
  return `${summary(title, department)} The role is a full-time position based at ${LOCATION}.`;
}

export const OPEN_POSITIONS: readonly OpenPosition[] = [
  {
    slug: "junior-executive-analytical",
    title: "Junior Executive",
    department: "Analytical Department",
    location: LOCATION,
    type: "Full-time",
    experience: "2–4 years",
    summary: summary("Junior Executive", "Analytical Department"),
    description: description("Junior Executive", "Analytical Department"),
    contactPhone: "077 80 88 282",
    applyEmail: APPLY_EMAIL,
    responsibilities: [
      "Experienced in oral solid dosage forms.",
      "Carry out routine analytical testing, assist in analytical method development and validation, prepare laboratory solutions and documentation, and operate analytical instruments in accordance with approved procedures.",
      "Support formulation development, stability studies, technology transfer, and laboratory investigations while ensuring compliance with GMP, GLP, data integrity (ALCOA+), ICH guidelines, and pharmacopeial standards (USP, BP, EP).",
      "Maintain accurate records, assist in laboratory housekeeping and instrument maintenance, and work closely with senior team members to ensure timely completion of analytical development activities and product development projects.",
      "Knowledge of preparation of STP/SPEC/Protocols.",
    ],
    requirements: ["2–4 years of experience in Pharmaceutical Analytical Development"],
    qualifications: [
      "B.Pharm / M.Sc or B.Sc in Analytical Chemistry, or equivalent",
      "2–4 years of experience in Pharmaceutical Analytical Development",
    ],
    benefits: WHY_JOIN_US,
  },
  {
    slug: "sr-executive-analytical",
    title: "Sr. Executive",
    department: "Analytical Department",
    location: LOCATION,
    type: "Full-time",
    experience: "4–7 years",
    summary: summary("Sr. Executive", "Analytical Department"),
    description: description("Sr. Executive", "Analytical Department"),
    contactPhone: "077 80 88 282",
    applyEmail: APPLY_EMAIL,
    responsibilities: [
      "Experienced in oral solid dosage forms.",
      "Perform analytical method development, method verification and routine analytical testing for APIs, excipients, intermediates, and finished pharmaceutical products.",
      "Support formulation development, stability studies, technology transfer, and investigation of OOS/OOT results.",
      "Ensure compliance with GMP, GLP, ICH guidelines, and pharmacopeial standards (USP, BP, EP).",
      "Prepare and review analytical documentation, operate and troubleshoot laboratory instruments, maintain data integrity, and collaborate with cross-functional teams to ensure timely completion of product development projects and regulatory compliance.",
      "Knowledge of preparation and review of STP/SPEC/Protocols.",
    ],
    requirements: ["4–7 years of experience in Pharmaceutical Analytical Development"],
    qualifications: [
      "M.Pharm / B.Pharm (Pharmaceutical Analysis / Pharmaceutics), M.Sc. Analytical Chemistry, or equivalent",
      "4–7 years of experience in Pharmaceutical Analytical Development",
    ],
    benefits: WHY_JOIN_US,
  },
  {
    slug: "qc-senior-executive",
    title: "QC Senior Executive",
    department: "Quality Control Department",
    location: LOCATION,
    type: "Full-time",
    experience: "4–6 years",
    summary: summary("QC Senior Executive", "Quality Control Department"),
    description: description("QC Senior Executive", "Quality Control Department"),
    contactPhone: "+94 70 117 7809 / 074 251 3160",
    applyEmail: APPLY_EMAIL,
    responsibilities: [
      "Perform analytical method development, validation, verification and method transfer activities.",
      "Prepare and review AMV protocols, reports, SOPs, STPs, and specifications as per regulatory guidelines.",
      "Handle laboratory instruments, including operation, calibration, and troubleshooting of HPLC, GC and other laboratory instruments.",
    ],
    requirements: ["4–6 years of relevant industry experience"],
    qualifications: ["Bachelor's Degree (BSc) in Chemistry", "4–6 years of relevant industry experience"],
    benefits: WHY_JOIN_US,
  },
  {
    slug: "qc-executive",
    title: "QC Executive",
    department: "Quality Control Department",
    location: LOCATION,
    type: "Full-time",
    experience: "3–5 years",
    summary: summary("QC Executive", "Quality Control Department"),
    description: description("QC Executive", "Quality Control Department"),
    contactPhone: "+94 70 117 7809 / 074 251 3160",
    applyEmail: APPLY_EMAIL,
    responsibilities: [
      "Sampling and testing of RM and PM.",
      "Perform wet analysis of raw materials and packaging materials as per approved specifications and test procedures.",
      "Handle laboratory instruments, including operation and calibration of HPLC, GC and other laboratory instruments.",
      "Handle IPFP, hold time and PV samples.",
      "Handle stability analysis.",
      "Calibration and preventive maintenance of QC instruments and equipment.",
      "Working standards / reference standards management.",
      "Lab compliance.",
      "Documentation: SOP, STP, specification, protocols and ARDS preparation.",
    ],
    requirements: ["3–5 years of relevant industry experience"],
    qualifications: ["Bachelor's Degree (BSc) in Chemistry", "3–5 years of relevant industry experience"],
    benefits: WHY_JOIN_US,
  },
];
