import { z } from "zod";

export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  prompt: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(400)).length(4),
  correct: z.number().int().min(0).max(3),
  skill: z.enum(["events", "cause", "motives", "inference"]),
  explanation: z.string().trim().min(3).max(1500),
  reference: z.string().trim().min(3).max(1500),
});
export const quizSchema = z
  .object({
    questions: z.array(questionSchema).min(5).max(20),
    discussion: z.string().trim().min(5).max(1500),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.questions.map((q) => q.id)).size !== v.questions.length)
      ctx.addIssue({ code: "custom", message: "Question IDs must be unique." });
    v.questions.forEach((q, i) => {
      if (new Set(q.options.map((o) => o.toLowerCase())).size !== 4)
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "options"],
          message: "Each answer choice must be different.",
        });
    });
  });
export type Question = z.infer<typeof questionSchema>;
export type Quiz = z.infer<typeof quizSchema>;
// Drafts may be unfinished. Publishing always uses the stricter quizSchema.
export const draftSchema = z
  .object({
    questions: z
      .array(
        questionSchema.extend({
          prompt: z.string().max(1000),
          options: z.array(z.string().max(400)).length(4),
          explanation: z.string().max(1500),
          reference: z.string().max(1500),
        }),
      )
      .min(5)
      .max(20),
    discussion: z.string().max(1500),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.questions.map((q) => q.id)).size !== v.questions.length)
      ctx.addIssue({ code: "custom", message: "Question IDs must be unique." });
    v.questions.forEach((q, i) => {
      if (
        q.options.every((o) => o.trim()) &&
        new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 4
      )
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "options"],
          message: "Each answer choice must be different.",
        });
    });
  });
export const childSchema = z.object({
  name: z.string().trim().min(1).max(40),
  age: z.number().int().min(3).max(18),
  profile: z.string().trim().max(2000),
  confidence: z.string().trim().max(1000),
  color: z.enum(["green", "orange", "blue", "purple"]).default("green"),
});
export const bookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(150),
  isbn: z.string().trim().max(30).default(""),
  edition: z.string().trim().max(150).default(""),
  format: z
    .enum(["graphic", "early", "chapter", "nonfiction"])
    .default("graphic"),
  pages: z.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(100000).default(""),
  confirmed: z.boolean().default(false),
});
export type BookInput = z.infer<typeof bookSchema>;
export type Effort = "easy" | "comfortable" | "stretch";
