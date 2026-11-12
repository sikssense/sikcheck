import { readFileSync } from "node:fs";
import path from "node:path";

// .env를 매번 새로 읽는다. 키를 바꿔도 서버를 다시 켤 필요가 없게.
export function readEnv(): Record<string, string> {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}
