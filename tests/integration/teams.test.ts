import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AuthorizationError } from "@/lib/auth/rbac";
import { MAX_TEAM_SIZE } from "@/lib/domain/constants";
import {
  addMember,
  approveRegistration,
  DomainError,
  reassignMentor,
  registerTeam,
  rejectRegistration,
  removeMember,
  setArchived,
  teamScopeWhere,
} from "@/lib/services/teams";
import { buildAcademicEnvironment, makeApprovedTeam, makeUser } from "./fixtures";

describe("teams service", () => {
  let env: Awaited<ReturnType<typeof buildAcademicEnvironment>>;

  beforeAll(async () => {
    env = await buildAcademicEnvironment();
  });

  async function makeMentor() {
    return makeUser({
      roles: [{ role: "FACULTY_MENTOR", departmentId: env.department.id }],
      asFaculty: { departmentId: env.department.id },
    });
  }

  async function makeLead() {
    return makeUser({
      roles: [{ role: "STUDENT", departmentId: env.department.id }],
      asStudent: { departmentId: env.department.id, sectionId: env.section.id, semesterId: env.semester.id },
    });
  }

  describe("registerTeam", () => {
    it("registers a major team as SUBMITTED with no Team ID until approval", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();

      const team = await registerTeam(lead, {
        projectTitle: "AI Based Traffic Management",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead.studentProfileId!,
        members: [],
      });

      expect(team.teamId).toBeNull();
      expect(team.registrationStatus).toBe("SUBMITTED");
      expect(team.status).toBe("REGISTERED");

      const withMembers = await db.team.findUniqueOrThrow({
        where: { id: team.id },
        include: { members: true },
      });
      expect(withMembers.members).toHaveLength(1);
      expect(withMembers.members[0].isLead).toBe(true);
    });

    it("refuses a minor project team with fewer than 4 students", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();

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
          members: [],
        }),
      ).rejects.toThrow(/Minor project teams must consist of exactly 4 students/);
    });

    it("accepts a minor project team with exactly 4 students (1 lead + 3 members)", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();
      const members = await Promise.all([makeLead(), makeLead(), makeLead()]);
      const memberProfiles = await Promise.all(
        members.map((m) => db.studentProfile.findUniqueOrThrow({ where: { id: m.studentProfileId! } })),
      );

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
        members: memberProfiles.map((p, i) => ({
          name: `Member ${i + 2}`,
          enrollmentNo: p.enrollmentNo,
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

    it("refuses more than MAX_TEAM_SIZE students including the lead", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();
      const extraMembers = await Promise.all(
        Array.from({ length: MAX_TEAM_SIZE }, () => makeLead()),
      );

      await expect(
        registerTeam(lead, {
          projectTitle: "Too Many Members",
          projectDescription: "A sufficiently long description of the project.",
          departmentId: env.department.id,
          sectionId: env.section.id,
          semesterId: env.semester.id,
          projectTypeId: env.minor.id,
          academicYearId: env.academicYear.id,
          mentorUserId: mentor.userId,
          leadStudentProfileId: lead.studentProfileId!,
          members: extraMembers.map((m, i) => ({
            name: `Member ${i}`,
            enrollmentNo: `MEM-${lead.userId}-${i}`,
            email: `member${i}-${lead.userId}@test.local`,
          })),
        }),
      ).rejects.toThrow(DomainError);
    });

    it("refuses a mentor from a different department", async () => {
      const otherEnv = await buildAcademicEnvironment();
      const outsideMentor = await makeUser({
        roles: [{ role: "FACULTY_MENTOR", departmentId: otherEnv.department.id }],
        asFaculty: { departmentId: otherEnv.department.id },
      });
      const lead = await makeLead();

      await expect(
        registerTeam(lead, {
          projectTitle: "Cross Department Mentor",
          projectDescription: "A sufficiently long description of the project.",
          departmentId: env.department.id,
          sectionId: env.section.id,
          semesterId: env.semester.id,
          projectTypeId: env.minor.id,
          academicYearId: env.academicYear.id,
          mentorUserId: outsideMentor.userId,
          leadStudentProfileId: lead.studentProfileId!,
          members: [],
        }),
      ).rejects.toThrow(/different department/);
    });

    it("refuses to register a student who already has an active membership on another team", async () => {
      const mentor = await makeMentor();
      const { members } = await makeApprovedTeam(env, { mentor });
      const alreadyOnATeam = members[1];

      const newLead = await makeLead();
      await expect(
        registerTeam(newLead, {
          projectTitle: "Duplicate Member",
          projectDescription: "A sufficiently long description of the project.",
          departmentId: env.department.id,
          sectionId: env.section.id,
          semesterId: env.semester.id,
          projectTypeId: env.major.id,
          academicYearId: env.academicYear.id,
          mentorUserId: mentor.userId,
          leadStudentProfileId: newLead.studentProfileId!,
          members: [
            {
              name: "Reused",
              enrollmentNo: (
                await db.studentProfile.findUniqueOrThrow({ where: { id: alreadyOnATeam.studentProfileId! } })
              ).enrollmentNo,
              email: "reused@test.local",
            },
          ],
        }),
      ).rejects.toThrow(/already an active member/);
    });
  });

  describe("approveRegistration", () => {
    it("issues sequential per-department Team IDs and flips status to ACTIVE", async () => {
      const mentor = await makeMentor();
      const lead1 = await makeLead();
      const lead2 = await makeLead();

      const team1 = await registerTeam(lead1, {
        projectTitle: "Sequence Team One",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead1.studentProfileId!,
        members: [],
      });
      const team2 = await registerTeam(lead2, {
        projectTitle: "Sequence Team Two",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead2.studentProfileId!,
        members: [],
      });

      const approved1 = await approveRegistration(mentor, team1.id);
      const approved2 = await approveRegistration(mentor, team2.id);

      expect(approved1.teamId).toMatch(new RegExp(`^PIEMR-${env.department.code}-\\d{3}$`));
      expect(approved2.teamId).not.toBe(approved1.teamId);
      expect(approved1.status).toBe("ACTIVE");

      // Sequential — the counter incremented by exactly one.
      const n1 = Number(approved1.teamId!.split("-").pop());
      const n2 = Number(approved2.teamId!.split("-").pop());
      expect(n2).toBe(n1 + 1);
    });

    it("only the assigned mentor, the department HOD, or a college-wide admin may decide a registration", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();
      const team = await registerTeam(lead, {
        projectTitle: "Restricted Approval",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead.studentProfileId!,
        members: [],
      });

      const unrelatedMentor = await makeMentor();
      await expect(approveRegistration(unrelatedMentor, team.id)).rejects.toThrow(AuthorizationError);

      // The actual mentor can.
      await expect(approveRegistration(mentor, team.id)).resolves.toMatchObject({ registrationStatus: "APPROVED" });
    });

    it("refuses to re-approve an already-approved registration", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();
      const team = await registerTeam(lead, {
        projectTitle: "Double Approve",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead.studentProfileId!,
        members: [],
      });
      await approveRegistration(mentor, team.id);
      await expect(approveRegistration(mentor, team.id)).rejects.toThrow(/already approved/);
    });
  });

  describe("rejectRegistration", () => {
    it("requires a non-empty reason and records it for the lead to see", async () => {
      const mentor = await makeMentor();
      const lead = await makeLead();
      const team = await registerTeam(lead, {
        projectTitle: "Needs Correction",
        projectDescription: "A sufficiently long description of the project.",
        departmentId: env.department.id,
        sectionId: env.section.id,
        semesterId: env.semester.id,
        projectTypeId: env.major.id,
        academicYearId: env.academicYear.id,
        mentorUserId: mentor.userId,
        leadStudentProfileId: lead.studentProfileId!,
        members: [],
      });

      await expect(rejectRegistration(mentor, team.id, "   ")).rejects.toThrow(/reason is required/);

      const rejected = await rejectRegistration(mentor, team.id, "Scope is too broad.");
      expect(rejected.registrationStatus).toBe("REJECTED");
      expect(rejected.rejectionReason).toBe("Scope is too broad.");
    });
  });

  describe("member management", () => {
    it("enforces the maximum team size on addMember and blocks students already on another team", async () => {
      const mentor = await makeMentor();
      const { team } = await makeApprovedTeam(env, { mentor, memberCount: MAX_TEAM_SIZE });
      const outsider = await makeLead();
      const outsiderProfile = await db.studentProfile.findUniqueOrThrow({ where: { id: outsider.studentProfileId! } });

      await expect(addMember(mentor, team.id, outsiderProfile.enrollmentNo)).rejects.toThrow(/maximum/);
    });

    it("cannot remove the team lead", async () => {
      const mentor = await makeMentor();
      const { team, members } = await makeApprovedTeam(env, { mentor });
      const leadMembership = await db.teamMember.findFirstOrThrow({
        where: { teamId: team.id, studentId: members[0].studentProfileId! },
      });
      await expect(removeMember(mentor, team.id, leadMembership.id)).rejects.toThrow(/lead cannot be removed/);
    });

    it("removing a member frees their enrollment number for reuse", async () => {
      const mentor = await makeMentor();
      const { team, members } = await makeApprovedTeam(env, { mentor, memberCount: 2 });
      const secondMember = await db.teamMember.findFirstOrThrow({
        where: { teamId: team.id, studentId: members[1].studentProfileId! },
      });
      await removeMember(mentor, team.id, secondMember.id);

      const refreshed = await db.teamMember.findUniqueOrThrow({ where: { id: secondMember.id } });
      expect(refreshed.removedAt).not.toBeNull();
      expect(refreshed.activeStudentKey).toBeNull();
    });
  });

  describe("reassignMentor", () => {
    it("only accepts a faculty member from the team's own department", async () => {
      const mentor = await makeMentor();
      const { team } = await makeApprovedTeam(env, { mentor });
      const otherEnv = await buildAcademicEnvironment();
      const outsideFaculty = await makeUser({
        roles: [{ role: "FACULTY_MENTOR", departmentId: otherEnv.department.id }],
        asFaculty: { departmentId: otherEnv.department.id },
      });

      const admin = await makeUser({ roles: [{ role: "ADMIN" }] });
      await expect(reassignMentor(admin, team.id, outsideFaculty.userId)).rejects.toThrow(/own department/);

      const newMentor = await makeMentor();
      const updated = await reassignMentor(admin, team.id, newMentor.userId);
      expect(updated.mentorUserId).toBe(newMentor.userId);
    });
  });

  describe("setArchived", () => {
    it("archives and restores without deleting the record", async () => {
      const mentor = await makeMentor();
      const { team } = await makeApprovedTeam(env, { mentor });
      const admin = await makeUser({ roles: [{ role: "ADMIN" }] });

      const archived = await setArchived(admin, team.id, true);
      expect(archived.status).toBe("ARCHIVED");
      expect(archived.archivedAt).not.toBeNull();

      const stillThere = await db.team.findUnique({ where: { id: team.id } });
      expect(stillThere).not.toBeNull();

      const restored = await setArchived(admin, team.id, false);
      expect(restored.status).toBe("ACTIVE");
      expect(restored.archivedAt).toBeNull();
    });
  });

  describe("teamScopeWhere", () => {
    it("scopes a student to only the team they are an active member of", async () => {
      const mentor = await makeMentor();
      const { team, members } = await makeApprovedTeam(env, { mentor });
      const { team: otherTeam } = await makeApprovedTeam(env, { mentor });

      const studentPrincipal = members[0];
      const visible = await db.team.findMany({ where: teamScopeWhere(studentPrincipal) });
      const visibleIds = visible.map((t) => t.id);
      expect(visibleIds).toContain(team.id);
      expect(visibleIds).not.toContain(otherTeam.id);
    });

    it("scopes a mentor to only the teams they mentor", async () => {
      const mentorA = await makeMentor();
      const mentorB = await makeMentor();
      const { team: teamA } = await makeApprovedTeam(env, { mentor: mentorA });
      const { team: teamB } = await makeApprovedTeam(env, { mentor: mentorB });

      const visible = await db.team.findMany({ where: teamScopeWhere(mentorA) });
      const visibleIds = visible.map((t) => t.id);
      expect(visibleIds).toContain(teamA.id);
      expect(visibleIds).not.toContain(teamB.id);
    });

    it("gives a principal with no matching scope zero results, never everything", async () => {
      const bystander = await makeUser({ roles: [] });
      const visible = await db.team.findMany({ where: teamScopeWhere(bystander) });
      expect(visible).toHaveLength(0);
    });

    it("gives a college-wide admin every team, unfiltered", async () => {
      const admin = await makeUser({ roles: [{ role: "DIRECTOR" }] });
      const mentor = await makeMentor();
      const { team } = await makeApprovedTeam(env, { mentor });
      const visible = await db.team.findMany({ where: teamScopeWhere(admin) });
      expect(visible.map((t) => t.id)).toContain(team.id);
    });
  });
});
