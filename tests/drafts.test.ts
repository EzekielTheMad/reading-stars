import { test } from "node:test";
import assert from "node:assert/strict";
import { draftSchema, quizSchema } from "../shared/schema.ts";
import { quiz } from "./fixtures.ts";
test("partial parent drafts can be saved but cannot be published", () => {
  const partial = structuredClone(quiz);
  partial.questions[1].prompt = "";
  partial.questions[1].options = ["", "", "", ""];
  partial.questions[1].explanation = "";
  partial.questions[1].reference = "";
  partial.discussion = "";
  assert.equal(draftSchema.safeParse(partial).success, true);
  assert.equal(quizSchema.safeParse(partial).success, false);
});
