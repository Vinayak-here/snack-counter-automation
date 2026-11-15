import type { Volunteer } from "../domain/types.js";
import type { VolunteerDirectory } from "../ports/volunteerDirectory.js";

export class InMemoryVolunteerDirectory implements VolunteerDirectory {
  private readonly people = new Map<string, Volunteer>();

  constructor(initial: Volunteer[] = []) {
    for (const v of initial) this.people.set(v.employeeId, { ...v });
  }

  async listAll(): Promise<Volunteer[]> {
    return [...this.people.values()].map((v) => ({ ...v }));
  }

  /** Change someone's presence, office or opt-out, e.g. "on holiday", "visiting Oslo". */
  update(employeeId: string, changes: Partial<Omit<Volunteer, "employeeId">>): void {
    const v = this.people.get(employeeId);
    if (!v) throw new Error(`Unknown volunteer ${employeeId}`);
    this.people.set(employeeId, { ...v, ...changes });
  }
}
