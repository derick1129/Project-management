/**
 * Domain vocabularies. Stored as strings in the database (SQLite has no enum
 * type) but constrained here so the whole application shares one definition.
 */

export const ROLES = [
  "SUPER_ADMIN",
  "DIRECTOR",
  "ADMIN",
  "HOD",
  "FACULTY_MENTOR",
  "JUDGE",
  "STUDENT",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  DIRECTOR: "Director",
  ADMIN: "Admin",
  HOD: "HOD",
  FACULTY_MENTOR: "Faculty Mentor",
  JUDGE: "Judge",
  STUDENT: "Student",
};

/** Roles whose scope is the whole college. */
export const COLLEGE_WIDE_ROLES: Role[] = ["SUPER_ADMIN", "DIRECTOR", "ADMIN"];
/** Roles bound to a single department. */
export const DEPARTMENT_SCOPED_ROLES: Role[] = ["HOD"];

export const REGISTRATION_STATUS = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];

export const TEAM_STATUS = ["REGISTERED", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type TeamStatus = (typeof TEAM_STATUS)[number];

export const MEETING_STATUS = [
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "RESUBMISSION_REQUIRED",
] as const;
export type MeetingStatus = (typeof MEETING_STATUS)[number];

export const PRESENTATION_STATUS = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PresentationStatus = (typeof PRESENTATION_STATUS)[number];

export const MARKS_VISIBILITY = ["DRAFT", "SUBMITTED", "REVIEWED", "PUBLISHED"] as const;
export type MarksVisibility = (typeof MARKS_VISIBILITY)[number];

export const MEETING_FREQUENCY = ["WEEKLY", "BIWEEKLY", "CUSTOM"] as const;
export type MeetingFrequency = (typeof MEETING_FREQUENCY)[number];

export const ACCURACY_BANDS = ["GOOD", "WARNING", "POOR"] as const;
export type AccuracyBand = (typeof ACCURACY_BANDS)[number];

export const MAX_TEAM_SIZE = 4;
export const MINOR_PROJECT_TEAM_SIZE = 4;
export const DISCUSSION_MAX_CHARS = 240;

export const HEALTH_BANDS = [
  { min: 90, label: "Excellent", tone: "success" },
  { min: 75, label: "Healthy", tone: "info" },
  { min: 50, label: "Needs Attention", tone: "warning" },
  { min: 0, label: "At Risk", tone: "danger" },
] as const;

export function healthBand(score: number): { label: string; tone: string } {
  return HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1];
}
