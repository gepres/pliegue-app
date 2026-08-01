export type WorkspaceMode = "local-only" | "account";

export interface WorkspaceModeState {
  confirmedAt: string | null;
  mode: WorkspaceMode;
  version: 1;
}

export const defaultWorkspaceMode: WorkspaceModeState = {
  confirmedAt: null,
  mode: "local-only",
  version: 1,
};

export function parseWorkspaceMode(value: unknown): WorkspaceModeState {
  if (!value || typeof value !== "object") return defaultWorkspaceMode;

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || candidate.mode !== "local-only") {
    return defaultWorkspaceMode;
  }

  return {
    confirmedAt: typeof candidate.confirmedAt === "string" ? candidate.confirmedAt : null,
    mode: "local-only",
    version: 1,
  };
}
