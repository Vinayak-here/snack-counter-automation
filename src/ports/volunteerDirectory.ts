import type { Volunteer } from "../domain/types.js";

/** Who can volunteer, and where they are today. In real life: HR / company directory + chat status. */
export interface VolunteerDirectory {
  listAll(): Promise<Volunteer[]>;
}
