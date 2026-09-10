import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MAX_TEAM_SIZE, MINOR_PROJECT_TEAM_SIZE } from "@/lib/domain/constants";
import type { Principal } from "@/lib/auth/rbac";
import { AuthorizationError, assertDepartment, isCollegeWide } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/services/audit";
import { notify } from "@/lib/services/notifications";

export class DomainError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export interface MemberInput {
  name: string;
  enrollmentNo: string;
  email: string;
  phone?: string | null;
}

export interface RegisterTeamInput {
  projectTitle: string;
  projectDescription: string;
  departmentId: string;
  sectionId: string | null;
  semesterId: string;
  projectTypeId: string;
  academicYearId: string;
  mentorUserId: string;
  leadStudentProfileId: string;
  members: MemberInput[]; // members 2..4, lead excluded
}

/**
 * Registers a team on behalf of the team lead.
 *
 * Invariants enforced inside one transaction:
 *  - exactly MINOR_PROJECT_TEAM_SIZE (4) students if project type is MINOR
 *  - at most MAX_TEAM_SIZE students including the lead
 *  - no student may hold two ACTIVE memberships (also guaranteed by the
 *    `TeamMember.activeStudentKey` unique index at the database level)
 *  - the mentor must be a faculty member of the same department
 *  - no Team ID is issued here; that happens only on approval
 */
export async function registerTeam(principal: Principal, input: RegisterTeamInput) {
  const mentorFaculty = await db.facultyProfile.findFirst({
    where: { userId: input.mentorUserId },
    select: { departmentId: true },
  });
  if (!mentorFaculty) throw new DomainError("The selected mentor is not a registered faculty member.");
  if (mentorFaculty.departmentId !== input.departmentId) {
    throw new DomainError("The selected mentor belongs to a different department.");
  }

  const projectType = await db.projectType.findUnique({
    where: { id: input.projectTypeId },
    select: { code: true },
  });
  const totalStudents = input.members.length + 1;
  const isMinor = projectType?.code === "MINOR" || projectType?.code?.startsWith("MINOR-");

  if (isMinor && totalStudents !== MINOR_PROJECT_TEAM_SIZE) {
    throw new DomainError(
      `Minor project teams must consist of exactly ${MINOR_PROJECT_TEAM_SIZE} students (1 team lead and ${MINOR_PROJECT_TEAM_SIZE - 1} members).`,
    );
  }

  if (totalStudents > MAX_TEAM_SIZE) {
    throw new DomainError(`A team may have at most ${MAX_TEAM_SIZE} students including the lead.`);
  }

  return db.$transaction(async (tx) => {
    const lead = await tx.studentProfile.findUnique({
      where: { id: input.leadStudentProfileId },
      include: { user: true },
    });
    if (!lead) throw new DomainError("Team lead profile not found.");

    const enrollments = input.members.map((m) => m.enrollmentNo.trim().toUpperCase());
    if (new Set(enrollments).size !== enrollments.length) {
      throw new DomainError("Duplicate enrollment numbers in the member list.");
    }
    if (enrollments.includes(lead.enrollmentNo.toUpperCase())) {
      throw new DomainError("The team lead must not be repeated in the member list.");
    }

    const memberProfiles = [];
    for (const member of input.members) {
      const profile = await tx.studentProfile.findUnique({
        where: { enrollmentNo: member.enrollmentNo.trim().toUpperCase() },
      });
      if (!profile) {
        throw new DomainError(
          `No student record found for enrollment number ${member.enrollmentNo}. Ask your department office to add the student first.`,
        );
      }
      if (profile.departmentId !== input.departmentId) {
        throw new DomainError(`${member.name} belongs to a different department.`);
      }
      memberProfiles.push(profile);
    }

    const allStudentIds = [lead.id, ...memberProfiles.map((p) => p.id)];
    const clash = await tx.teamMember.findFirst({
      where: { studentId: { in: allStudentIds }, removedAt: null },
      include: { student: true, team: { select: { teamId: true, projectTitle: true } } },
    });
    if (clash) {
      throw new DomainError(
        `${clash.student.enrollmentNo} is already an active member of ${clash.team.teamId ?? clash.team.projectTitle}. A student can belong to only one team.`,
      );
    }

    const team = await tx.team.create({
      data: {
        projectTitle: input.projectTitle.trim(),
        projectDescription: input.projectDescription.trim(),
        departmentId: input.departmentId,
        sectionId: input.sectionId,
        semesterId: input.semesterId,
        projectTypeId: input.projectTypeId,
        academicYearId: input.academicYearId,
        mentorUserId: input.mentorUserId,
        leadStudentId: lead.id,
        registrationStatus: "SUBMITTED",
        status: "REGISTERED",
        members: {
          create: [
            { studentId: lead.id, isLead: true, activeStudentKey: lead.id },
            ...memberProfiles.map((p) => ({ studentId: p.id, isLead: false, activeStudentKey: p.id })),
          ],
        },
        timeline: {
          create: {
            kind: "REGISTERED",
            title: "Project registered",
            detail: `Submitted by ${lead.user.name} for mentor approval`,
            actorUserId: principal.userId,
          },
        },
      },
    });

    await notify(tx, input.mentorUserId, {
      kind: "TEAM_REGISTRATION",
      title: "New team registration awaiting approval",
      body: team.projectTitle,
      link: `/registrations/${team.id}`,
    });

    return team;
  });
}

