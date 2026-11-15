import type { OfficeId } from "../domain/types.js";
import type { ChatPort } from "../ports/chatPort.js";

export type SentMessage =
  | { kind: "direct"; to: string; text: string }
  | { kind: "office"; to: OfficeId; text: string };

/** Records every message instead of sending it, so tests can check what people would see. */
export class FakeChat implements ChatPort {
  readonly sent: SentMessage[] = [];

  async sendDirect(employeeId: string, text: string): Promise<void> {
    this.sent.push({ kind: "direct", to: employeeId, text });
  }

  async postToOffice(officeId: OfficeId, text: string): Promise<void> {
    this.sent.push({ kind: "office", to: officeId, text });
  }

  /** Messages one person received. */
  inboxOf(employeeId: string): string[] {
    return this.sent.filter((m) => m.kind === "direct" && m.to === employeeId).map((m) => m.text);
  }

  /** Messages posted in one office's channel. */
  channelOf(officeId: OfficeId): string[] {
    return this.sent.filter((m) => m.kind === "office" && m.to === officeId).map((m) => m.text);
  }
}
