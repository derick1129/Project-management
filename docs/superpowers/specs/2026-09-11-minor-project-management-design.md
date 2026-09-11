# College Minor Project Management System — Design Specification

**Date:** 2026-09-11  
**Status:** Approved for Implementation Planning  
**Target:** Customization of Existing Next.js / Prisma Project Intelligence Platform for College Minor Projects

---

## 1. Overview & Objectives

This specification outlines the adaptation of the existing project platform into a specialized **College Minor Project Management and Weekly Logging System**.

The system facilitates:
1. **Role-Based Workflows:** Mentors (teachers) log sessions; Admins (HODs, Coordinators, Directors) oversee department-level compliance and analytics; Students view attendance and project milestones.
2. **Strict Minor Project Composition:** Every minor project consists of **exactly 5 members**: 1 Faculty Mentor and **strictly 4 Students**.
3. **Direct Coordinator/HOD Team Assignment:** In addition to student self-registration, Project Coordinators and HODs can directly create a project team, bundle 4 students, and assign a mentor in a single streamlined action.
4. **GPS Photo Camera Weekly Logging:** Mentors capture weekly sessions using a live device camera with GPS coordinates, date, time (IST), anchor location, and mentor name stamped server-side directly into the photo (mimicking a GPS map camera app) alongside an attendance checklist (Present/Absent).
5. **Departmental Analytics Web Dashboard:** HODs and Admins track weekly meeting completion rates, student attendance, at-risk teams, and export compliance reports via the responsive web dashboard.
6. **Configurable Campus Geofence & Semester Schedules:** Campus GPS anchors and semester meeting schedules (weekly cadence, expected meeting count) are fully configurable through the Admin/HOD interface without hardcoded college references.

---

## 2. Requirements & Adjustments Matrix

| Area | Prior State in Codebase | Specified Adaptation |
| :--- | :--- | :--- |
| **Team Size** | Allowed up to 4 students (`MAX_TEAM_SIZE = 4`, permitting 1 to 4 students). | Enforce **strictly 4 students** (1 lead + 3 members, or 4 assigned students) for Minor Projects, ensuring 1 Mentor + 4 Students = 5 members. |
| **Mentor Assignment** | Only student lead self-registration with mentor selection followed by approval. | Add **Direct Coordinator / HOD Team Assignment** flow: Coordinators/HODs pick 1 Mentor + 4 Students, specify project details, and directly create an active team with an auto-generated Team ID. |
| **Advanced Modules (Major / Presentations)** | Present in codebase (Major projects, external judges, rubric marking schemes). | **Retained as-is** in the codebase as secondary capabilities; Minor Project weekly logging remains the primary operational focus. |
| **HOD / Admin Interface** | Responsive web dashboard and analytics pages (`/dashboard`, `/analytics`). | **Retained as responsive web dashboard** (optimized for desktop, tablet, and mobile browsers). |
| **Institution Branding & GPS Anchor** | Hardcoded references to "PIEMR" in watermark and branding; campus anchor defaulted to PIEMR coordinates. | Parameterize watermark and branding via environment variable / configuration (`NEXT_PUBLIC_INSTITUTION_NAME` / `COLLEGE_NAME`), allowing administrators to set custom campus GPS coordinates and semester meeting schedules via `/configuration`. |

---

## 3. Architecture & Data Flow

### 3.1 Strict 4-Student Rule Enforcement

* **Domain Constant:** `MINOR_PROJECT_STUDENT_COUNT = 4`.
* **Registration Validation (`src/lib/services/teams.ts`):**
  * When `projectType` is `MINOR`:
    * Number of students must be **exactly 4** (`input.members.length + 1 === 4`).
    * Rejects submissions with fewer or more than 4 students with a clear user message: `"Minor project teams must consist of exactly 4 students (1 team lead and 3 members)."`
  * When `projectType` is not `MINOR` (e.g. Major):
    * Defaults to `MAX_TEAM_SIZE` (up to 4 students).
* **Client-Side Registration Form (`src/app/(auth)/register/page.tsx`):**
  * Minor project registration mode requires filling all 3 additional member slots (so lead + 3 = 4).

### 3.2 Direct Coordinator / HOD Assignment Flow

