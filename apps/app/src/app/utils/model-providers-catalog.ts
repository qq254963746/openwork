/**
 * Built-in model provider presets for the Connect provider flow.
 * Keys are used as OpenCode `providerID` for preset entries.
 */
export type ModelProviderType = "openai" | "openai-compatible" | "anthropic" | "google";

/** Selectable provider kinds for custom endpoints (same labels as OpenCode SDK families). */
export const DEFAULT_MODEL_PROVIDER_TYPES = [
  "openai",
  "openai-compatible",
  "anthropic",
  "google",
] as const satisfies readonly ModelProviderType[];

export const DEFAULT_CUSTOM_MODEL_PROVIDER_TYPE: ModelProviderType = "openai-compatible";

export function isModelProviderType(value: string): value is ModelProviderType {
  return (DEFAULT_MODEL_PROVIDER_TYPES as readonly string[]).includes(value);
}

/** `@ai-sdk/*` npm package name for global `opencode.json` `provider.<id>.npm` when connecting custom providers. */
export function npmSdkPackageForProviderType(type: ModelProviderType): string {
  switch (type) {
    case "openai":
      return "@ai-sdk/openai";
    case "openai-compatible":
      return "@ai-sdk/openai-compatible";
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "google":
      return "@ai-sdk/google";
  }
}

export type ModelProviderPreset = {
  name: string;
  baseUrl: string;
  /** Inline SVG markup for list/detail icons */
  icon: string;
  /** Wire protocol / SDK family for model listing and config. */
  providerType: ModelProviderType;
};

export const AIWORK_CUSTOM_PROVIDER_ENTRY_KEY = "__aiwork_custom__";

export const MODEL_PROVIDER_PRESETS: Record<string, ModelProviderPreset> = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    providerType: "openai",
    icon:
      '<svg fill="currentColor" fill-rule="evenodd" height="28" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg"><title>OpenAI</title><path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z"></path></svg>',
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    providerType: "anthropic",
    icon:
      '<svg fill="currentColor" fill-rule="evenodd" height="28" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg"><title>Anthropic</title><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z"></path></svg>',
  },
  google: {
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    providerType: "google",
    icon:
      '<svg fill="currentColor" fill-rule="evenodd" height="28" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg"><title>Gemini</title><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"></path></svg>',
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    providerType: "openai-compatible",
    icon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 26" fill="none"><g><path fill="currentColor" d="M33.615 2.598c-.36-.176-.515.16-.726.33-.072.055-.132.127-.193.193-.526.562-1.14.93-1.943.887-1.174-.067-2.176.302-3.062 1.2-.188-1.107-.814-1.767-1.766-2.191-.498-.22-1.002-.441-1.35-.92-.244-.341-.31-.721-.433-1.096-.077-.226-.154-.457-.415-.496-.282-.044-.393.193-.504.391-.443.81-.614 1.702-.598 2.605.04 2.033.898 3.652 2.603 4.803.193.132.243.264.182.457-.116.397-.254.782-.376 1.179-.078.253-.194.308-.465.198-.936-.391-1.744-.97-2.458-1.669-1.213-1.173-2.31-2.467-3.676-3.48a16.254 16.254 0 0 0-.975-.668c-1.395-1.354.183-2.467.548-2.599.382-.138.133-.612-1.102-.606-1.234.005-2.364.42-3.803.97a4.34 4.34 0 0 1-.66.193 13.577 13.577 0 0 0-4.08-.143c-2.667.297-4.799 1.558-6.365 3.712C.116 8.436-.327 11.378.215 14.444c.57 3.233 2.22 5.91 4.755 8.002 2.63 2.17 5.658 3.233 9.113 3.03 2.098-.122 4.434-.403 7.07-2.633.664.33 1.362.463 2.518.562.892.083 1.75-.044 2.414-.182 1.04-.22.97-1.184.593-1.36-3.05-1.421-2.38-.843-2.99-1.311 1.55-1.834 3.918-5.093 4.648-9.531.072-.49.164-1.18.153-1.577-.006-.242.05-.336.326-.364a5.903 5.903 0 0 0 2.187-.672c1.977-1.08 2.774-2.853 2.962-4.978.028-.325-.006-.661-.35-.832ZM16.39 21.73c-2.956-2.324-4.39-3.089-4.982-3.056-.554.033-.454.667-.332 1.08.127.407.293.688.526 1.046.16.237.271.59-.161.854-.952.589-2.607-.198-2.685-.237-1.927-1.134-3.537-2.632-4.673-4.68-1.096-1.972-1.733-4.087-1.838-6.345-.028-.545.133-.738.676-.837A6.643 6.643 0 0 1 5.086 9.5c3.017.441 5.586 1.79 7.74 3.927 1.229 1.217 2.159 2.671 3.116 4.092 1.02 1.509 2.115 2.946 3.51 4.125.494.413.887.727 1.263.958-1.135.127-3.028.154-4.324-.87v-.002Zm1.417-9.114a.434.434 0 0 1 .587-.408c.06.022.117.055.16.105a.426.426 0 0 1 .122.303.434.434 0 0 1-.437.435.43.43 0 0 1-.432-.435Zm4.402 2.257c-.283.116-.565.215-.836.226-.421.022-.88-.149-1.13-.358-.387-.325-.664-.506-.78-1.073-.05-.242-.022-.617.022-.832.1-.463-.011-.76-.338-1.03-.265-.22-.603-.28-.974-.28a.8.8 0 0 1-.36-.11c-.155-.078-.283-.27-.161-.508.039-.077.227-.264.271-.297.504-.286 1.085-.193 1.623.022.498.204.875.578 1.417 1.107.553.639.653.815.968 1.295.25.374.476.76.632 1.2.094.275-.028.5-.354.638Z"></path></g></svg>',
  },
};

const PRESET_KEYS = Object.keys(MODEL_PROVIDER_PRESETS);

export function listModelProviderPresetKeys(): string[] {
  return [...PRESET_KEYS];
}

export function getModelProviderPreset(key: string): ModelProviderPreset | undefined {
  const k = key.trim();
  const lower = k.toLowerCase();
  return MODEL_PROVIDER_PRESETS[k] ?? MODEL_PROVIDER_PRESETS[lower];
}

/** Resolve SDK/wire kind for connect + model listing from catalog presets or explicit UI choice. */
export function resolveModelProviderTypeForConnect(args: {
  providerId: string;
  presetCode: string;
  explicit?: string | undefined;
}): ModelProviderType {
  const exp = args.explicit?.trim();
  if (exp && isModelProviderType(exp)) return exp;
  const pc = args.presetCode.trim();
  const byPresetCode =
    pc && pc !== AIWORK_CUSTOM_PROVIDER_ENTRY_KEY ? getModelProviderPreset(pc) : undefined;
  const byId = getModelProviderPreset(args.providerId.trim());
  return byPresetCode?.providerType ?? byId?.providerType ?? DEFAULT_CUSTOM_MODEL_PROVIDER_TYPE;
}
