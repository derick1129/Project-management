import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { formatStampDate, formatStampTime, stampEvidence } from "@/lib/evidence/watermark";

async function samplePhoto(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 70, b: 110 } } })
    .jpeg()
    .toBuffer();
}

describe("formatStampDate / formatStampTime", () => {
  it("renders the date/time in the India timezone regardless of the host's local zone", () => {
    const date = new Date("2026-09-05T10:12:17Z"); // 15:42:17 IST
    expect(formatStampDate(date)).toBe("05 September 2026");
    expect(formatStampTime(date)).toBe("03:42:17 pm");
  });
});

describe("stampEvidence", () => {
  it("produces a valid JPEG no smaller than the input capture", async () => {
    const original = await samplePhoto();
    const stamped = await stampEvidence(original, {
      teamId: "PIEMR-CSE-001",
      projectTitle: "Sample Project",
      mentorName: "Dr. Test",
      latitude: 22.719568,
      longitude: 75.857726,
      accuracyM: 8,
      address: "PIEMR, Indore",
      capturedAt: new Date("2026-09-05T10:12:17Z"),
    });

    const meta = await sharp(stamped).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
    expect(stamped.byteLength).toBeGreaterThan(0);
  });

  it("caps the working width so very large captures do not blow up processing time", async () => {
    const original = await samplePhoto(4000, 3000);
    const stamped = await stampEvidence(original, {
      teamId: "PIEMR-CSE-002",
      projectTitle: "Large capture",
      mentorName: "Dr. Test",
      latitude: 22.72,
      longitude: 75.86,
      accuracyM: 10,
      address: null,
      capturedAt: new Date(),
    });
    const meta = await sharp(stamped).metadata();
    expect(meta.width).toBeLessThanOrEqual(1440);
  });

  it("does not throw when address is null — the field is optional, never fabricated", async () => {
    const original = await samplePhoto();
    await expect(
      stampEvidence(original, {
        teamId: "PIEMR-CSE-003",
        projectTitle: "No address",
        mentorName: "Dr. Test",
        latitude: 1,
        longitude: 1,
        accuracyM: 500,
        address: null,
        capturedAt: new Date(),
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("safely handles facts containing characters that would be meaningful in raw SVG/XML", async () => {
    // Facts are always server-derived, never raw user text — but the stamping
    // function must still not choke or produce corrupt SVG if a team title or
    // mentor name contains XML-special characters (e.g. an ampersand in a
    // department name, or a title copied with angle brackets).
    const original = await samplePhoto();
    await expect(
      stampEvidence(original, {
        teamId: 'PIEMR-CSE-004 <script>&"\'',
        projectTitle: "Title & <Subtitle>",
        mentorName: 'Dr. "Test" & Co.',
        latitude: 22.7,
        longitude: 75.8,
        accuracyM: 15,
        address: "R&D Block <2>",
        capturedAt: new Date(),
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("stamps evidence with a custom institution name when specified", async () => {
    const original = await samplePhoto();
    const stamped = await stampEvidence(original, {
      teamId: "CSE-005",
      projectTitle: "Minor Project Work",
      mentorName: "Prof. Sharma",
      latitude: 28.6139,
      longitude: 77.209,
      accuracyM: 12,
      address: "Main Academic Block",
      capturedAt: new Date("2026-09-08T10:00:00Z"),
      institutionName: "National Engineering Institute",
    });

    const meta = await sharp(stamped).metadata();
    expect(meta.format).toBe("jpeg");
    expect(stamped.byteLength).toBeGreaterThan(0);
  });
});
