import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import { Workspace } from "./Workspace.js";

const UserSchema = defineEntity({
  name: "User",
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    email: p.string().unique().nullable(),
    passwordHash: p.string().nullable(),
    emailVerified: p.boolean().default(false),
    isAnonymous: p.boolean().default(false),
    workspaces: () => p.oneToMany(Workspace).mappedBy("owner"),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export class User extends UserSchema.class {}
UserSchema.setClass(User);
