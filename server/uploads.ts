import { unzipSync, strFromU8 } from "fflate";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 240000;
const decode = (s: string) =>
  s
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, c: string) =>
      String.fromCodePoint(
        Number.parseInt(
          c.startsWith("x") ? c.slice(1) : c,
          c.startsWith("x") ? 16 : 10,
        ),
      ),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
const strip = (s: string) =>
  decode(
    s
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const attr = (s: string, name: string) =>
  new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(s)?.[1] || "";

export async function extractUpload(buffer: Buffer, originalName: string) {
  const warnings: string[] = [];
  let text = "",
    mime = "",
    kind = "book",
    extension = "";
  if (buffer.subarray(0, 5).toString() === "%PDF-") {
    mime = "application/pdf";
    extension = ".pdf";
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
      standardFontDataUrl:
        path
          .join(
            path.dirname(
              fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
            ),
            "standard_fonts",
          )
          .replaceAll("\\", "/") + "/",
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 500)
        throw new Error("Please use a PDF with 500 pages or fewer.");
      let sparse = 0;
      for (let page = 1; page <= doc.numPages; page++) {
        const p = await doc.getPage(page);
        const content = await p.getTextContent();
        const line = content.items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ");
        if (line.trim().length < 60) sparse++;
        text += `\n[Page ${page}] ${line}\n`;
        p.cleanup();
        if (text.length > LIMIT) {
          warnings.push(
            "Text exceeds the preparation limit; later pages were not extracted. Use additional source notes to cover the ending.",
          );
          break;
        }
      }
      if (sparse > doc.numPages * 0.25)
        warnings.push(
          "This PDF is scanned or picture-heavy. Extracted text does not capture everything; check the pictures and all questions yourself.",
        );
    } finally {
      await task.destroy();
    }
  } else if (
    /\.epub$/i.test(originalName) &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    mime = "application/epub+zip";
    extension = ".epub";
    let total = 0;
    const files = unzipSync(buffer, {
      filter: (file) => {
        if (!/\.(?:opf|xml|xhtml|html|htm)$|^mimetype$/i.test(file.name))
          return false;
        total += file.originalSize;
        if (file.originalSize > 4 * 1024 * 1024 || total > 16 * 1024 * 1024)
          throw new Error("The expanded EPUB is too large.");
        return true;
      },
    });
    if (
      !files.mimetype ||
      strFromU8(files.mimetype).trim() !== "application/epub+zip"
    )
      throw new Error("This file is not a valid EPUB.");
    if (files["META-INF/encryption.xml"])
      throw new Error(
        "Encrypted EPUBs are not supported. Use an unencrypted copy or enter book details.",
      );
    const container = strFromU8(
      files["META-INF/container.xml"] || new Uint8Array(),
    );
    const opfPath = /full-path=["']([^"']+)["']/.exec(container)?.[1];
    if (!opfPath || !files[opfPath])
      throw new Error(
        "Cannot find the EPUB reading order. Enter book details or use a different copy.",
      );
    const opf = strFromU8(files[opfPath]);
    const manifest = new Map<string, string>();
    for (const match of opf.matchAll(/<item\b[^>]*>/g))
      manifest.set(attr(match[0], "id"), attr(match[0], "href"));
    const spine = [...opf.matchAll(/<itemref\b[^>]*>/g)].map((m) =>
      attr(m[0], "idref"),
    );
    if (!spine.length) throw new Error("This EPUB has no readable chapters.");
    for (const [index, id] of spine.entries()) {
      const href = manifest.get(id);
      const file =
        href &&
        files[
          path.posix.normalize(
            path.posix.join(
              path.posix.dirname(opfPath),
              decodeURIComponent(href.split("#")[0]),
            ),
          )
        ];
      if (!file) {
        warnings.push(
          `Section ${index + 1} is missing; confirm story coverage before approving a quiz.`,
        );
        continue;
      }
      const section = strip(strFromU8(file));
      text += `\n[Section ${index + 1}] ${section}\n`;
      if (section.length < 60)
        warnings.push(
          `Section ${index + 1} has little readable text; illustrations may carry the story.`,
        );
      if (text.length > LIMIT) {
        warnings.push(
          "Only the beginning fits the preparation limit. Add notes covering the rest before approval.",
        );
        break;
      }
    }
  } else if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    kind = "cover";
    mime = "image/png";
    extension = ".png";
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    kind = "cover";
    mime = "image/jpeg";
    extension = ".jpg";
  } else if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  ) {
    kind = "cover";
    mime = "image/webp";
    extension = ".webp";
  } else
    throw new Error(
      "Use a PDF, unencrypted EPUB, or PNG/JPEG/WebP cover image.",
    );
  if (kind === "cover" && buffer.length > 5 * 1024 * 1024)
    throw new Error("Cover images must be 5 MB or smaller.");
  if (kind === "book" && text.trim().length < 200)
    warnings.push(
      "There is not enough text for a reliable automatic quiz. Find a study guide or enter questions manually.",
    );
  return {
    text: text.slice(0, LIMIT),
    warnings: [...new Set(warnings)],
    mime,
    kind,
    extension,
  };
}