* **Service Function (`src/lib/services/teams.ts`):**
  * `createAssignedTeam(principal: Principal, input: DirectAssignTeamInput)`
  * **Authorization:** Requires `team.write` or `team.approve` permission, scoped to the caller's department (HOD / Admin / Super Admin).
  * **Input:**
    * `projectTitle`: string
    * `projectDescription`: string
    * `departmentId`: string
    * `sectionId`: string | null
    * `semesterId`: string
    * `projectTypeId`: string (defaulting to MINOR)
    * `academicYearId`: string
    * `mentorUserId`: string (must be active faculty in the department)
    * `leadStudentId`: string
    * `memberStudentIds`: string[] (3 additional student profile IDs, total 4 students)
  * **Transaction Behavior:**
    1. Validates all 4 students belong to the department and hold no active team memberships.
    2. Validates mentor is an active faculty member in that department.
    3. Increments `TeamIdSequence(departmentId, academicYearId)` and assigns Team ID (e.g., `<DEPT>-<YEAR>-<NNN>`).
    4. Sets `registrationStatus: "APPROVED"`, `status: "ACTIVE"`, `approvedAt: now()`.
    5. Creates `TeamMember` rows for all 4 students (with `activeStudentKey` set to prevent double-booking).
    6. Emits `TimelineEvent` and dispatches notifications to the mentor and all 4 students.
* **UI Interface (`src/app/(app)/teams/assign/page.tsx`):**
  * Accessible from `/teams` via an "Assign Team" button for HODs and Admins.
  * Form components:
    * Select Department, Academic Year, Semester (pre-filtered).
    * Select Mentor from faculty dropdown with current mentee count shown.
    * Select 4 Students (1 designated as Lead) from unassigned student list or by enrollment number autocomplete.
    * Input Project Title and initial description.
    * Instant submission that creates an active team ready for weekly session logging.

### 3.3 GPS Watermark & Photo Evidence

* **Watermark Engine (`src/lib/evidence/watermark.ts`):**
  * Update branding label: replace hardcoded `"PIEMR · Official Project Meeting Evidence"` with:
    `"${institutionName} · Official Minor Project Session Evidence"`.
  * `institutionName` resolved from:
    1. Configured geofence anchor name (`facts.address` or `geofence.name`), OR
    2. Environment variable `NEXT_PUBLIC_INSTITUTION_NAME` / `COLLEGE_NAME`, OR
    3. Default `"College Project Platform"`.
* **Meeting Capture Flow:**
  * Remains fully mobile-friendly: GPS capture -> camera snapshot -> member attendance checklist (all 4 students listed) -> discussion note -> server-side watermark stamping -> permanent immutable storage.

### 3.4 Configuration: GPS Anchor & Semester Cadence

* `/configuration`:
  * **Campus Geofence:** Allows setting college-wide and department-level GPS anchors (Latitude, Longitude, Radius in meters, accuracy bands, and enforcement toggle).
  * **Semester Schedules:** Map Academic Year + Semester (e.g. Sem 5 or Sem 6) -> Project Type ("Minor Project") -> Expected weekly sessions (e.g. 12 or 14 weeks) -> Meeting Frequency ("WEEKLY") with 7-day cadence.

---

## 4. Verification & Testing

1. **Unit & Integration Tests (`tests/unit/`, `tests/integration/`):**
   * Verify that Minor Project registration rejects teams with 1, 2, or 3 students.
   * Verify that Minor Project registration accepts exactly 4 students.
   * Verify `createAssignedTeam` successfully creates an active team with 1 mentor and 4 students, assigns a sequential Team ID, and sets `activeStudentKey`.
   * Verify `stampEvidence` uses the configured institution/anchor name.
2. **End-to-End Verification:**
   * Login as HOD/Coordinator -> Navigate to `/teams` -> Click "Assign Team" -> Select 1 Mentor and 4 Students -> Verify team is created with status ACTIVE and Team ID issued.
   * Login as Faculty Mentor -> Open `/meetings/record/[teamId]` -> Verify all 4 students are listed for attendance -> Verify camera & GPS stamping.
   * Login as HOD -> Check `/analytics` -> Verify weekly session metrics and attendance reflect the newly logged session.
