import { execSync } from "node:child_process";

const isVercel = Boolean(process.env.VERCEL);
const command = isVercel
  ? "pnpm --filter @aiwork/app build"
  : "pnpm --filter @aiwork/desktop build";

execSync(command, { stdio: "inherit" });
