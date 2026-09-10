"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { createSession, requestMeta } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { registerTeam } from "@/lib/services/teams";
import { MAX_TEAM_SIZE, MINOR_PROJECT_TEAM_SIZE } from "@/lib/domain/constants";
import { recordAudit } from "@/lib/services/audit";

export interface RegisterState {
  status: "idle" | "error" | "success";
  message?: string;
}

const memberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  enrollmentNo: z.string().trim().min(4).max(30),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).optional(),
});

const schema = z.object({
  projectTitle: z.string().trim().min(6).max(180),
  projectDescription: z.string().trim().min(20).max(4000),
  departmentId: z.string().min(1),
  sectionId: z.string().optional(),
  semesterId: z.string().min(1),
  projectTypeId: z.string().min(1),
  academicYearId: z.string().min(1),
  mentorUserId: z.string().min(1),
  leadName: z.string().trim().min(2).max(120),
  leadEnrollmentNo: z.string().trim().min(4).max(30),
  leadEmail: z.string().trim().email(),
  leadPhone: z.string().trim().max(20).optional(),
  leadPassword: z.string().min(8),
});

/**
 * Public team-lead registration.
 *
 * Member accounts are provisioned with a random password and `mustReset` set —
 * students collect their credentials from the department office. Nothing about
 * the team is confirmed here: the record is SUBMITTED and carries no Team ID
 * until a mentor or HOD approves it.
 */
export async function registerTeamAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  try {
    const meta = await requestMeta();
    const limit = rateLimit(`register:${meta.ip ?? "unknown"}`, 6, 30 * 60_000);
    if (!limit.allowed) {
      return { status: "error", message: "Too many registration attempts. Try again later." };
    }

    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { status: "error", message: `${issue?.path.join(".")}: ${issue?.message}` };
    }
    const problems = passwordProblems(parsed.data.leadPassword);
    if (problems.length) return { status: "error", message: `Password must contain ${problems.join(", ")}.` };

    const members: z.infer<typeof memberSchema>[] = [];
    for (let i = 2; i <= MAX_TEAM_SIZE; i++) {
      const name = String(formData.get(`member${i}Name`) ?? "").trim();
      const enrollmentNo = String(formData.get(`member${i}Enrollment`) ?? "").trim();
      const email = String(formData.get(`member${i}Email`) ?? "").trim();
      const phone = String(formData.get(`member${i}Phone`) ?? "").trim();
      if (!name && !enrollmentNo && !email) continue; // optional slot left blank
      const memberParsed = memberSchema.safeParse({ name, enrollmentNo, email, phone: phone || undefined });
      if (!memberParsed.success) {
        return { status: "error", message: `Member ${i}: ${memberParsed.error.issues[0]?.message}` };
      }
      members.push(memberParsed.data);
    }

    const projectType = await db.projectType.findUnique({
      where: { id: parsed.data.projectTypeId },
      select: { code: true },
    });
    const isMinor = projectType?.code === "MINOR" || projectType?.code?.startsWith("MINOR-");
    if (isMinor && members.length !== MINOR_PROJECT_TEAM_SIZE - 1) {
      return {
        status: "error",
        message: `Minor project teams must consist of exactly ${MINOR_PROJECT_TEAM_SIZE} students (1 team lead and ${MINOR_PROJECT_TEAM_SIZE - 1} members). Please fill in all member details.`,
      };
    }

    const leadEmail = parsed.data.leadEmail.toLowerCase();
    const leadEnrollment = parsed.data.leadEnrollmentNo.toUpperCase();

    if (await db.user.findUnique({ where: { email: leadEmail }, select: { id: true } })) {
      return { status: "error", message: "That email is already registered. Sign in and open your team instead." };
    }
    if (await db.studentProfile.findUnique({ where: { enrollmentNo: leadEnrollment }, select: { id: true } })) {
      return { status: "error", message: "That enrollment number already has an account. Sign in instead." };
    }

    // Create (or reuse) student records for every member.
    const leadUser = await db.user.create({
      data: {
        name: parsed.data.leadName,
        email: leadEmail,
        phone: parsed.data.leadPhone || null,
        passwordHash: await hashPassword(parsed.data.leadPassword),
        roles: { create: [{ role: "STUDENT", departmentId: parsed.data.departmentId }] },
      },
    });
    const leadProfile = await db.studentProfile.create({
      data: {
        userId: leadUser.id,
        enrollmentNo: leadEnrollment,
        departmentId: parsed.data.departmentId,
        sectionId: parsed.data.sectionId || null,
        semesterId: parsed.data.semesterId,
      },
    });

    for (const member of members) {
      const enrollmentNo = member.enrollmentNo.toUpperCase();
      const existing = await db.studentProfile.findUnique({ where: { enrollmentNo } });
      if (existing) continue;
      const emailTaken = await db.user.findUnique({
        where: { email: member.email.toLowerCase() },
        select: { id: true },
      });
      if (emailTaken) {
        return {
          status: "error",
          message: `${member.email} already belongs to another account. Use the member's college email.`,
        };
      }
      const memberUser = await db.user.create({
        data: {
          name: member.name,
          email: member.email.toLowerCase(),
          phone: member.phone || null,
          // Random secret: the member cannot sign in until the department
          // office issues them a password.
          passwordHash: await hashPassword(randomBytes(24).toString("hex")),
          mustReset: true,
          roles: { create: [{ role: "STUDENT", departmentId: parsed.data.departmentId }] },
        },
      });
      await db.studentProfile.create({
        data: {
          userId: memberUser.id,
          enrollmentNo,
          departmentId: parsed.data.departmentId,
          sectionId: parsed.data.sectionId || null,
          semesterId: parsed.data.semesterId,
        },
      });
    }

    const principal = {
      userId: leadProfile.userId,
      name: parsed.data.leadName,
      email: leadEmail,
      roles: ["STUDENT" as const],
      departmentIds: [],
      homeDepartmentId: parsed.data.departmentId,
      studentProfileId: leadProfile.id,
      facultyProfileId: null,
    };

    const team = await registerTeam(principal, {
      projectTitle: parsed.data.projectTitle,
      projectDescription: parsed.data.projectDescription,
      departmentId: parsed.data.departmentId,
      sectionId: parsed.data.sectionId || null,
      semesterId: parsed.data.semesterId,
      projectTypeId: parsed.data.projectTypeId,
      academicYearId: parsed.data.academicYearId,
      mentorUserId: parsed.data.mentorUserId,
      leadStudentProfileId: leadProfile.id,
      members: members.map((m) => ({
        name: m.name,
        enrollmentNo: m.enrollmentNo,
        email: m.email,
        phone: m.phone ?? null,
      })),
    });

    await recordAudit(principal, {
      action: "TEAM_REGISTERED",
      entity: "Team",
      entityId: team.id,
      summary: `Team lead ${leadEnrollment} registered "${team.projectTitle}" for approval`,
    });

    await createSession(leadProfile.userId);
    return {
      status: "success",
      message: "Registration submitted. Your mentor or HOD will approve it and your Team ID will be issued then.",
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Registration failed." };
  }
}
