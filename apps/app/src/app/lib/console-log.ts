/**
 * Dev-only `console` traces (Vite `import.meta.env.DEV`).
 * Use a short `scope` prefix (e.g. `provider-auth`) — never log secrets.
 */
export const ConsoleLog = {
  log(scope: string, ...args: unknown[]) {
    if (!import.meta.env.DEV) return;
    console.log(`[${scope}]`, ...args);
  },
};
