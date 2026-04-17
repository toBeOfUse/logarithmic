# Backend

The backend will be a Typescript app that uses Bun as its runtime, Fastify as the HTTP framework, MikroORM as the database framework, and tRPC as the API framework. The database should use SQLite. The API should be tested using Vitest.

## Users & Access Model

Auth should be handled by Better Auth in stateless mode (with no database setup.) For now, only local email-and-password accounts will be supported, with verification of emails not required.

By default, a user cannot access a workspace or any data belonging to a workspace. However, if a user creates a workspace (which any user can do), they are recorded as that workspace's owner and have full access to it. The ability for users to access other users' workspaces may be added as a feature in the future.

An anonymous account is created for a user the first time that they create a workspace. This anonymous account should be converted into a full account when they sign up.
