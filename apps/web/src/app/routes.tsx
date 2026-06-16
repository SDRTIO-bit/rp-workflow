import type { ReactNode } from "react";
import { ResourcesPage } from "../pages/ResourcesPage";
import { RpPage } from "../pages/RpPage";
import { WorkbenchPage } from "../pages/WorkbenchPage";

export type AppRoute = "/rp" | "/workbench" | "/resources";

export const routes: Array<{ path: AppRoute; label: string; element: ReactNode }> = [
  { path: "/rp", label: "RP", element: <RpPage /> },
  { path: "/workbench", label: "Workbench", element: <WorkbenchPage /> },
  { path: "/resources", label: "Resources", element: <ResourcesPage /> },
];

export const normalizeRoute = (path: string): AppRoute => {
  if (path.startsWith("/workbench")) return "/workbench";
  if (path.startsWith("/resources")) return "/resources";
  return "/rp";
};
