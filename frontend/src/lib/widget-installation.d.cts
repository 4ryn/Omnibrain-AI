export interface WidgetInstallation {
  src: string;
  workspace: string;
}

export function parseWidgetSnippet(snippet: unknown): WidgetInstallation | null;
export function nextJsInstallationCode(snippet: unknown): string | null;
export function normalizeOrigin(value: string): string | null;
