import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendEnvPath = resolve(backendRoot, ".env");

config();
if (existsSync(backendEnvPath)) config({ path: backendEnvPath, override: false });
