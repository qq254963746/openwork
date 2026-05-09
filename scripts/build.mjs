import { execSync } from "node:child_process";

const isVercel = Boolean(process.env.VERCEL);
const command = isVercel
  ? "pnpm --filter @openwork/app build"
  : "pnpm --filter @openwork/desktop build";

execSync(command, { stdio: "inherit" });
