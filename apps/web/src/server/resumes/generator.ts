import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CandidateProfile } from "@rapidapply/contracts";
import { buildResumeFileName } from "./naming";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const MARGIN = 54;
const FIXED_METADATA_DATE = new Date("2000-01-01T00:00:00.000Z");

export interface GeneratedResumePdf {
  bytes: Uint8Array;
  fileName: string;
}

/**
 * Creates a compact foundational resume from candidate-authored facts only.
 * Work history, education, skills, and achievements are intentionally absent
 * until the product collects those facts in the dedicated resume experience.
 */
export async function generateResumePdf(input: {
  profile: CandidateProfile;
  targetRole: string;
  version: number;
}): Promise<GeneratedResumePdf> {
  const fullName = cleanPdfText(input.profile.fullName);
  const contactEmail = cleanPdfText(input.profile.contactEmail);
  const targetRole = cleanPdfText(input.targetRole);
  if (!fullName || !contactEmail || !targetRole) {
    throw new Error("A name, contact email, and target role are required to generate a resume.");
  }

  const fileName = buildResumeFileName({ fullName, targetRole, version: input.version });
  const document = await PDFDocument.create();
  document.setTitle(fileName.replace(/\.pdf$/i, ""));
  document.setAuthor(fullName);
  document.setSubject(`Resume for ${targetRole}`);
  document.setCreator("RapidApply");
  document.setProducer("RapidApply");
  document.setCreationDate(FIXED_METADATA_DATE);
  document.setModificationDate(FIXED_METADATA_DATE);

  const page = document.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let y = LETTER_HEIGHT - MARGIN;

  page.drawText(fullName, {
    x: MARGIN,
    y,
    size: 24,
    font: bold,
    color: rgb(0.045, 0.071, 0.125),
  });
  y -= 26;

  const headline = cleanPdfText(input.profile.headline) || targetRole;
  page.drawText(headline, {
    x: MARGIN,
    y,
    size: 11.5,
    font: regular,
    color: rgb(0.08, 0.23, 0.62),
  });
  y -= 21;

  const contact = [
    contactEmail,
    cleanPdfText(input.profile.phone),
    cleanPdfText(input.profile.location),
  ].filter(Boolean).join("  |  ");
  page.drawText(contact, {
    x: MARGIN,
    y,
    size: 9.5,
    font: regular,
    color: rgb(0.25, 0.31, 0.4),
  });
  y -= 15;

  const links = [
    cleanPdfText(input.profile.linkedinUrl),
    cleanPdfText(input.profile.portfolioUrl),
  ].filter(Boolean).join("  |  ");
  if (links) {
    for (const line of wrapText(links, regular, 9, LETTER_WIDTH - MARGIN * 2)) {
      page.drawText(line, { x: MARGIN, y, size: 9, font: regular, color: rgb(0.25, 0.31, 0.4) });
      y -= 12;
    }
  }

  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: LETTER_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.86, 0.89, 0.94),
  });
  y -= 29;

  const summary = cleanPdfText(input.profile.summary);
  if (summary) {
    y = drawSection(page, bold, regular, y, "PROFESSIONAL SUMMARY", summary);
  }

  y = drawSection(
    page,
    bold,
    regular,
    y,
    "TARGET ROLE",
    targetRole,
  );

  if (headline && headline !== targetRole) {
    y = drawSection(page, bold, regular, y, "PROFESSIONAL FOCUS", headline);
  }

  // Keep the artifact valid and uncluttered even with a long candidate summary.
  // A later resume builder will own experience, education, and skills sections.
  if (y < MARGIN) {
    throw new Error("The approved profile content is too long for the foundational one-page resume.");
  }

  const bytes = await document.save({ useObjectStreams: false });
  return { bytes, fileName };
}

function drawSection(
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  startY: number,
  heading: string,
  body: string,
): number {
  let y = startY;
  page.drawText(heading, {
    x: MARGIN,
    y,
    size: 9,
    font: bold,
    color: rgb(0.08, 0.23, 0.62),
  });
  y -= 18;

  for (const line of wrapText(body, regular, 10.5, LETTER_WIDTH - MARGIN * 2).slice(0, 24)) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 10.5,
      font: regular,
      color: rgb(0.12, 0.16, 0.23),
    });
    y -= 15;
  }
  return y - 22;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function cleanPdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
