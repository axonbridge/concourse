import { defineConfig } from "drizzle-kit";
import * as path from "node:path";
import * as os from "node:os";

const userData =
  process.env.MC_USER_DATA_DIR ||
  path.join(
    os.homedir(),
    process.platform === "darwin"
      ? "Library/Application Support/Concourse"
      : process.platform === "win32"
        ? "AppData/Roaming/Concourse"
        : ".config/Concourse"
  );

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(userData, "concourse.db"),
  },
  strict: true,
  verbose: true,
});
