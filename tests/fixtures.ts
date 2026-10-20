import type { Quiz } from "../shared/schema.ts";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
export const coverFixture = () => readFileSync(new URL("./cover.png", import.meta.url));
export const story =
  "Mara carried a lantern to help her friend Leo find his way home before dark. At the bridge, a gust of wind blew out the lantern. Mara felt worried, but Leo noticed that the moonlight showed the stepping stones. They crossed slowly together. At home, they thanked each other and hung the lantern by the door. Mara learned that asking a friend for help can make a hard journey easier.";
export const quiz: Quiz = {
  questions: [
    {
      id: "why",
      prompt: "Why did Mara carry a lantern?",
      options: [
        "To help Leo find his way home",
        "To catch fish",
        "To decorate a tree",
        "To sell it",
      ],
      correct: 0,
      skill: "motives",
      explanation:
        "She wanted to help her friend find his way home before dark.",
      reference:
        "Section 1: Mara carried a lantern to help her friend Leo find his way home.",
    },
    {
      id: "wind",
      prompt: "What caused the lantern to go out?",
      options: [
        "A gust of wind",
        "A falling leaf",
        "A broken door",
        "A friendly cat",
      ],
      correct: 0,
      skill: "cause",
      explanation: "The wind blew out the lantern at the bridge.",
      reference: "Section 1: a gust of wind blew out the lantern.",
    },
    {
      id: "moon",
      prompt: "What helped them see the stepping stones?",
      options: ["Moonlight", "A car headlight", "A new lantern", "A campfire"],
      correct: 0,
      skill: "events",
      explanation: "Leo noticed the moonlight showed the stones.",
      reference:
        "Section 1: Leo noticed that the moonlight showed the stepping stones.",
    },
    {
      id: "cross",
      prompt: "How did Mara and Leo cross?",
      options: [
        "Slowly together",
        "Running separately",
        "By airplane",
        "On a bicycle",
      ],
      correct: 0,
      skill: "events",
      explanation: "They crossed slowly together.",
      reference: "Section 1: They crossed slowly together.",
    },
    {
      id: "learn",
      prompt: "What did Mara learn on her journey?",
      options: [
        "Asking a friend for help can make things easier",
        "Friends should never help",
        "Lanterns always work",
        "Rushing is always best",
      ],
      correct: 0,
      skill: "inference",
      explanation:
        "She learned that help from a friend makes a difficult journey easier.",
      reference:
        "Section 1: Mara learned that asking a friend for help can make a hard journey easier.",
    },
  ],
  discussion:
    "Tell me what changed when the lantern went out. Why did working together help? Listen for the wind, moonlight, and taking care while crossing.",
};
export function epubFixture() {
  return Buffer.from(
    zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      ),
      "OEBPS/content.opf": strToU8(
        '<package><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
      ),
      "OEBPS/one.xhtml": strToU8(`<html><body><p>${story}</p></body></html>`),
      "OEBPS/two.xhtml": strToU8(
        "<html><body><p>The end. This final section belongs after the story in the reading order. The friends were happy to be home.</p></body></html>",
      ),
    }),
  );
}
export function pdfFixture(text = story) {
  const stream = `BT /F1 12 Tf 30 750 Td (${text.replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
