# College Minor Project Management Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the existing project management platform into a specialized College Minor Project Management System enforcing a strict 5-member team structure (1 mentor + 4 students), adding a direct coordinator/HOD team assignment flow, parameterizing institution branding and GPS stamps, and validating weekly session logging and department analytics.

**Architecture:** Next.js 15 App Router + React 19 + TypeScript + Prisma ORM + Sharp watermark stamping. All core invariants (team size of 4 students, single active team membership, mentor department affiliation, sequential Team ID assignment) are enforced in atomic database transactions within `src/lib/services/`.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Tailwind CSS 4, Prisma (SQLite / PostgreSQL-ready), Sharp, Vitest, Playwright.

## Global Constraints

- Minor project teams must strictly have 4 students (1 lead + 3 members) and 1 faculty mentor (total 5 members).
- Direct team assignment by HOD / Coordinator requires `team.write` or `team.approve` role permissions.
- Watermark evidence stamping must dynamically resolve institution name and not hardcode "PIEMR".
- All database mutations must happen via the service layer inside atomic transactions.
- Zero regression on existing RBAC, meeting capture, or analytics rollups.

---

### Task 1: Strict 4-Student Rule for Minor Projects

**Files:**
- Modify: `src/lib/domain/constants.ts`
- Modify: `src/lib/services/teams.ts`
- Modify: `src/app/(auth)/register/actions.ts`
- Modify: `src/app/(auth)/register/register-form.tsx`
- Test: `tests/integration/teams.test.ts`

**Interfaces:**
- Consumes: `ProjectType` from DB, `RegisterTeamInput` from `src/lib/services/teams.ts`.
- Produces: `MINOR_PROJECT_TEAM_SIZE = 4` constant in `src/lib/domain/constants.ts`; rejection in `registerTeam` if project type is `MINOR` and student count !== 4.

- [ ] **Step 1: Write integration tests for Minor Project 4-student constraint**

In `tests/integration/teams.test.ts`, add test cases in `describe("registerTeam")`:
```ts
it("refuses a minor project team with fewer than 4 students", async () => {
  const mentor = await makeMentor();
  const lead = await makeLead();
  const member1 = await makeLead();

  await expect(
    registerTeam(lead, {
      projectTitle: "Understaffed Minor Project",
      projectDescription: "A sufficiently long description of the project.",
      departmentId: env.department.id,
      sectionId: env.section.id,
      semesterId: env.semester.id,
      projectTypeId: env.minor.id,
      academicYearId: env.academicYear.id,
      mentorUserId: mentor.userId,
      leadStudentProfileId: lead.studentProfileId!,
      members: [
        {
          name: "Member 1",
          enrollmentNo: `MEM-${lead.userId}-1`,
          email: `mem1-${lead.userId}@test.local`,
        },
      ],
    }),
  ).rejects.toThrow("Minor project teams must consist of exactly 4 students");
});

it("accepts a minor project team with exactly 4 students (1 lead + 3 members)", async () => {
  const mentor = await makeMentor();
  const lead = await makeLead();
  const members = await Promise.all([makeLead(), makeLead(), makeLead()]);

  const team = await registerTeam(lead, {
    projectTitle: "Valid Minor Project Team",
    projectDescription: "A sufficiently long description of the project.",
    departmentId: env.department.id,
    sectionId: env.section.id,
    semesterId: env.semester.id,
    projectTypeId: env.minor.id,
    academicYearId: env.academicYear.id,
    mentorUserId: mentor.userId,
    leadStudentProfileId: lead.studentProfileId!,
    members: members.map((m, i) => ({
      name: `Member ${i + 2}`,
      enrollmentNo: `MEM-VAL-${lead.userId}-${i}`,
      email: `memval${i}-${lead.userId}@test.local`,
    })),
  });

  expect(team.registrationStatus).toBe("SUBMITTED");
  const withMembers = await db.team.findUniqueOrThrow({
    where: { id: team.id },
    include: { members: true },
  });
  expect(withMembers.members).toHaveLength(4);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test tests/integration/teams.test.ts`  
Expected: FAIL on the "refuses a minor project team with fewer than 4 students" test.

- [ ] **Step 3: Implement constraint in `constants.ts`, `teams.ts`, and `register/actions.ts`**

In `src/lib/domain/constants.ts`:
```ts
export const MINOR_PROJECT_TEAM_SIZE = 4;
```

In `src/lib/services/teams.ts` inside `registerTeam`:
```ts
const projectType = await db.projectType.findUnique({ where: { id: input.projectTypeId } });
const isMinor = projectType?.code === "MINOR";
const totalStudents = input.members.length + 1;

if (isMinor && totalStudents !== MINOR_PROJECT_TEAM_SIZE) {
  throw new DomainError(
    `Minor project teams must consist of exactly ${MINOR_PROJECT_TEAM_SIZE} students (1 team lead and ${MINOR_PROJECT_TEAM_SIZE - 1} members).`,
  );
}
if (totalStudents > MAX_TEAM_SIZE) {
  throw new DomainError(`A team may have at most ${MAX_TEAM_SIZE} students including the lead.`);
}
```

