/**
 * Tolerant extraction of the latest assistant reply from `getSessionMessages`.
 * The public API returns `unknown[]`; OpenClaw emits at least two shapes:
 *   - { role: "assistant", content: string }
 *   - { role: "assistant", content: Array<{ type: "text", text: string } | unknown> }
 * Skips malformed/empty entries and walks backward to the most recent usable
 * assistant message.
 */
export function extractLatestAssistantReply(messages: readonly unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = tryExtractAssistantText(messages[i]);
    if (text !== undefined) return text;
  }
  return undefined;
}

function tryExtractAssistantText(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const obj = entry as Record<string, unknown>;
  if (obj["role"] !== "assistant") return undefined;
  const content = obj["content"];
  if (typeof content === "string") {
    return content.length > 0 ? content : undefined;
  }
  if (Array.isArray(content)) {
    const pieces: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b["type"] === "text" && typeof b["text"] === "string" && b["text"].length > 0) {
        pieces.push(b["text"]);
      }
    }
    return pieces.length > 0 ? pieces.join("") : undefined;
  }
  return undefined;
}
