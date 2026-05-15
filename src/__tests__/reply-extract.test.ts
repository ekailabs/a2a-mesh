import { describe, expect, it } from "vitest";
import { extractLatestAssistantReply } from "../reply-extract.js";

describe("extractLatestAssistantReply", () => {
  it("returns string content directly", () => {
    expect(
      extractLatestAssistantReply([{ role: "assistant", content: "hello" }]),
    ).toBe("hello");
  });

  it("concatenates text blocks in array content", () => {
    expect(
      extractLatestAssistantReply([
        {
          role: "assistant",
          content: [
            { type: "text", text: "hello " },
            { type: "image", url: "..." },
            { type: "text", text: "world" },
          ],
        },
      ]),
    ).toBe("hello world");
  });

  it("walks backward past trailing non-assistant messages", () => {
    const messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "answer-1" },
      { role: "user", content: "follow-up" },
      { role: "system", content: "noise" },
    ];
    expect(extractLatestAssistantReply(messages)).toBe("answer-1");
  });

  it("returns undefined when no assistant message exists", () => {
    expect(
      extractLatestAssistantReply([{ role: "user", content: "q" }]),
    ).toBeUndefined();
  });

  it("returns undefined for malformed content (number, null, empty)", () => {
    expect(
      extractLatestAssistantReply([
        { role: "assistant", content: null },
        { role: "assistant", content: 42 },
        { role: "assistant", content: "" },
        { role: "assistant", content: [] },
        { role: "assistant", content: [{ type: "image", url: "x" }] },
      ]),
    ).toBeUndefined();
  });

  it("prefers the latest valid assistant message and skips malformed ones in front", () => {
    const messages = [
      { role: "assistant", content: "first" },
      { role: "assistant", content: null },
    ];
    expect(extractLatestAssistantReply(messages)).toBe("first");
  });
});