In `src/app/(auth)/register/actions.ts`:
Validate that if `projectTypeId` corresponds to `MINOR`, all 3 member slots must be provided and valid.

In `src/app/(auth)/register/register-form.tsx`:
Update dynamic helper text and `required` attributes when the selected or mapped project type is `MINOR`.

- [ ] **Step 4: Run integration tests to verify pass**

Run: `npm test tests/integration/teams.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/lib/domain/constants.ts src/lib/services/teams.ts src/app/(auth)/register/ tests/integration/teams.test.ts
git commit -m "feat: enforce strict 4-student rule for minor project teams"
```

---

### Task 2: Direct Coordinator / HOD Team Assignment Service

**Files:**
- Modify: `src/lib/services/teams.ts`
- Test: `tests/integration/teams.test.ts`

**Interfaces:**
- Consumes: `Principal` from `src/lib/auth/rbac`, `DirectAssignTeamInput`.
- Produces: `assignMinorProjectTeam(principal: Principal, input: DirectAssignTeamInput): Promise<Team>`.

- [ ] **Step 1: Write integration tests for `assignMinorProjectTeam`**

In `tests/integration/teams.test.ts`, add describe block `describe("assignMinorProjectTeam")`:
```ts
describe("assignMinorProjectTeam", () => {
  it("allows HOD to directly create and activate an approved team with 1 mentor and 4 students", async () => {
    const hod = await makeUser({
      roles: [{ role: "HOD", departmentId: env.department.id }],
    });
    const mentor = await makeMentor();
    const lead = await makeLead();
    const memberStudents = await Promise.all([makeLead(), makeLead(), makeLead()]);

    const team = await assignMinorProjectTeam(hod, {
      projectTitle: "Directly Assigned Minor Project",
      projectDescription: "Project created directly by department coordinator or HOD.",
      departmentId: env.department.id,
      sectionId: env.section.id,
      semesterId: env.semester.id,
      projectTypeId: env.minor.id,
      academicYearId: env.academicYear.id,
      mentorUserId: mentor.userId,
      leadStudentProfileId: lead.studentProfileId!,
      memberStudentProfileIds: memberStudents.map((m) => m.studentProfileId!),
    });

    expect(team.registrationStatus).toBe("APPROVED");
    expect(team.status).toBe("ACTIVE");
    expect(team.teamId).toMatch(new RegExp(`^${env.department.code}-`));

    const members = await db.teamMember.findMany({ where: { teamId: team.id } });
    expect(members).toHaveLength(4);
    expect(members.filter((m) => m.isLead)).toHaveLength(1);
  });

  it("rejects assignment if students belong to another active team", async () => {
    // Attempt re-assignment of same students should throw DomainError
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test tests/integration/teams.test.ts`  
Expected: FAIL with `assignMinorProjectTeam is not defined`.

- [ ] **Step 3: Implement `assignMinorProjectTeam` in `src/lib/services/teams.ts`**

Implement `DirectAssignTeamInput` and `assignMinorProjectTeam`:
```ts
export interface DirectAssignTeamInput {
  projectTitle: string;
  projectDescription: string;
  departmentId: string;
  sectionId?: string | null;
  semesterId: string;
  projectTypeId: string;
  academicYearId: string;
  mentorUserId: string;
  leadStudentProfileId: string;
  memberStudentProfileIds: string[]; // exactly 3 student profile IDs
}

export async function assignMinorProjectTeam(principal: Principal, input: DirectAssignTeamInput) {
  assertDepartment(principal, input.departmentId, "team.write");

  const totalStudents = 1 + input.memberStudentProfileIds.length;
  if (totalStudents !== MINOR_PROJECT_TEAM_SIZE) {
    throw new DomainError(`Minor project teams must have exactly ${MINOR_PROJECT_TEAM_SIZE} students.`);
  }

  // Verify mentor exists in department
  // Verify all student profiles exist in department and have no active team
  // Execute Prisma transaction:
  // 1. Next sequence number from TeamIdSequence
  // 2. Format teamId: `${dept.code}-${seq}`
  // 3. Create Team (APPROVED, ACTIVE, approvedByUserId: principal.userId)
  // 4. Create 4 TeamMembers (lead: isLead=true, others: isLead=false, activeStudentKey set)
  // 5. Create TimelineEvent & notify mentor + students
  // 6. Record Audit
}
```

- [ ] **Step 4: Run integration tests to verify pass**

Run: `npm test tests/integration/teams.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/lib/services/teams.ts tests/integration/teams.test.ts
git commit -m "feat: implement assignMinorProjectTeam service for HODs and coordinators"
```

