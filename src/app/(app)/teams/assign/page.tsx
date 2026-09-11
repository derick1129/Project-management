import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/auth/session";
import { guard } from "@/lib/auth/page-guard";
import { isCollegeWide } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { AssignTeamForm, type MentorOption, type StudentOption } from "./assign-form";

export const metadata = { title: "Assign Minor Project Team" };

export default async function AssignTeamPage() {
  const principal = await requirePrincipal();
  const denied = guard(principal, ["team.write"]);
  if (denied) return denied;

  const collegeWide = isCollegeWide(principal);
  const deptWhere = collegeWide
    ? { isActive: true }
    : { id: { in: principal.departmentIds }, isActive: true };

  const [departments, semesters, projectTypes, years, sections, faculty, unassignedStudents] =
    await Promise.all([
      db.department.findMany({ where: deptWhere, orderBy: { sortOrder: "asc" } }),
      db.semester.findMany({ where: { isActive: true }, orderBy: { number: "asc" } }),
      db.projectType.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      db.academicYear.findMany({ where: { isActive: true }, orderBy: { label: "desc" } }),
      db.section.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      db.facultyProfile.findMany({
        where: collegeWide ? undefined : { departmentId: { in: principal.departmentIds } },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              mentoredTeams: { where: { status: "ACTIVE" }, select: { id: true } },
            },
          },
          department: { select: { id: true, code: true } },
        },
        orderBy: { user: { name: "asc" } },
      }),
      db.studentProfile.findMany({
        where: {
          departmentId: collegeWide ? undefined : { in: principal.departmentIds },
          memberships: {
            none: { removedAt: null },
          },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          section: { select: { name: true } },
        },
        orderBy: [{ enrollmentNo: "asc" }],
      }),
    ]);

  if (!departments.length) notFound();

  // Sort project types to prioritize MINOR
  const sortedTypes = [...projectTypes].sort((a, b) => {
    if (a.code === "MINOR") return -1;
    if (b.code === "MINOR") return 1;
    return a.name.localeCompare(b.name);
  });

  const mentorOptions: MentorOption[] = faculty.map((f) => ({
    value: f.userId,
    label: f.user.name,
    departmentId: f.departmentId,
    activeTeamCount: f.user.mentoredTeams.length,
  }));

  const studentOptions: StudentOption[] = unassignedStudents.map((s) => ({
    id: s.id,
    name: s.user.name,
    enrollmentNo: s.enrollmentNo,
    departmentId: s.departmentId,
    sectionName: s.section?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/teams" className="hover:underline">
            Projects
          </Link>
        }
        title="Assign Minor Project Team"
        description="Directly assign a faculty mentor to a group of 4 students. An official Team ID is generated immediately."
      />

      <AssignTeamForm
        departments={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
        sections={sections.map((s) => ({ value: s.id, label: s.name, departmentId: s.departmentId }))}
        semesters={semesters.map((s) => ({ value: s.id, label: `Semester ${s.number}` }))}
        years={years.map((y) => ({ value: y.id, label: y.label, isCurrent: y.isCurrent }))}
        projectTypes={sortedTypes.map((t) => ({ value: t.id, label: t.name }))}
        mentors={mentorOptions}
        students={studentOptions}
      />
    </div>
  );
}
