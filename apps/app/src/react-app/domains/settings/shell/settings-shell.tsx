/** @jsxImportSource react */
import type { CSSProperties } from "react";
import type * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isElectronRuntime, isTauriRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { SettingsPage, getSettingsTabLabel } from "./settings-page";
import { WorkspaceSessionList } from "../../session/sidebar/workspace-session-list";

type SettingsPageChromeProps = Omit<React.ComponentProps<typeof SettingsPage>, "children">;

export type SettingsShellProps = SettingsPageChromeProps & {
  selectedWorkspaceName: string;
  headerStatus?: string;
  busyHint?: string | null;
  workspaceSessionListProps: React.ComponentProps<typeof WorkspaceSessionList>;
  onClose: () => void;
  sidebarTopSlot?: React.ReactNode;
  headerLeadingSlot?: React.ReactNode;
  sidebarWidth?: number;
  onSidebarResizeStart?: React.PointerEventHandler<HTMLDivElement>;
  children: React.ReactNode;
  error?: string | null;
  errorSlot?: React.ReactNode;
  modalSlot?: React.ReactNode;
  footer?: React.ReactNode;
};

export function SettingsShell(props: SettingsShellProps) {
  const title = getSettingsTabLabel(props.activeTab);

  return (
    <div className="flex h-[100dvh] min-h-screen w-full flex-col overflow-hidden bg-[var(--dls-app-bg)] text-gray-12">
      <div className="flex min-h-0 flex-1 gap-0">
        <aside
          className="relative hidden min-h-0 shrink-0 flex-col overflow-hidden border-0 border-r border-dls-border bg-dls-sidebar lg:flex lg:flex-col"
          style={props.sidebarWidth ? { width: `${props.sidebarWidth}px`, minWidth: `${props.sidebarWidth}px` } : undefined}
        >
          {props.sidebarTopSlot ? <div className="shrink-0">{props.sidebarTopSlot}</div> : null}
          <div className="flex min-h-0 flex-1">
            <WorkspaceSessionList {...props.workspaceSessionListProps} />
          </div>
          {props.onSidebarResizeStart ? (
            <div
              className="absolute right-0 top-0 hidden h-full w-2 translate-x-1/2 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-gray-6/40 md:block"
              onPointerDown={props.onSidebarResizeStart}
              title={t("session.resize_workspace_column")}
              aria-label={t("session.resize_workspace_column")}
            />
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-dls-surface">
          <header
            className="shrink-0 flex h-12 items-center justify-between border-b border-dls-border bg-dls-surface px-4 md:px-6"
            {...(isTauriRuntime() ? ({ "data-tauri-drag-region": true } as const) : {})}
            style={
              isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                ? ({ WebkitAppRegion: "drag" } satisfies CSSProperties)
                : undefined
            }
          >
            <div className="flex min-w-0 items-center gap-3">
              {props.headerLeadingSlot}
              <h1 className="truncate text-[15px] font-semibold text-dls-text">{title}</h1>
              <span className="hidden truncate text-[13px] text-dls-secondary lg:inline">
                {props.selectedWorkspaceName}
              </span>
              {props.developerMode && props.headerStatus ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.headerStatus}
                </span>
              ) : null}
              {props.busyHint ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.busyHint}
                </span>
              ) : null}
            </div>
            <div
              className="flex items-center text-gray-10"
              style={
                isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                  ? ({ WebkitAppRegion: "no-drag" } satisfies CSSProperties)
                  : undefined
              }
            >
              <Button
                variant="ghost"
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-2/70 hover:text-dls-text"
                onClick={props.onClose}
                title={t("dashboard.close_settings")}
                aria-label={t("dashboard.close_settings")}
              >
                <X size={18} />
              </Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <SettingsPage {...props}>{props.children}</SettingsPage>

            {props.error ? (
              <div className="w-full px-6 pb-24 md:px-8 md:pb-10">
                <div className="flex flex-col gap-y-3 rounded-2xl border border-red-7/20 bg-red-1/40 px-5 py-4 text-sm text-red-12">
                  <div>{props.error}</div>
                  {props.errorSlot}
                </div>
              </div>
            ) : null}

            {props.modalSlot}
          </div>

          {props.footer}
        </main>
      </div>
    </div>
  );
}