---

### Task 3: Coordinator / HOD Team Assignment UI (`/teams/assign`)

**Files:**
- Create: `src/app/(app)/teams/assign/page.tsx`
- Create: `src/app/(app)/teams/assign/assign-form.tsx`
- Create: `src/app/(app)/teams/assign/actions.ts`
- Modify: `src/app/(app)/teams/page.tsx`

**Interfaces:**
- Consumes: `assignMinorProjectTeam` service, `requirePrincipal`, `guard`.
- Produces: Server Action `assignTeamAction` and UI form at `/teams/assign`.

- [ ] **Step 1: Create Server Action `actions.ts`**

Create `src/app/(app)/teams/assign/actions.ts`:
- Define Zod schema for direct assignment (title, description, departmentId, semesterId, mentorUserId, leadStudentProfileId, memberStudentProfileIds).
- Call `assignMinorProjectTeam(principal, data)`.
- Revalidate `/teams` and return success or error state.

- [ ] **Step 2: Create `assign-form.tsx` Client Component**

Create `src/app/(app)/teams/assign/assign-form.tsx`:
- Dropdowns for Department, Academic Year, Semester.
- Mentor dropdown showing current active team count.
- Lead Student selector and 3 Member Student selectors with enrollment search / unassigned student filtering.
- Title and description inputs.
- Submit button with pending transition states.

- [ ] **Step 3: Create Server Component `page.tsx`**

Create `src/app/(app)/teams/assign/page.tsx`:
- Protect with `guard(principal, ["team.write"])`.
- Query active departments, faculty mentors, unassigned student profiles, semesters, academic years.
- Render `PageHeader` and `AssignTeamForm`.

- [ ] **Step 4: Add "Assign Team" button on `/teams` page**

In `src/app/(app)/teams/page.tsx`:
- For users with `team.write` permission (HODs / Admins), render a `ButtonLink` to `/teams/assign` alongside existing filters.

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`  
Expected: Clean with no type errors.

- [ ] **Step 6: Commit changes**

```bash
git add src/app/(app)/teams/assign/ src/app/(app)/teams/page.tsx
git commit -m "feat: add team assignment page for HODs and coordinators"
```

---

### Task 4: Parameterize Institution Branding & GPS Stamp

**Files:**
- Modify: `src/lib/evidence/watermark.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/watermark.test.ts`

**Interfaces:**
- Consumes: `COLLEGE_NAME` or `NEXT_PUBLIC_INSTITUTION_NAME` from environment or `facts.institutionName`.
- Produces: Dynamic header/footer text in stamped SVG overlay without hardcoded "PIEMR".

- [ ] **Step 1: Update unit test for watermark stamping**

In `tests/unit/watermark.test.ts`:
Add assertion verifying that custom institution name appears in the stamped watermark when provided in `facts` or env.

- [ ] **Step 2: Run watermark test to verify failure**

Run: `npm test tests/unit/watermark.test.ts`  
Expected: FAIL on institution name assertion.

- [ ] **Step 3: Update `watermark.ts` and environment**

In `src/lib/evidence/watermark.ts`:
- Add optional `institutionName?: string` to `StampFacts`.
- Replace hardcoded `"PIEMR · Official Project Meeting Evidence"` with:
```ts
const branding = facts.institutionName || process.env.NEXT_PUBLIC_COLLEGE_NAME || process.env.COLLEGE_NAME || "College Project Platform";
// In SVG:
`<text ...>${escapeXml(branding)} · Official Project Meeting Evidence</text>`
```

In `src/lib/env.ts` & `.env.example`:
- Add optional `COLLEGE_NAME` / `NEXT_PUBLIC_COLLEGE_NAME`.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test tests/unit/watermark.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/lib/evidence/watermark.ts src/lib/env.ts .env.example tests/unit/watermark.test.ts
git commit -m "feat: make watermark branding and college name configurable"
```

---

### Task 5: End-to-End Verification of GPS, Semester Schedules & Analytics

**Files:**
- Verify: `src/app/(app)/configuration/`
- Verify: `src/app/(app)/meetings/record/[teamId]/`
- Verify: `src/app/(app)/analytics/`

- [ ] **Step 1: Verify geofence and semester configuration via existing forms**

- Ensure `/configuration` properly persists:
  - Campus anchor GPS (Latitude, Longitude, Radius in meters, accuracy threshold).
  - Academic configuration: Academic Year + Semester -> MINOR Project Type -> Weekly session cadence (12 sessions).

- [ ] **Step 2: Run full unit & integration test suite**

Run: `npm test`  
Expected: All 136+ unit and integration tests passing.

- [ ] **Step 3: Run build check**

Run: `npm run build`  
Expected: Build completes successfully with zero warnings/errors.

- [ ] **Step 4: Commit final verification notes**

```bash
git commit --allow-empty -m "chore: verify minor project system build and test suite"
```
