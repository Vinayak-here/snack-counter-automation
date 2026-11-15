import type { OfficeId } from "../domain/types.js";

/** The internal chat tool, seen from our side. Real version: a bot in the company chat. */
export interface ChatPort {
  /** A private message to one person. */
  sendDirect(employeeId: string, text: string): Promise<void>;
  /** A message in the office's snack channel. */
  postToOffice(officeId: OfficeId, text: string): Promise<void>;
}
