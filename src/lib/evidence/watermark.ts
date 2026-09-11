import sharp from "sharp";

export interface StampFacts {
  teamId: string;
  projectTitle: string;
  mentorName: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  address: string | null;
  capturedAt: Date;
  institutionName?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

export function formatStampDate(date: Date): string {
  return DATE_FMT.format(date);
}
export function formatStampTime(date: Date): string {
  return TIME_FMT.format(date);
}

/**
 * Renders the evidence image.
 *
 * Every value burned into the image comes from `facts`, which the caller
 * builds from database records and the server-validated GPS fix — never from
 * user-supplied text. The original capture is stored separately and untouched.
 */
export async function stampEvidence(original: Buffer, facts: StampFacts): Promise<Buffer> {
  const base = sharp(original).rotate();
  const meta = await base.metadata();

  // Normalise to a predictable working width so the overlay scales sensibly.
  const targetWidth = Math.min(1440, Math.max(720, meta.width ?? 1080));
  const resized = await base.resize({ width: targetWidth, withoutEnlargement: false }).jpeg({ quality: 88 }).toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const width = resizedMeta.width ?? targetWidth;
  const height = resizedMeta.height ?? Math.round(targetWidth * 0.75);

  const pad = Math.round(width * 0.025);
  const line = Math.round(width * 0.026);
  const small = Math.round(width * 0.021);
  const title = Math.round(width * 0.034);

  const rows = [
    facts.address ? `📍 ${facts.address}` : "📍 Location captured on device",
    `Lat: ${facts.latitude.toFixed(6)}   Long: ${facts.longitude.toFixed(6)}`,
    `Accuracy: ±${Math.round(facts.accuracyM)}m`,
    `${formatStampDate(facts.capturedAt)}   ${formatStampTime(facts.capturedAt)}`,
    `Mentor: ${facts.mentorName}`,
  ];

  const boxHeight = pad * 2 + title + rows.length * line + Math.round(line * 0.4);
  const boxTop = height - boxHeight;

  const institution =
    facts.institutionName ||
    process.env.NEXT_PUBLIC_COLLEGE_NAME ||
    process.env.COLLEGE_NAME ||
    "PIEMR";

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(9,12,20)" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="rgb(9,12,20)" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${boxTop}" width="${width}" height="${boxHeight}" fill="url(#scrim)"/>
  <rect x="0" y="${boxTop}" width="${Math.round(width * 0.012)}" height="${boxHeight}" fill="rgb(37,99,235)"/>
  <text x="${pad + Math.round(width * 0.012)}" y="${boxTop + pad + title * 0.8}"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="${title}" font-weight="700" fill="#ffffff">
    ${escapeXml(facts.teamId)}
  </text>
  ${rows
    .map(
      (row, i) => `<text x="${pad + Math.round(width * 0.012)}" y="${
        boxTop + pad + title + line * (i + 0.85)
      }" font-family="DejaVu Sans, Arial, sans-serif" font-size="${small}" fill="#e6ecf6">${escapeXml(row)}</text>`,
    )
    .join("\n  ")}
  <text x="${width - pad}" y="${boxTop + pad + title * 0.8}" text-anchor="end"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="${small}" fill="#9db4d8">
    ${escapeXml(institution)} · Official Project Meeting Evidence
  </text>
</svg>`;

  return sharp(resized)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}
