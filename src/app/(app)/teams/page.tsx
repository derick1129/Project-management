import Link from "next/link";
import { requirePrincipal } from "@/lib/auth/session";
import { guard } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/rbac";

import { db } from "@/lib/db";
import { teamScopeWhere } from "@/lib/services/teams";
import { computeTeamMetrics } from "@/lib/services/analytics";
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  HealthPill,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { formatPct, pageFrom, param, relativeDays } from "@/lib/utils";

export const metadata = { title: "Projects" };

const PAGE_SIZE = 25;

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requirePrincipal();
  const denied = guard(principal, ["team.read.all", "team.read.department", "team.read.mentored"]);
  if (denied) return denied;
  const sp = await searchParams;

  const filters = {
    academicYearId: param(sp, "year"),
    departmentId: param(sp, "department"),
    semesterId: param(sp, "semester"),
    sectionId: param(sp, "section"),
    projectTypeId: param(sp, "type"),
    status: param(sp, "status"),
    q: param(sp, "q"),
  };

  const where = {
    AND: [
      teamScopeWhere(principal),
      filters.academicYearId ? { academicYearId: filters.academicYearId } : {},
      filters.departmentId ? { departmentId: filters.departmentId } : {},
      filters.semesterId ? { semesterId: filters.semesterId } : {},
      filters.sectionId ? { sectionId: filters.sectionId } : {},
      filters.projectTypeId ? { projectTypeId: filters.projectTypeId } : {},
      filters.status ? { status: filters.status } : {},
      filters.q
        ? {
            OR: [
              { teamId: { contains: filters.q } },
              { projectTitle: { contains: filters.q } },
              { members: { some: { student: { enrollmentNo: { contains: filters.q } } } } },
            ],
          }
        : {},
    ],
  };

  const { page, skip, take } = pageFrom(sp, PAGE_SIZE);
  const [total, teams, metrics] = await Promise.all([
    db.team.count({ where }),
    db.team.findMany({
      where,
      skip,
      take,
      orderBy: [{ teamId: "asc" }, { createdAt: "desc" }],
      include: {
        department: { select: { code: true } },
        section: { select: { name: true } },
        semester: { select: { number: true } },
        projectType: { select: { code: true } },
        mentor: { select: { name: true } },
        members: { where: { removedAt: null }, select: { id: true } },
      },
    }),
    computeTeamMetrics({ AND: [where, { registrationStatus: "APPROVED" }] }),
  ]);

  const metricsById = new Map(metrics.map((m) => [m.teamId, m]));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every registered Minor and Major project within your scope."
        action={
          can(principal, "team.write") ? (
            <ButtonLink href="/teams/assign">Assign Minor Project</ButtonLink>
          ) : undefined
        }
      />

      <FilterBar
        basePath="/teams"
        current={sp}
        fields={["q", "year", "department", "semester", "section", "type", "status"]}
        options={await filterOptions(filters.departmentId)}
      />

      <Card className="mt-4">
        <CardHeader title={`${total} project${total === 1 ? "" : "s"}`} />
        {teams.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Team</Th>
                  <Th>Department</Th>
                  <Th>Type</Th>
                  <Th>Mentor</Th>
                  <Th>Members</Th>
                  <Th>Meetings</Th>
                  <Th>Attendance</Th>
                  <Th>Health</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const m = metricsById.get(team.id);
                  return (
                    <tr key={team.id}>
                      <Td>
                        <Link href={`/teams/${team.id}`} className="font-medium text-[var(--color-brand-600)]">
                          {team.teamId ?? "Pending ID"}
                        </Link>
                        <span className="block max-w-[18rem] truncate text-[12px] text-[var(--color-muted)]">
                          {team.projectTitle}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {team.department.code}
                        {team.section ? `-${team.section.name}` : ""} · S{team.semester.number}
                      </Td>
                      <Td>{team.projectType.code}</Td>
                      <Td className="whitespace-nowrap">{team.mentor?.name ?? "—"}</Td>
                      <Td className="tabular">{team.members.length}</Td>
                      <Td className="tabular whitespace-nowrap">
                        {m ? `${m.meetingsHeld}/${m.expectedMeetings}` : "—"}
                        {m ? (
                          <span className="block text-[11px] text-[var(--color-muted)]">
                            {relativeDays(m.lastMeetingAt)}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="tabular">{formatPct(m?.attendancePct, 0)}</Td>
                      <Td>{m ? <HealthPill score={m.healthScore} label={m.healthLabel} /> : "—"}</Td>
                      <Td>
                        <StatusBadge status={team.registrationStatus === "APPROVED" ? team.status : team.registrationStatus} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              basePath="/teams"
              query={Object.fromEntries(
                Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
              )}
            />
          </>
        ) : (
          <EmptyState title="No projects match these filters" description="Clear a filter or widen the search." />
        )}
      </Card>
    </>
  );
}

async function filterOptions(departmentId?: string) {
  const [years, departments, semesters, types, sections] = await Promise.all([
    db.academicYear.findMany({ orderBy: { label: "desc" }, select: { id: true, label: true } }),
    db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true } }),
    db.semester.findMany({ orderBy: { number: "asc" }, select: { id: true, number: true } }),
    db.projectType.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    departmentId
      ? db.section.findMany({ where: { departmentId }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    year: years.map((y) => ({ value: y.id, label: y.label })),
    department: departments.map((d) => ({ value: d.id, label: d.code })),
    semester: semesters.map((s) => ({ value: s.id, label: `Semester ${s.number}` })),
    section: sections.map((s) => ({ value: s.id, label: s.name })),
    type: types.map((t) => ({ value: t.id, label: t.name })),
    status: ["REGISTERED", "ACTIVE", "COMPLETED", "ARCHIVED"].map((s) => ({ value: s, label: s.toLowerCase() })),
  };
}
