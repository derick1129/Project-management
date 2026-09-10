"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Select,
  SuccessNote,
  Textarea,
} from "@/components/ui";
import { MAX_TEAM_SIZE } from "@/lib/domain/constants";
import { registerTeamAction, type RegisterState } from "./actions";

interface Option {
  value: string;
  label: string;
}
interface ScopedOption extends Option {
  departmentId: string;
}

export function RegisterTeamForm({
  departments,
  sections,
  semesters,
  types,
  years,
  mentors,
  academicConfigs,
}: {
  departments: Option[];
  sections: ScopedOption[];
  semesters: Option[];
  types: Option[];
  years: (Option & { isCurrent: boolean })[];
  mentors: ScopedOption[];
  academicConfigs: { academicYearId: string; semesterId: string; projectTypeId: string }[];
}) {
  const [state, action] = useActionState<RegisterState, FormData>(registerTeamAction, { status: "idle" });
  const [departmentId, setDepartmentId] = useState(departments[0]?.value ?? "");
  const [academicYearId, setAcademicYearId] = useState(
    years.find((y) => y.isCurrent)?.value ?? years[0]?.value ?? "",
  );
  const [semesterId, setSemesterId] = useState(semesters[0]?.value ?? "");

  // The semester → project type mapping is configuration, not hardcoded logic.
  const mappedType = academicConfigs.find(
    (c) => c.academicYearId === academicYearId && c.semesterId === semesterId,
  )?.projectTypeId;

  const [selectedTypeId, setSelectedTypeId] = useState(mappedType ?? types[0]?.value ?? "");
  const effectiveTypeId = mappedType ?? selectedTypeId;
  const currentType = types.find((t) => t.value === effectiveTypeId);
  const isMinor = currentType?.label.toLowerCase().includes("minor") ?? true;

  const departmentSections = sections.filter((s) => s.departmentId === departmentId);
  const departmentMentors = mentors.filter((m) => m.departmentId === departmentId);

  if (state.status === "success") {
    return (
      <Card>
        <CardBody className="space-y-4">
          <SuccessNote>{state.message}</SuccessNote>
          <Link href="/dashboard" className="inline-block">
            <Button>Go to my dashboard</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" ? <ErrorState title="Registration not submitted" description={state.message} /> : null}

      <Card>
        <CardHeader title="Project" />
        <CardBody className="space-y-4">
          <Field label="Project title" htmlFor="projectTitle" required>
            <Input id="projectTitle" name="projectTitle" required maxLength={180} />
          </Field>
          <Field label="Project description" htmlFor="projectDescription" required hint="At least a short paragraph.">
            <Textarea id="projectDescription" name="projectDescription" rows={4} required maxLength={4000} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch / department" htmlFor="departmentId" required>
              <Select
                id="departmentId"
                name="departmentId"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                required
              >
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section" htmlFor="sectionId">
              <Select id="sectionId" name="sectionId">
                <option value="">Not applicable</option>
                {departmentSections.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Academic year" htmlFor="academicYearId" required>
              <Select
                id="academicYearId"
                name="academicYearId"
                value={academicYearId}
                onChange={(e) => setAcademicYearId(e.target.value)}
                required
              >
                {years.map((y) => (
                  <option key={y.value} value={y.value}>
                    {y.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Semester" htmlFor="semesterId" required>
              <Select
                id="semesterId"
                name="semesterId"
                value={semesterId}
                onChange={(e) => setSemesterId(e.target.value)}
                required
              >
                {semesters.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Project type"
              htmlFor="projectTypeId"
              required
              hint={mappedType ? "Pre-selected from your college's semester configuration." : undefined}
            >
              <Select
                id="projectTypeId"
                name="projectTypeId"
                value={effectiveTypeId}
                onChange={(e) => setSelectedTypeId(e.target.value)}
                required
              >
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Faculty mentor" htmlFor="mentorUserId" required>
              <Select id="mentorUserId" name="mentorUserId" required>
                {departmentMentors.length ? (
                  departmentMentors.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))
                ) : (
                  <option value="">No faculty registered for this department yet</option>
                )}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Team lead" description="This creates your sign-in account." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="leadName" required>
            <Input id="leadName" name="leadName" required />
          </Field>
          <Field label="Enrollment number" htmlFor="leadEnrollmentNo" required>
            <Input id="leadEnrollmentNo" name="leadEnrollmentNo" required className="uppercase" />
          </Field>
          <Field label="Email" htmlFor="leadEmail" required>
            <Input id="leadEmail" name="leadEmail" type="email" required />
          </Field>
          <Field label="Phone" htmlFor="leadPhone">
            <Input id="leadPhone" name="leadPhone" type="tel" />
          </Field>
          <Field label="Password" htmlFor="leadPassword" required hint="At least 8 characters with a letter and a number.">
            <Input id="leadPassword" name="leadPassword" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
        </CardBody>
      </Card>

      {Array.from({ length: MAX_TEAM_SIZE - 1 }, (_, idx) => idx + 2).map((n) => (
        <Card key={n}>
          <CardHeader
            title={`Member ${n}`}
            description={
              isMinor
                ? "Required for Minor Projects (strictly 4 students per team: 1 lead + 3 members)."
                : "Leave blank if the team has fewer members."
            }
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor={`member${n}Name`} required={isMinor}>
              <Input id={`member${n}Name`} name={`member${n}Name`} required={isMinor} />
            </Field>
            <Field label="Enrollment number" htmlFor={`member${n}Enrollment`} required={isMinor}>
              <Input id={`member${n}Enrollment`} name={`member${n}Enrollment`} className="uppercase" required={isMinor} />
            </Field>
            <Field label="Email" htmlFor={`member${n}Email`} required={isMinor}>
              <Input id={`member${n}Email`} name={`member${n}Email`} type="email" required={isMinor} />
            </Field>
            <Field label="Phone" htmlFor={`member${n}Phone`}>
              <Input id={`member${n}Phone`} name={`member${n}Phone`} type="tel" />
            </Field>
          </CardBody>
        </Card>
      ))}

      <InfoNote>
        A student can belong to only one active team. Member accounts are created without a password — members
        collect their credentials from the department office.
      </InfoNote>

      <Button type="submit" className="w-full sm:w-auto">
        Submit registration
      </Button>
    </form>
  );
}
