import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { v4 as uuidv4 } from "uuid";

import { Logbook } from "./Logbook.ts";

/**
 * A bearer-style access grant to a single logbook. The token presented by the
 * client is the row id followed by a `.` and a high-entropy secret; only the
 * bcrypt(salted) hash of the secret is stored, so a database leak does not
 * expose live credentials.
 */
const LogbookTokenSchema = defineEntity({
  name: "LogbookToken",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => uuidv4()),
    logbook: () => p.oneToOne(Logbook),
    /** bcryptjs hash of the secret half of the token. Salt is embedded. */
    hash: p.string(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export class LogbookToken extends LogbookTokenSchema.class {}
LogbookTokenSchema.setClass(LogbookToken);

export type ILogbookToken = InferEntity<typeof LogbookToken>;