/**
 * Issues the next department Team ID. Runs inside the caller's transaction and
 * relies on the unique index on `Team.teamId` plus a serialised counter row, so
 * concurrent approvals cannot produce a duplicate.
 */
async function nextTeamId(
  tx: Prisma.TransactionClient,
  departmentId: string,
  academicYearId: string,
): Promise<string> {
  const department = await tx.department.findUniqueOrThrow({
    where: { id: departmentId },
    select: { code: true },
  });

  const existing = await tx.teamIdSequence.findUnique({
    where: { departmentId_academicYearId: { departmentId, academicYearId } },
  });
  const sequence = existing
    ? await tx.teamIdSequence.update({
        where: { id: existing.id },
        data: { lastValue: { increment: 1 } },
      })
    : await tx.teamIdSequence.create({ data: { departmentId, academicYearId, lastValue: 1 } });

  return `PIEMR-${department.code}-${String(sequence.lastValue).padStart(3, "0")}`;
}

export async function approveRegistration(principal: Principal, teamId: string) {
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { members: { include: { student: true } } },
  });
  assertApprovalRights(principal, team.departmentId, team.mentorUserId);
  if (team.registrationStatus === "APPROVED") throw new DomainError("This registration is already approved.");

  const updated = await db.$transaction(async (tx) => {
    const code = await nextTeamId(tx, team.departmentId, team.academicYearId);
    const result = await tx.team.update({
      where: { id: team.id },
      data: {
        teamId: code,
        registrationStatus: "APPROVED",
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedByUserId: principal.userId,
        rejectionReason: null,
      },
    });
    await tx.timelineEvent.create({
      data: {
        teamId: team.id,
        kind: "APPROVED",
        title: "Registration approved",
        detail: `Team ID ${code} issued`,
        actorUserId: principal.userId,
      },
    });
    const studentUserIds = await tx.studentProfile.findMany({
      where: { id: { in: team.members.map((m) => m.studentId) } },
      select: { userId: true },
    });
    for (const s of studentUserIds) {
      await notify(tx, s.userId, {
        kind: "TEAM_APPROVED",
        title: `Your team is approved — ${code}`,
        body: team.projectTitle,
        link: "/my-team",
      });
    }
    return result;
  });

  await recordAudit(principal, {
    action: "TEAM_REGISTRATION_APPROVED",
    entity: "Team",
    entityId: team.id,
    summary: `Approved registration and issued ${updated.teamId}`,
    before: { registrationStatus: team.registrationStatus, teamId: team.teamId },
    after: { registrationStatus: "APPROVED", teamId: updated.teamId },
  });

  return updated;
}

export async function rejectRegistration(principal: Principal, teamId: string, reason: string) {
  if (!reason.trim()) throw new DomainError("A rejection reason is required so the team can correct the entry.");
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  assertApprovalRights(principal, team.departmentId, team.mentorUserId);

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.team.update({
      where: { id: team.id },
      data: { registrationStatus: "REJECTED", rejectionReason: reason.trim() },
    });
    await tx.timelineEvent.create({
      data: {
        teamId: team.id,
        kind: "STATUS",
        title: "Registration rejected",
        detail: reason.trim(),
        actorUserId: principal.userId,
      },
    });
    const lead = await tx.studentProfile.findUnique({
      where: { id: team.leadStudentId },
      select: { userId: true },
    });
    if (lead) {
      await notify(tx, lead.userId, {
        kind: "TEAM_REJECTED",
        title: "Registration needs correction",
        body: reason.trim(),
        link: "/my-team",
      });
    }
    return result;
  });

  await recordAudit(principal, {
    action: "TEAM_REGISTRATION_REJECTED",
    entity: "Team",
    entityId: team.id,
    summary: `Rejected registration: ${reason.trim()}`,
  });
  return updated;
}

function assertApprovalRights(principal: Principal, departmentId: string, mentorUserId: string | null) {
  const isMentor = mentorUserId === principal.userId && principal.roles.includes("FACULTY_MENTOR");
  const isHodOfDept = principal.roles.includes("HOD") && principal.departmentIds.includes(departmentId);
  if (isCollegeWide(principal) || isMentor || isHodOfDept) return;
  throw new AuthorizationError("Only the assigned mentor, the department HOD, or an administrator can decide this registration.");
}

