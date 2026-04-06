import test from "node:test";
import assert from "node:assert/strict";

import { parseStructuredOutput } from "../plugins/gemini/scripts/lib/gemini.mjs";
import {
  renderReviewResult,
  renderStoredJobResult,
} from "../plugins/gemini/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine.",
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine.",
      }),
      parseError: null,
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff",
    },
  );

  assert.match(output, /^# Gemini Adversarial Review/m);
  assert.match(
    output,
    /Gemini returned JSON with an unexpected review shape\./,
  );
  assert.match(output, /Validation error: Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured Gemini review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Gemini Adversarial Review",
      jobClass: "review",
      threadId: "thr_123",
      resumeToken: "latest",
      providerId: "gemini",
    },
    {
      providerId: "gemini",
      threadId: "thr_123",
      resumeToken: "latest",
      rendered:
        "# Gemini Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: [],
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}',
      },
    },
  );

  assert.match(output, /^# Gemini Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Session ID: thr_123/);
  assert.match(output, /Resume: gemini --resume latest/);
});

test("renderStoredJobResult keeps legacy Gemini resume hints when provider metadata says gemini", () => {
  const output = renderStoredJobResult(
    {
      id: "review-legacy",
      status: "completed",
      title: "Gemini Adversarial Review",
      jobClass: "review",
      threadId: "latest",
      providerId: "gemini",
    },
    {
      providerId: "gemini",
      threadId: "latest",
      rendered:
        "# Gemini Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
    },
  );

  assert.match(output, /^# Gemini Adversarial Review/);
  assert.match(output, /Session ID: latest/);
  assert.match(output, /Resume: gemini --resume latest/);
});

test("parseStructuredOutput accepts fenced json emitted by Gemini", () => {
  const parsed = parseStructuredOutput(
    [
      "```json",
      '{"verdict":"needs-attention","summary":"Do not ship.","findings":[],"next_steps":[]}',
      "```",
    ].join("\n"),
  );

  assert.equal(parsed.parseError, null);
  assert.deepEqual(parsed.parsed, {
    verdict: "needs-attention",
    summary: "Do not ship.",
    findings: [],
    next_steps: [],
  });
});

test("renderReviewResult accepts fenced json without falling back to parse-error output", () => {
  const parsed = parseStructuredOutput(
    [
      "Here's the review result:",
      "",
      "```json",
      '{"verdict":"needs-attention","summary":"Do not ship.","findings":[],"next_steps":["Fix the ABI drift."]}',
      "```",
    ].join("\n"),
  );

  const output = renderReviewResult(parsed, {
    reviewLabel: "Adversarial Review",
    targetLabel: "working tree diff",
  });

  assert.doesNotMatch(output, /did not return valid structured JSON/i);
  assert.match(output, /^# Gemini Adversarial Review/m);
  assert.match(output, /Verdict: needs-attention/);
  assert.match(output, /\nDo not ship\.\n/);
  assert.match(output, /Next steps:/);
});
