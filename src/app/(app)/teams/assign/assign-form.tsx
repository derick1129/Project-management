"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  Button,
  ButtonLink,
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
import { assignTeamAction, type AssignTeamState } from "./actions";

interface Option {
  value: string;
  label: string;
}

interface ScopedOption extends Option {
  departmentId: string;
}

export interface StudentOption {
  id: string;
  name: string;
  enrollmentNo: string;
  departmentId: string;
  sectionName?: string | null;
}

export interface MentorOption extends ScopedOption {
  activeTeamCount: number;
}

export function AssignTeamForm({
  departments,
  sections,
  semesters,
  years,
  projectTypes,
  mentors,
  students,
}: {
  departments: Option[];
  sections: ScopedOption[];
  semesters: Option[];
  years: (Option & { isCurrent: boolean })[];
  projectTypes: Option[];
  mentors: MentorOption[];
  students: StudentOption[];
}) {
  const [state, action] = useActionState<AssignTeamState, FormData>(assignTeamAction, { status: "idle" });

  const [departmentId, setDepartmentId] = useState(departments[0]?.value ?? "");
  const [academicYearId, setAcademicYearId] = useState(
    years.find((y) => y.isCurrent)?.value ?? years[0]?.value ?? "",
  );
  const [semesterId, setSemesterId] = useState(semesters[0]?.value ?? "");

  const [leadStudentId, setLeadStudentId] = useState("");
  const [member2Id, setMember2Id] = useState("");
  const [member3Id, setMember3Id] = useState("");
  const [member4Id, setMember4Id] = useState("");

  const departmentSections = sections.filter((s) => s.departmentId === departmentId);
  const departmentMentors = mentors.filter((m) => m.departmentId === departmentId);
  const departmentStudents = students.filter((s) => s.departmentId === departmentId);

  // Filter out students already selected in other roles to avoid duplicate picks
  const selectedStudentIds = new Set([leadStudentId, member2Id, member3Id, member4Id].filter(Boolean));
  const hasDuplicates = selectedStudentIds.size < [leadStudentId, member2Id, member3Id, member4Id].filter(Boolean).length;

  if (state.status === "success") {
    return (
      <Card>
        <CardBody className="space-y-4">
          <SuccessNote>{state.message}</SuccessNote>
          <div className="flex gap-3">
            <ButtonLink href={`/teams/${state.teamId}`}>Open Project Workspace</ButtonLink>
            <ButtonLink variant="secondary" href="/teams">
              Back to Projects List
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" ? <ErrorState title="Assignment Failed" description={state.message} /> : null}
      {hasDuplicates ? (
        <ErrorState
          title="Duplicate Selection"
          description="Each member of the team must be a distinct student. Please ensure no student is chosen twice."
        />
      ) : null}

      <Card>
        <CardHeader
          title="Academic Scope & Mentor"
          description="Select the department, semester schedule, and assigned faculty mentor."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {departments.length > 1 ? (
            <Field label="Department" htmlFor="departmentId" required>
              <Select
                id="departmentId"
                name="departmentId"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setLeadStudentId("");
                  setMember2Id("");
                  setMember3Id("");
                  setMember4Id("");
                }}
                required
              >
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="departmentId" value={departmentId} />
          )}

          <Field label="Section" htmlFor="sectionId">
            <Select id="sectionId" name="sectionId">
              <option value="">All / Not applicable</option>
              {departmentSections.map((s) => (
                <option key={s.value} value={s.value}>
                  Section {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Academic Year" htmlFor="academicYearId" required>
            <Select
              id="academicYearId"
              name="academicYearId"
              value={academicYearId}
              onChange={(e) => setAcademicYearId(e.target.value)}
              required
            >
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label} {y.isCurrent ? "(Current)" : ""}
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

          <Field label="Project Type" htmlFor="projectTypeId" required>
            <Select id="projectTypeId" name="projectTypeId" defaultValue={projectTypes[0]?.value} required>
              {projectTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Faculty Mentor" htmlFor="mentorUserId" required hint="Shows current active teams mentored.">
            <Select id="mentorUserId" name="mentorUserId" required>
              <option value="">Select faculty mentor...</option>
              {departmentMentors.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} ({m.activeTeamCount} active teams)
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Project Details" description="Initial title and scope for the minor project." />
        <CardBody className="space-y-4">
          <Field label="Project Title" htmlFor="projectTitle" required>
            <Input
              id="projectTitle"
              name="projectTitle"
              placeholder="e.g. AI-Powered Autonomous Warehouse Robot"
              required
              maxLength={180}
            />
          </Field>
          <Field label="Project Description" htmlFor="projectDescription" required>
            <Textarea
              id="projectDescription"
              name="projectDescription"
              rows={3}
              placeholder="Brief summary of objectives, proposed methodology, and expected deliverables."
              required
              maxLength={4000}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Student Members (Strictly 4 Students)"
          description="Every Minor Project team must have exactly 4 students (1 Team Lead and 3 Members)."
        />
        <CardBody className="space-y-4">
          {departmentStudents.length < 4 ? (
            <InfoNote>
              There are only {departmentStudents.length} unassigned student(s) available in this department. Please ensure
              students are registered in the department first.
            </InfoNote>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Team Lead (Student 1)" htmlFor="leadStudentProfileId" required>
              <Select
                id="leadStudentProfileId"
                name="leadStudentProfileId"
                value={leadStudentId}
                onChange={(e) => setLeadStudentId(e.target.value)}
                required
              >
                <option value="">Select Team Lead...</option>
                {departmentStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.enrollmentNo} — {s.name} {s.sectionName ? `(${s.sectionName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Member 2" htmlFor="memberStudentProfileId1" required>
              <Select
                id="memberStudentProfileId1"
                name="memberStudentProfileId1"
                value={member2Id}
                onChange={(e) => setMember2Id(e.target.value)}
                required
              >
                <option value="">Select Member 2...</option>
                {departmentStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.enrollmentNo} — {s.name} {s.sectionName ? `(${s.sectionName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Member 3" htmlFor="memberStudentProfileId2" required>
              <Select
                id="memberStudentProfileId2"
                name="memberStudentProfileId2"
                value={member3Id}
                onChange={(e) => setMember3Id(e.target.value)}
                required
              >
                <option value="">Select Member 3...</option>
                {departmentStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.enrollmentNo} — {s.name} {s.sectionName ? `(${s.sectionName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Member 4" htmlFor="memberStudentProfileId3" required>
              <Select
                id="memberStudentProfileId3"
                name="memberStudentProfileId3"
                value={member4Id}
                onChange={(e) => setMember4Id(e.target.value)}
                required
              >
                <option value="">Select Member 4...</option>
                {departmentStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.enrollmentNo} — {s.name} {s.sectionName ? `(${s.sectionName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <InfoNote>
            This action creates an approved, active project team and immediately generates an official Team ID.
            The assigned mentor and all 4 students will be notified automatically.
          </InfoNote>
        </CardBody>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={hasDuplicates || !leadStudentId || !member2Id || !member3Id || !member4Id}>
          Assign & Activate Minor Project Team
        </Button>
        <ButtonLink variant="secondary" href="/teams">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