export async function reassignMentor(principal: Principal, teamId: string, mentorUserId: string) {
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { mentor: { select: { name: true } } },
  });
  assertDepartment(principal, team.departmentId);

  const mentor = await db.user.findFirst({
    where: { id: mentorUserId, facultyProfile: { departmentId: team.departmentId } },
    select: { id: true, name: true },
  });
  if (!mentor) throw new DomainError("Select a faculty member from the team's own department.");

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.team.update({ where: { id: team.id }, data: { mentorUserId: mentor.id } });
    await tx.timelineEvent.create({
      data: {
        teamId: team.id,
        kind: "MENTOR_CHANGE",
        title: "Mentor reassigned",
        detail: `${team.mentor?.name ?? "Unassigned"} → ${mentor.name}`,
        actorUserId: principal.userId,
      },
    });
    await notify(tx, mentor.id, {
      kind: "MENTOR_ASSIGNED",
      title: "You have been assigned a new team",
      body: team.projectTitle,
      link: `/teams/${team.id}`,
    });
    return result;
  });

  await recordAudit(principal, {
    action: "TEAM_MENTOR_CHANGED",
    entity: "Team",
    entityId: team.id,
    summary: `Mentor of ${team.teamId ?? team.projectTitle} changed to ${mentor.name}`,
    before: { mentorUserId: team.mentorUserId },
    after: { mentorUserId: mentor.id },
  });
  return updated;
}

export async function addMember(principal: Principal, teamId: string, enrollmentNo: string) {
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { members: { where: { removedAt: null } } },
  });
  assertDepartment(principal, team.departmentId);
  if (team.members.length >= MAX_TEAM_SIZE) {
    throw new DomainError(`This team already has the maximum of ${MAX_TEAM_SIZE} members.`);
  }

  const student = await db.studentProfile.findUnique({
    where: { enrollmentNo: enrollmentNo.trim().toUpperCase() },
  });
  if (!student) throw new DomainError(`No student found with enrollment number ${enrollmentNo}.`);
  if (student.departmentId !== team.departmentId) {
    throw new DomainError("That student belongs to a different department.");
  }
  const active = await db.teamMember.findFirst({ where: { studentId: student.id, removedAt: null } });
  if (active) throw new DomainError("That student is already an active member of another team.");

  const created = await db.teamMember.create({
    data: { teamId: team.id, studentId: student.id, activeStudentKey: student.id },
  });
  await recordAudit(principal, {
    action: "TEAM_MEMBER_ADDED",
    entity: "Team",
    entityId: team.id,
    summary: `Added ${student.enrollmentNo} to ${team.teamId ?? team.projectTitle}`,
  });
  return created;
}

export async function removeMember(principal: Principal, teamId: string, memberId: string) {
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  assertDepartment(principal, team.departmentId);
  const member = await db.teamMember.findUniqueOrThrow({
    where: { id: memberId },
    include: { student: true },
  });
  if (member.teamId !== team.id) throw new DomainError("That member does not belong to this team.");
  if (member.isLead) throw new DomainError("The team lead cannot be removed. Transfer leadership first.");

  await db.teamMember.update({
    where: { id: member.id },
    data: { removedAt: new Date(), activeStudentKey: null },
  });
  await recordAudit(principal, {
    action: "TEAM_MEMBER_REMOVED",
    entity: "Team",
    entityId: team.id,
    summary: `Removed ${member.student.enrollmentNo} from ${team.teamId ?? team.projectTitle}`,
  });
}

export async function setArchived(principal: Principal, teamId: string, archived: boolean) {
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  assertDepartment(principal, team.departmentId);
  const updated = await db.team.update({
    where: { id: team.id },
    data: {
      status: archived ? "ARCHIVED" : "ACTIVE",
      archivedAt: archived ? new Date() : null,
    },
  });
  await recordAudit(principal, {
    action: archived ? "TEAM_ARCHIVED" : "TEAM_RESTORED",
    entity: "Team",
    entityId: team.id,
    summary: `${archived ? "Archived" : "Restored"} ${team.teamId ?? team.projectTitle}`,
  });
  return updated;
}

export interface UpdateTeamInput {
  projectTitle?: string;
  projectDescription?: string;
  sectionId?: string | null;
  semesterId?: string;
  projectTypeId?: string;
  academicYearId?: string;
  status?: string;
}

export async function updateTeam(principal: Principal, teamId: string, input: UpdateTeamInput) {
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  assertDepartment(principal, team.departmentId);
  const updated = await db.team.update({ where: { id: team.id }, data: input });
  await recordAudit(principal, {
    action: "TEAM_UPDATED",
    entity: "Team",
    entityId: team.id,
    summary: `Updated ${team.teamId ?? team.projectTitle}`,
    before: team,
    after: updated,
  });
  return updated;
}

/** Prisma `where` fragment that limits team queries to the principal's reach. */
export function teamScopeWhere(principal: Principal): Prisma.TeamWhereInput {
  if (isCollegeWide(principal)) return {};
  const or: Prisma.TeamWhereInput[] = [];
  if (principal.roles.includes("HOD") && principal.departmentIds.length) {
    or.push({ departmentId: { in: principal.departmentIds } });
  }
  if (principal.roles.includes("FACULTY_MENTOR")) or.push({ mentorUserId: principal.userId });
  if (principal.studentProfileId) {
    or.push({ members: { some: { studentId: principal.studentProfileId, removedAt: null } } });
  }
  // No matching scope → match nothing rather than everything.
  return or.length ? { OR: or } : { id: "__no_access__" };
}
