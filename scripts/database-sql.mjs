// Apply a reviewed SQL file using the existing Supabase CLI login. Never prints credentials.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  token = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (token.startsWith("go-keyring-base64:")) token = Buffer.from(token.slice("go-keyring-base64:".length), "base64").toString();
}
const query = fs.readFileSync(process.argv[2], "utf8");
const response = await fetch("https://api.supabase.com/v1/projects/opqzcdukaaoejrvtzdum/database/query", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000),
});
console.log(response.status, await response.text());
if (!response.ok) process.exitCode = 1;
