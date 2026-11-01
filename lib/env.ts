// Loads the repo's git-ignored .env into process.env (without overriding
// values already set). Never logs values.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = join(REPO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value !== "" && process.env[key] === undefined) process.env[key] = value;
  }
}

export function hasJevKey(): boolean {
  loadEnv();
  return (process.env.TYPESAFE_API_KEY ?? "").trim() !== "";
}

export type Player = "regular" | "jev";
/** Bridge port per player: regular 8889, jev 8890 (8888 is left for Grok Bot). */
export function playerPort(player: Player): number {
  loadEnv();
  const v = player === "regular" ? process.env.REGULAR_PORT : process.env.JEV_PORT;
  return Number(v ?? (player === "regular" ? 8889 : 8890));
}
