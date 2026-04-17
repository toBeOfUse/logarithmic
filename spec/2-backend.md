# Backend

The backend will be a fairly basic CRUD Typescript server. It will use Node.js as its runtime, Fastify as the HTTP framework, MikroORM as the database framework (https://mikro-orm.io/llms.txt), and tRPC as the API framework. The database should use SQLite. The API should be tested using Vitest. Things related to security and privacy should be thoroughly tested with `fetch` calls to simulate an attacker.

Types for API models should be built on MikrORM DTOs using TypeScript utility types like `Pick<>`. The API models should be based on what will be useful for operations, and the operations should be based on the common read/write operations for users: for example, listing all of the users' workspaces for the splash screen or all of the leaflets in a workspace for the organizational view (which should not involve downloading all of the data for those entities), or updating the rich text content for a specific leaflet (which is common enough that it probably should have its own API endpoint.)

## Users & Access Model

Auth should be handled by Better Auth (https://better-auth.com/llms.txt) in stateless mode (with no database setup.) For now, only local email-and-password accounts will be supported, with verification of emails not required.

By default, a user cannot access a workspace or any data belonging to a workspace. However, if a user creates a workspace (which any user can do), they are recorded as that workspace's owner and have full access to it. The ability for users to access other users' workspaces may be added as a feature in the future.

An anonymous account is created for a user the first time that they create a workspace. This anonymous account should be converted into a full account when they sign up.
