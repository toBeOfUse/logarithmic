/**
 * Primary-key generation shared between the backend (Logbook/Entry rows) and
 * the frontend (in-memory demo store, route-segment parsing). Centralising the
 * length here means the parser that strips an ID out of a `${slug}-${id}`
 * route segment is guaranteed to use the same length the backend produced.
 */
import { nanoid } from "nanoid";

/** Length in characters of every generated logbook/entry ID. */
export const ID_LEN = 10;

/** Generate a fresh ID using the shared length. */
export function newId(): string {
  return nanoid(ID_LEN);
}
