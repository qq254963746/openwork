export const denSessionUpdatedEvent = "aiwork-den-session-updated";
export const denSettingsChangedEvent = "aiwork-den-settings-changed";

/** Persisted hosted-app connection targets + optional session/org ids (localStorage). */
export type HostedAppConnectionSettings = {
  baseUrl: string;
  apiBaseUrl?: string;
  authToken?: string | null;
  activeOrgId?: string | null;
  activeOrgSlug?: string | null;
  activeOrgName?: string | null;
};

export type HostedAppUser = {
  id: string;
  email: string;
  name: string | null;
};

export type DenSessionUpdatedDetail = {
  status?: "success" | "error";
  baseUrl?: string | null;
  token?: string | null;
  user?: HostedAppUser | null;
  email?: string | null;
  message?: string | null;
};

export function dispatchDenSessionUpdated(detail: DenSessionUpdatedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DenSessionUpdatedDetail>(denSessionUpdatedEvent, {
      detail,
    }),
  );
}

export type DenSettingsChangedDetail = {
  settings: HostedAppConnectionSettings;
};

export function dispatchDenSettingsChanged(detail: DenSettingsChangedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DenSettingsChangedDetail>(denSettingsChangedEvent, {
      detail,
    }),
  );
}
