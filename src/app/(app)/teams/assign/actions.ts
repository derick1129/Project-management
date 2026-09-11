"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/auth/session";
import { assertCan } from "@/lib/auth/rbac";
import { assignMinorProjectTeam, type DirectAssignTeamInput } from "@/lib/services/teams";

export interface AssignTeamState {
  status: "idle" | "error" | "success";
  message?: string;
  teamId?: string;
}

const schema = z.object({
  projectTitle: z.string().trim().min(6).max(180),
  projectDescription: z.string().trim().min(20).max(4000),
  departmentId: z.string().min(1),
  sectionId: z.string().optional().nullable(),
  semesterId: z.string().min(1),
  projectTypeId: z.string().min(1),
  academicYearId: z.string().min(1),
  mentorUserId: z.string().min(1),
  leadStudentProfileId: z.string().min(1),
  memberStudentProfileIds: z.array(z.string().min(1)).length(3),
});

export async function assignTeamAction(
  _prev: AssignTeamState,
  formData: FormData,
): Promise<AssignTeamState> {
  try {
    const principal = await requirePrincipal();
    assertCan(principal, "team.write");

    const memberIds = [
      String(formData.get("memberStudentProfileId1") ?? "").trim(),
      String(formData.get("memberStudentProfileId2") ?? "").trim(),
      String(formData.get("memberStudentProfileId3") ?? "").trim(),
    ].filter(Boolean);

    const parsed = schema.safeParse({
      projectTitle: formData.get("projectTitle"),
      projectDescription: formData.get("projectDescription"),
      departmentId: formData.get("departmentId"),
      sectionId: formData.get("sectionId") || null,
      semesterId: formData.get("semesterId"),
      projectTypeId: formData.get("projectTypeId"),
      academicYearId: formData.get("academicYearId"),
      mentorUserId: formData.get("mentorUserId"),
      leadStudentProfileId: formData.get("leadStudentProfileId"),
      memberStudentProfileIds: memberIds,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        status: "error",
        message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid team assignment inputs.",
      };
    }

    const team = await assignMinorProjectTeam(principal, parsed.data as DirectAssignTeamInput);

    revalidatePath("/teams");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: `Team ${team.teamId} successfully created and assigned to mentor!`,
      teamId: team.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to assign team.",
    };
  }
}
