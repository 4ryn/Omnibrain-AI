"use strict";

function normalizeOrigin(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const wildcard = /^https?:\/\/\*\./i.test(input);
  if (input.includes("*") && !wildcard) return null;
  const urlInput = input.replace(/^([a-z]+:\/\/)\*\./i, "$1wildcard.");
  try {
    const url = new URL(urlInput);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (wildcard && (url.port || !host.startsWith("wildcard."))) return null;
    const domain = wildcard ? host.slice("wildcard.".length) : host;
    if (!domain || (domain.includes(":") ? wildcard : !domain.split(".").every(
      (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ))) return null;
    return `${url.protocol}//${wildcard ? "*." : ""}${domain}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return null;
  }
}

function parseWidgetSnippet(snippet) {
  if (typeof snippet !== "string") return null;
  const match = /^\s*<script async src="([^"]+)" data-workspace="([^"]+)"><\/script>\s*$/.exec(snippet);
  if (!match) return null;

  try {
    const url = new URL(match[1]);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/widget.js" || url.search || url.hash || !match[2]) return null;
    return { src: url.href, workspace: match[2] };
  } catch {
    return null;
  }
}

function nextJsInstallationCode(snippet) {
  const installation = parseWidgetSnippet(snippet);
  if (!installation) return null;
  return [
    'import Script from "next/script";',
    "",
    "// Add inside <body>, after your page content in the root App Router layout.",
    "<Script",
    `  src={${JSON.stringify(installation.src)}}`,
    `  data-workspace={${JSON.stringify(installation.workspace)}}`,
    '  strategy="afterInteractive"',
    "/>",
  ].join("\n");
}

module.exports = { nextJsInstallationCode, normalizeOrigin, parseWidgetSnippet };
