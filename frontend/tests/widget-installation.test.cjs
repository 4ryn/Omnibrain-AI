"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nextJsInstallationCode, normalizeOrigin, parseWidgetSnippet } = require("../src/lib/widget-installation.cjs");

test("parses the exact server-generated widget loader URL and public workspace ID", () => {
  const snippet = '<script async src="https://api.example.test/widget.js" data-workspace="wk_ab12"></script>';
  assert.deepEqual(parseWidgetSnippet(snippet), {
    src: "https://api.example.test/widget.js",
    workspace: "wk_ab12",
  });
});

test("does not create framework snippets for unknown, malformed, or unsafe loader URLs", () => {
  assert.equal(parseWidgetSnippet('<script async src="https://api.example.test/other.js" data-workspace="wk_ab12"></script>'), null);
  assert.equal(parseWidgetSnippet('<script async src="javascript:alert(1)" data-workspace="wk_ab12"></script>'), null);
  assert.equal(parseWidgetSnippet('<script async src="/widget.js" data-workspace="wk_ab12"></script>'), null);
  assert.equal(parseWidgetSnippet('<script async src="https://api.example.test/widget.js" data-workspace=""></script>'), null);
  assert.equal(nextJsInstallationCode("not a script"), null);
});

test("generates Next.js App Router code only from values in the server snippet", () => {
  const snippet = '<script async src="https://api.example.test/widget.js" data-workspace="wk_ab12"></script>';
  assert.equal(nextJsInstallationCode(snippet), [
    'import Script from "next/script";',
    "",
    "// Add inside <body>, after your page content in the root App Router layout.",
    "<Script",
    '  src={"https://api.example.test/widget.js"}',
    '  data-workspace={"wk_ab12"}',
    '  strategy="afterInteractive"',
    "/>",
  ].join("\n"));
});

test("normalizes valid HTTP(S) origins and preserves wildcard subdomain scope", () => {
  assert.equal(normalizeOrigin(" HTTPS://WWW.Example.COM/ "), "https://www.example.com");
  assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeOrigin("https://*.example.com"), "https://*.example.com");
});

test("rejects paths, credentials, invalid schemes, malformed hosts, and wildcard ports", () => {
  assert.equal(normalizeOrigin("https://example.com/path"), null);
  assert.equal(normalizeOrigin("https://user@example.com"), null);
  assert.equal(normalizeOrigin("javascript:alert(1)"), null);
  assert.equal(normalizeOrigin("https://bad..example.com"), null);
  assert.equal(normalizeOrigin("https://*.example.com:8443"), null);
  assert.equal(normalizeOrigin("https://example.com:99999"), null);
});
