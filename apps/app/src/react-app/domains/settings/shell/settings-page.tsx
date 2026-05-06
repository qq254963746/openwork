/** @jsxImportSource react */
import type * as React from "react";
import {
  Bug,
  Cog,
  Paintbrush,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import {
  SettingsContent,
  SettingsPanel,
  SettingsPanelDescription,
  SettingsPanelHeading,
  SettingsPanelTitle,
} from "./panel";

export function getSettingsTabIcon(tab: SettingsTab) {
  switch (tab) {
    case "skills":
      return Sparkles;
    case "extensions":
      return Puzzle;
    case "environment":
      return Terminal;
    case "advanced":
      return Wrench;
    case "appearance":
      return Paintbrush;
    case "recovery":
      return ShieldCheck;
    case "debug":
      return Bug;
    default:
      return Cog;
  }
}

export function getSettingsTabLabel(tab: SettingsTab) {
  switch (tab) {
    case "skills":
      return t("settings.tab_skills");
    case "extensions":
      return t("settings.tab_extensions");
    case "environment":
      return t("settings.tab_environment");
    case "advanced":
      return t("settings.tab_advanced");
    case "appearance":
      return t("settings.tab_appearance");
    case "recovery":
      return t("settings.tab_recovery");
    case "debug":
      return t("settings.tab_debug");
    default:
      return t("settings.tab_general");
  }
}

export function getSettingsTabDescription(tab: SettingsTab) {
  switch (tab) {
    case "skills":
      return t("settings.tab_description_skills");
    case "extensions":
      return t("settings.tab_description_extensions");
    case "environment":
      return t("settings.tab_description_environment");
    case "advanced":
      return t("settings.tab_description_advanced");
    case "appearance":
      return t("settings.tab_description_appearance");
    case "recovery":
      return t("settings.tab_description_recovery");
    case "debug":
      return t("settings.tab_description_debug");
    default:
      return t("settings.tab_description_general");
  }
}

export function getWorkspaceSettingsTabs(): SettingsTab[] {
  return ["general", "skills", "extensions", "advanced"];
}

export function getGlobalSettingsTabs(developerMode: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = ["appearance", "environment", "recovery"];
  if (developerMode) tabs.push("debug");
  return tabs;
}

type SettingsPageProps = {
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  children: React.ReactNode;
};

export function SettingsPage(props: SettingsPageProps) {
  const workspaceTabs = getWorkspaceSettingsTabs();
  const globalTabs = getGlobalSettingsTabs(props.developerMode);

  return (
    <SidebarProvider className="relative min-h-full min-w-0">
        <Sidebar collapsible="none" className="absolute inset-0">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{t("settings.group_workspace")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {workspaceTabs.map((tab) => {
                    const Icon = getSettingsTabIcon(tab);
                    return (
                      <SidebarMenuItem key={tab}>
                        <SidebarMenuButton
                          type="button"
                          isActive={props.activeTab === tab}
                          onClick={() => props.onSelectTab(tab)}
                        >
                          <Icon />
                          <span>{getSettingsTabLabel(tab)}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>{t("settings.group_global")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {globalTabs.map((tab) => {
                    const Icon = getSettingsTabIcon(tab);
                    return (
                      <SidebarMenuItem key={tab}>
                        <SidebarMenuButton
                          type="button"
                          isActive={props.activeTab === tab}
                          onClick={() => props.onSelectTab(tab)}
                        >
                          <Icon />
                          <span>{getSettingsTabLabel(tab)}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="h-full min-w-0 w-full max-w-full overflow-hidden">
        <SettingsContent>
          <SettingsPanel>
            <SettingsPanelHeading>
              <SettingsPanelTitle>{getSettingsTabLabel(props.activeTab)}</SettingsPanelTitle>
              <SettingsPanelDescription>{getSettingsTabDescription(props.activeTab)}</SettingsPanelDescription>
            </SettingsPanelHeading>
          </SettingsPanel>

          {props.children}
        </SettingsContent>
        </SidebarInset>
    </SidebarProvider>
  );
}
