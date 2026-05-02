import { defineConfig } from "drizzle-kit";

// Drizzle Kit config used to GENERATE D1 migrations from `src/lib/db/schema.ts`.
// Run `npm run db:generate` after schema changes to produce SQL files in
// `drizzle/migrations/`. Apply via `npm run db:migrate:local` or `:remote`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
});
