import { describe, it, expect } from "vitest";
import { sanitizeDownloadFilename } from "@/lib/public-certificates/filename";

describe("sanitizeDownloadFilename", () => {
  it("formats normal names with lowercase and hyphens", () => {
    expect(sanitizeDownloadFilename("Ahmad Budi Santoso")).toBe("certificate-ahmad-budi-santoso.pdf");
    expect(sanitizeDownloadFilename("Naufal Nabil Ramadhan")).toBe("certificate-naufal-nabil-ramadhan.pdf");
    expect(sanitizeDownloadFilename("John Doe")).toBe("certificate-john-doe.pdf");
  });

  it("strips accents and diacritics cleanly", () => {
    expect(sanitizeDownloadFilename("José María Aznar")).toBe("certificate-jose-maria-aznar.pdf");
    expect(sanitizeDownloadFilename("François Müller")).toBe("certificate-francois-muller.pdf");
    expect(sanitizeDownloadFilename("Łukasz Piszczek")).toBe("certificate-lukasz-piszczek.pdf");
  });

  it("replaces special characters and punctuation with hyphens", () => {
    expect(sanitizeDownloadFilename("Dr. Jane Doe, M.Sc.")).toBe("certificate-dr-jane-doe-m-sc.pdf");
    expect(sanitizeDownloadFilename("O'Connor & Sons")).toBe("certificate-o-connor-sons.pdf");
    expect(sanitizeDownloadFilename("Participant (Grade 10)")).toBe("certificate-participant-grade-10.pdf");
  });

  it("neutralizes directory traversal patterns", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd")).toBe("certificate-etc-passwd.pdf");
    expect(sanitizeDownloadFilename("..\\..\\windows\\system32")).toBe("certificate-windows-system32.pdf");
    expect(sanitizeDownloadFilename("/root/certificate")).toBe("certificate-root-certificate.pdf");
  });

  it("falls back to certificate.pdf for empty, whitespace, null, or symbol-only inputs", () => {
    expect(sanitizeDownloadFilename(null)).toBe("certificate.pdf");
    expect(sanitizeDownloadFilename(undefined)).toBe("certificate.pdf");
    expect(sanitizeDownloadFilename("")).toBe("certificate.pdf");
    expect(sanitizeDownloadFilename("   ")).toBe("certificate.pdf");
    expect(sanitizeDownloadFilename("???///---")).toBe("certificate.pdf");
    expect(sanitizeDownloadFilename("!@#$%^&*()")).toBe("certificate.pdf");
  });

  it("bounds slug length to 60 characters and trims trailing hyphens", () => {
    const longName = "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count";
    const filename = sanitizeDownloadFilename(longName);

    expect(filename.startsWith("certificate-")).toBe(true);
    expect(filename.endsWith(".pdf")).toBe(true);
    const slug = filename.replace(/^certificate-/, "").replace(/\.pdf$/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});
