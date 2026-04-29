import { defineEntity, p, type InferEntity } from "@mikro-orm/core";
import { v4 as uuidv4 } from "uuid";
import { Logbook } from "./Logbook.ts";

const UserSchema = defineEntity({
  name: "User",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => uuidv4()),
    email: p.string().nullable().unique(),
    isAnonymous: p.boolean().default(false),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
    ownedLogbooks: () => p.oneToMany(Logbook).mappedBy("owner"),
  },
});

export class User extends UserSchema.class {}
UserSchema.setClass(User);

export type IUser = InferEntity<typeof User>;
