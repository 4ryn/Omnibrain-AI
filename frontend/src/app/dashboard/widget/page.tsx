
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { WidgetConfig } from "@/lib/types";
import {
  nextJsInstallationCode,
  normalizeOrigin,
  parseWidgetSnippet,
} from "@/lib/widget-installation.cjs";
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

interface Draft {
  brand_name: string;
  welcome_message: string;
  theme: WidgetConfig["theme"];
  position: WidgetConfig["position"];
  logo_url: string;
  avatar_url: string;
  primary_color: string;
  questions: string;
  allowed_origins: string[];
  voice_enabled: boolean;
  lead_capture_enabled: boolean;
}

const toDraft = (c: WidgetConfig): Draft => ({
  brand_name: c.brand_name,
  welcome_message: c.welcome_message,
  theme: c.theme,
  position: c.position,
  logo_url: c.logo_url ?? "",
  avatar_url: c.avatar_url ?? "",
  primary_color: c.primary_color,
  questions: c.suggested_questions.join("\n"),
  allowed_origins: [...c.allowed_origins],
  voice_enabled: c.voice_enabled,
  lead_capture_enabled: c.lead_capture_enabled,
});

const lines = (s: string) =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

const PLATFORMS = [
  { id: "nextjs", label: "Next.js" },
  { id: "wordpress", label: "WordPress" },
  { id: "shopify", label: "Shopify" },
  { id: "wix", label: "Wix" },
  { id: "custom", label: "Custom HTML" },
] as const;

type Platform = (typeof PLATFORMS)[number]["id"];

function installationInstructions(
  platform: Platform,
  snippet: string,
  nextCode: string | null,
): string {
  switch (platform) {
    case "nextjs":
      return nextCode
        ? `In your App Router root layout (usually src/app/layout.tsx or app/layout.tsx), import Script from "next/script". Render this inside <body>, after your page content. This runs after hydration and avoids putting a raw script tag in the server-rendered head.\n\n${nextCode}`
        : `Open your App Router root layout (usually src/app/layout.tsx or app/layout.tsx). Add the server-provided script inside <body>, after your page content. The snippet could not be parsed into a Next.js component, so use the exact HTML snippet below in a site-wide body-end integration instead:\n\n${snippet}`;
    case "wordpress":
      return `Use your site's approved site-wide footer/custom-code integration and place the exact script below before the closing </body> tag. If your integration offers a placement option, choose the end of the body and all pages. Avoid editing WordPress core files; a theme update can overwrite theme-file changes.\n\n${snippet}`;
    case "shopify":
      return `In Shopify Admin, open Online Store → Themes and edit the active theme's theme.liquid. Add the exact script below immediately before </body>, then save. Test the storefront after publishing; theme changes can be replaced by a theme update.\n\n${snippet}`;
    case "wix":
      return `In Wix, open Settings → Custom Code, add the exact script below, choose Body - end, and apply it to the pages where the assistant should appear. Publish the site after saving.\n\n${snippet}`;
    case "custom":
      return `Add the exact script below to the HTML template used by the pages that should show the assistant. Place it immediately before </body> and publish the updated site.\n\n${snippet}`;
  }
}

function Preview({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(true);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const dark =
    draft.theme === "dark" || (draft.theme === "auto" && systemDark);
  const color = /^#[0-9a-fA-F]{6}$/.test(draft.primary_color)
    ? draft.primary_color
    : "#4f46e5";
  const avatar = draft.avatar_url || draft.logo_url;
  const surface = dark
    ? "bg-slate-900 text-slate-100"
    : "bg-white text-slate-800";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const border = dark ? "border-slate-700" : "border-slate-200";

  return (
    <div
      className={`relative h-[390px] overflow-hidden rounded-xl border ${
        dark
          ? "border-slate-700 bg-slate-950"
          : "border-white/10 bg-[#191b28]"
      }`}
      aria-label="Widget appearance preview"
    >
      <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-medium text-slate-300">
        VISITOR PAGE
      </div>

      {open ? (
        <section
          className={`absolute bottom-4 w-[min(290px,calc(100%-2rem))] overflow-hidden rounded-2xl shadow-2xl ${
            draft.position === "bottom-left" ? "left-4" : "right-4"
          } ${surface}`}
          aria-label="Preview chat window"
        >
          <header
            className="flex items-center gap-2.5 px-3.5 py-3 text-white"
            style={{ backgroundColor: color }}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full bg-white/20 object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 font-semibold">
                {draft.brand_name.slice(0, 1) || "A"}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {draft.brand_name || "Assistant"}
              </div>
              <div className="text-[10px] text-white/75">Online</div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-lg leading-none text-white/80 hover:bg-white/15"
              aria-label="Close preview"
            >
              ×
            </button>
          </header>

          <div className="h-[230px] space-y-3 overflow-hidden p-3.5 text-xs">
            <div
              className={`w-fit max-w-[92%] rounded-xl rounded-tl-sm px-3 py-2.5 leading-relaxed ${
                dark ? "bg-slate-800" : "bg-slate-100"
              }`}
            >
              {draft.welcome_message || "Hi! How can I help you today?"}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {lines(draft.questions)
                .slice(0, 4)
                .map((question, index) => (
                  <span
                    key={`${question}-${index}`}
                    className={`rounded-full border px-2.5 py-1 ${border} ${muted}`}
                  >
                    {question}
                  </span>
                ))}
            </div>
          </div>

          <div
            className={`flex items-center gap-2 border-t px-3 py-2.5 ${border}`}
          >
            <span className={`flex-1 text-xs ${muted}`}>
              Type your question…
            </span>
            <span
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Send
            </span>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`absolute bottom-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-semibold text-white shadow-lg ring-4 ring-white/10 ${
            draft.position === "bottom-left" ? "left-5" : "right-5"
          }`}
          style={{ backgroundColor: color }}
          aria-label="Open preview widget"
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            draft.brand_name.slice(0, 1) || "A"
          )}
        </button>
      )}
    </div>
  );
}

function StatusMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        done
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-white/[0.06] text-slate-500"
      }`}
    >
      {done ? "✓" : "·"}
    </span>
  );
}

export default function WidgetPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["widget-config"],
    queryFn: () => api<WidgetConfig>("/api/widget-config"),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>("nextjs");
  const [originInput, setOriginInput] = useState("");
  const [originError, setOriginError] = useState("");

  useEffect(() => {
    if (q.data && !draft) setDraft(toDraft(q.data));
  }, [q.data, draft]);

  const save = useMutation({
    mutationFn: (x: Draft) =>
      api<WidgetConfig>("/api/widget-config", {
        method: "PUT",
        json: {
          brand_name: x.brand_name,
          welcome_message: x.welcome_message,
          theme: x.theme,
          position: x.position,
          logo_url: x.logo_url.trim() || null,
          avatar_url: x.avatar_url.trim() || null,
          primary_color: x.primary_color,
          suggested_questions: lines(x.questions),
          allowed_origins: x.allowed_origins,
          voice_enabled: x.voice_enabled,
          lead_capture_enabled: x.lead_capture_enabled,
        },
      }),
    onSuccess: (config) => {
      qc.setQueryData(["widget-config"], config);
      qc.invalidateQueries({ queryKey: ["overview"] });
      setDraft(toDraft(config));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    },
  });

  if (q.isLoading || !draft) {
    return q.isError ? (
      <Alert tone="error">{(q.error as Error).message}</Alert>
    ) : (
      <Loading />
    );
  }

  const config = q.data!;
  const install = parseWidgetSnippet(config.snippet);
  const nextCode = nextJsInstallationCode(config.snippet);
  const selectedPlatform = PLATFORMS.find((p) => p.id === platform)!;
  const code =
    platform === "nextjs" && nextCode ? nextCode : config.snippet;
  const savedOrigins = config.allowed_origins.length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
  };

  const addOrigin = () => {
    const origin = normalizeOrigin(originInput);

    if (!origin) {
      setOriginError(
        "Enter an HTTP or HTTPS origin only, such as https://www.example.com. Do not include a path, query, or fragment.",
      );
      return;
    }

    if (draft.allowed_origins.includes(origin)) {
      setOriginError("That origin is already in the allow-list.");
      return;
    }

    if (draft.allowed_origins.length >= 20) {
      setOriginError("The configuration supports up to 20 allowed origins.");
      return;
    }

    set("allowed_origins", [...draft.allowed_origins, origin]);
    setOriginInput("");
    setOriginError("");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const questions = lines(draft.questions);

    if (
      questions.length > 6 ||
      questions.some((question) => question.length > 120)
    ) {
      setOriginError(
        "Use up to 6 suggested questions, with no more than 120 characters each.",
      );
      return;
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(draft.primary_color)) {
      setOriginError("Use a six-digit hex color, for example #4f46e5.");
      return;
    }

    setOriginError("");
    save.mutate(draft);
  };

  const headingClass = "text-base font-semibold text-slate-100";
  const bodyClass = "text-sm leading-6 text-slate-400";
  const mutedClass = "text-xs leading-5 text-slate-500";
  const panelClass =
    "rounded-xl border border-white/[0.09] bg-[#11131d] p-3.5";
  const inputPanelClass =
    "rounded-lg border border-white/[0.09] bg-white/[0.03]";

  return (
    <>
      <PageHeader
        title="Widget installation"
        description="Connect your assistant to your website, customize its appearance, and troubleshoot setup using signals the widget actually provides."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className={panelClass + " flex items-center gap-3"}>
          <StatusMark done={savedOrigins} />
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Website access
            </div>
            <div className="text-xs text-slate-500">
              {config.allowed_origins.length} saved origin
              {config.allowed_origins.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className={panelClass + " flex items-center gap-3"}>
          <StatusMark done={Boolean(install)} />
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Install code
            </div>
            <div className="text-xs text-slate-500">
              {install
                ? "Generated from workspace configuration"
                : "Server snippet format not recognized"}
            </div>
          </div>
        </div>

        <div className={panelClass + " flex items-center gap-3"}>
          <StatusMark done={false} />
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Live readiness
            </div>
            <div className="text-xs text-slate-500">
              Confirm on your site in browser DevTools
            </div>
          </div>
        </div>
      </div>

      {config.warnings.map((warning) => (
        <div key={warning} className="mb-4">
          <Alert tone="warning">{warning}</Alert>
        </div>
      ))}

      <form onSubmit={submit}>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card title="Guided installation">
              <p className="-mt-1 mb-5 text-xs leading-5 text-slate-500">
                Follow these steps in order. The dashboard cannot observe
                requests made by a separate customer website.
              </p>

              <div
                className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-3"
                aria-label="Installation steps"
              >
                {[
                  "Allow your website",
                  "Install the snippet",
                  "Verify in browser",
                ].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setStep(index)}
                    aria-current={step === index ? "step" : undefined}
                    className={`flex min-h-12 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors sm:px-3 ${
                      step === index
                        ? "border-violet-400/40 bg-violet-500/10 text-violet-200"
                        : "border-white/[0.09] bg-white/[0.02] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        step === index
                          ? "bg-violet-500 text-white"
                          : "bg-white/[0.07] text-slate-400"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {step === 0 && (
                <div>
                  <h2 className={headingClass}>
                    Allow the exact website origin
                  </h2>
                  <p className={`mt-1 ${bodyClass}`}>
                    The iframe checks the embedding origin. Include the scheme
                    and any non-default port; do not include a page path. HTTP
                    and HTTPS are different origins.
                  </p>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label="Website origin"
                      value={originInput}
                      onChange={(event) => {
                        setOriginInput(event.target.value);
                        setOriginError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addOrigin();
                        }
                      }}
                      placeholder="https://www.example.com"
                      spellCheck={false}
                      autoComplete="url"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addOrigin}
                      disabled={draft.allowed_origins.length >= 20}
                    >
                      Add origin
                    </Button>
                  </div>

                  <p className="mt-2 text-xs text-slate-500">
                    Wildcard entries such as https://*.example.com allow
                    subdomains only, not the apex domain. Maximum 20 origins.
                  </p>

                  {originError && (
                    <p role="alert" className="mt-2 text-sm text-rose-400">
                      {originError}
                    </p>
                  )}

                  <div className="mt-4 space-y-2">
                    {draft.allowed_origins.length ? (
                      draft.allowed_origins.map((origin) => (
                        <div
                          key={origin}
                          className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 py-2"
                        >
                          <code className="break-all text-xs text-slate-300">
                            {origin}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              set(
                                "allowed_origins",
                                draft.allowed_origins.filter(
                                  (item) => item !== origin,
                                ),
                              )
                            }
                            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
                            aria-label={`Remove ${origin}`}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-amber-200">
                        No website is saved yet. In production, an empty
                        allow-list blocks the widget on every site.
                      </div>
                    )}
                  </div>

                  <p className="mt-4 text-xs text-slate-500">
                    Changes are not active until you select Save widget
                    settings below.
                  </p>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div>
                    <h2 className={headingClass}>
                      Install the server-generated snippet
                    </h2>
                    <p className={`mt-1 ${bodyClass}`}>
                      Choose your platform for placement instructions; the
                      loader address and workspace ID come from your saved
                      configuration.
                    </p>
                  </div>

                  <div
                    className="mt-4 flex flex-wrap gap-2"
                    role="group"
                    aria-label="Website platform"
                  >
                    {PLATFORMS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setPlatform(item.id)}
                        aria-pressed={platform === item.id}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          platform === item.id
                            ? "border-violet-400/40 bg-violet-500/10 text-violet-200"
                            : "border-white/[0.09] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className={`mt-4 ${inputPanelClass} p-3.5`}>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Where to add it · {selectedPlatform.label}
                    </h3>
                    <p className={`mt-1 whitespace-pre-line ${bodyClass}`}>
                      {installationInstructions(
                        platform,
                        config.snippet,
                        nextCode,
                      )}
                    </p>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.09] bg-[#090b12]">
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                      <span className="text-[11px] font-medium text-slate-300">
                        {platform === "nextjs" && nextCode
                          ? "Next.js App Router"
                          : "Exact installation code"}
                      </span>
                      <CopyButton text={code} />
                    </div>
                    <pre className="max-h-64 overflow-auto p-3 text-xs leading-5 text-slate-200">
                      <code>{code}</code>
                    </pre>
                  </div>

                  {install ? (
                    <div className="mt-3 break-all text-xs text-slate-500">
                      Loader URL supplied by the backend:{" "}
                      <code className="text-slate-300">{install.src}</code>
                    </div>
                  ) : (
                    <div
                      role="alert"
                      className="mt-3 text-sm text-amber-300"
                    >
                      The API returned a snippet, but it does not match the
                      supported script format. Use only the exact
                      server-provided HTML shown above; framework-specific code
                      is unavailable.
                    </div>
                  )}

                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    This is the installation code only. Saving appearance and
                    origin changes does not require replacing the snippet.
                  </p>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h2 className={headingClass}>
                    Verify the installation from the customer site
                  </h2>
                  <p className={`mt-1 ${bodyClass}`}>
                    There is no server endpoint that can test a visitor browser
                    or confirm a third-party page has installed the script. Use
                    the browser&apos;s Network and Console panels; do not treat
                    this dashboard as a live-site check.
                  </p>

                  <ol className="mt-4 space-y-3">
                    {[
                      [
                        "Find the loader request",
                        "Open the customer page with DevTools → Network, reload, and filter for widget.js. A successful response should be HTTP 200 with JavaScript. If no request appears, confirm the tag is in the rendered page (for Next.js, the root App Router layout's <body>) and inspect script-src restrictions.",
                      ],
                      [
                        "Inspect the iframe request",
                        "Find /widget/frame in Network. A 403 means the frame rejected the embedding origin; compare the page's exact scheme, hostname, and port with Allowed websites. A 404 means the workspace/frame configuration was not found.",
                      ],
                      [
                        "Check frame policy and assets",
                        "For a frame response, inspect Content-Security-Policy → frame-ancestors. It is generated from the saved allow-list. Also check /widget/assets/frame.js and frame.css; a host site's frame-src policy must permit the same server origin as the generated loader URL.",
                      ],
                      [
                        "Confirm readiness",
                        "When the frame initializes it sends a ready message to the loader. If no ready message arrives within 15 seconds, the loader logs a diagnostic. Inspect the Console and failed frame/asset requests; the parent page cannot reliably determine whether a cross-origin frame failed due to HTTP, CSP, or origin policy.",
                      ],
                    ].map(([title, detail]) => (
                      <li
                        key={title}
                        className="flex gap-3 rounded-lg border border-white/[0.09] bg-white/[0.02] p-3"
                      >
                        <StatusMark done={false} />
                        <div>
                          <h3 className="text-sm font-semibold text-slate-200">
                            {title}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            {detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/[0.06] p-3 text-xs leading-5 text-sky-200">
                    <strong>
                      Hydration warning only in a normal browser profile?
                    </strong>{" "}
                    Browser extensions can alter server-rendered markup and
                    trigger a Next.js hydration warning. Since an Incognito
                    test can disable extensions, compare in a clean profile
                    with extensions disabled; treat that separately from a
                    missing loader request or iframe readiness failure.
                  </div>
                </div>
              )}
            </Card>

            <Card title="Appearance">
              <p className="-mt-1 mb-4 text-xs leading-5 text-slate-500">
                These settings are supported by the current widget
                configuration API and apply after saving.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand name">
                  <Input
                    value={draft.brand_name}
                    onChange={(event) => set("brand_name", event.target.value)}
                    maxLength={120}
                    required
                  />
                </Field>

                <Field label="Primary color">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      aria-label="Pick color"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(draft.primary_color)
                          ? draft.primary_color
                          : "#4f46e5"
                      }
                      onChange={(event) =>
                        set("primary_color", event.target.value)
                      }
                      className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-[#191b28]"
                    />
                    <Input
                      aria-label="Primary color hex"
                      value={draft.primary_color}
                      onChange={(event) =>
                        set("primary_color", event.target.value)
                      }
                      maxLength={7}
                    />
                  </div>
                </Field>

                <Field label="Theme">
                  <Select
                    value={draft.theme}
                    onChange={(event) =>
                      set("theme", event.target.value as Draft["theme"])
                    }
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="auto">Match visitor&apos;s device</option>
                  </Select>
                </Field>

                <Field label="Position">
                  <Select
                    value={draft.position}
                    onChange={(event) =>
                      set("position", event.target.value as Draft["position"])
                    }
                  >
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                  </Select>
                </Field>

                <Field label="Logo URL" hint="Optional. HTTP or HTTPS image URL.">
                  <Input
                    type="url"
                    value={draft.logo_url}
                    onChange={(event) => set("logo_url", event.target.value)}
                    placeholder="https://…"
                  />
                </Field>

                <Field
                  label="Avatar URL"
                  hint="Shown in the chat header. The logo is used when no avatar is set."
                >
                  <Input
                    type="url"
                    value={draft.avatar_url}
                    onChange={(event) => set("avatar_url", event.target.value)}
                    placeholder="https://…"
                  />
                </Field>
              </div>
            </Card>

            <Card title="Welcome and suggested questions">
              <div className="space-y-4">
                <Field label="Welcome message">
                  <Textarea
                    rows={2}
                    value={draft.welcome_message}
                    onChange={(event) =>
                      set("welcome_message", event.target.value)
                    }
                    maxLength={500}
                    required
                  />
                </Field>

                <Field
                  label="Suggested questions"
                  hint="One per line, up to 6 questions. Each question may contain up to 120 characters."
                >
                  <Textarea
                    rows={4}
                    value={draft.questions}
                    onChange={(event) => set("questions", event.target.value)}
                    placeholder={
                      "What services do you offer?\nWhat are your opening hours?"
                    }
                  />
                </Field>
              </div>
            </Card>

            <Card title="Features">
              <div className="space-y-3 text-sm text-slate-200">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 accent-violet-500"
                    checked={draft.lead_capture_enabled}
                    onChange={(event) =>
                      set("lead_capture_enabled", event.target.checked)
                    }
                  />
                  <span>
                    <span className="font-medium">Lead capture</span>
                    <span className="block text-xs text-slate-500">
                      When the assistant can&apos;t answer, offer to take the
                      visitor&apos;s contact details.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 accent-violet-500"
                    checked={draft.voice_enabled}
                    onChange={(event) =>
                      set("voice_enabled", event.target.checked)
                    }
                  />
                  <span>
                    <span className="font-medium">Voice</span>
                    <span className="block text-xs text-slate-500">
                      Let visitors speak their question and hear answers.
                      Requires speech models to be configured on the server.
                    </span>
                  </span>
                </label>
              </div>
            </Card>

            {originError && <Alert>{originError}</Alert>}
            {save.isError && (
              <Alert tone="error">{(save.error as Error).message}</Alert>
            )}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.09] bg-[#11131d] p-4">
              <Button type="submit" loading={save.isPending}>
                Save widget settings
              </Button>
              <span aria-live="polite" className="text-sm text-slate-500">
                {saved
                  ? "Saved. Configuration is live; the installation snippet stays the same."
                  : "Saves appearance, features, and allowed website origins."}
              </span>
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-6">
            <Card title="Live appearance preview">
              <p className="-mt-1 mb-4 text-xs leading-5 text-slate-500">
                Interactive visual preview only; it does not send chat requests.
              </p>
              <Preview draft={draft} />
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {draft.theme === "auto"
                    ? "Following this device's theme"
                    : `${draft.theme[0].toUpperCase()}${draft.theme.slice(1)} theme`}
                </span>
                <span>
                  {draft.position === "bottom-left"
                    ? "Bottom left"
                    : "Bottom right"}
                </span>
              </div>
            </Card>

            <Card title="Configuration signals">
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="font-medium text-slate-300">
                    Saved website origins
                  </dt>
                  <dd className="mt-0.5 text-slate-500">
                    {config.allowed_origins.length
                      ? `${config.allowed_origins.length} configured`
                      : "None — production frames are blocked"}
                  </dd>
                </div>

                <div>
                  <dt className="font-medium text-slate-300">
                    Server-provided loader
                  </dt>
                  <dd className="mt-0.5 break-all text-slate-500">
                    {install?.src ??
                      "See the API-provided snippet in the installation step"}
                  </dd>
                </div>

                <div>
                  <dt className="font-medium text-slate-300">
                    Remote installation status
                  </dt>
                  <dd className="mt-0.5 text-slate-500">
                    Not observable from this dashboard. Verify in the customer
                    page&apos;s browser.
                  </dd>
                </div>
              </dl>
            </Card>
          </aside>
        </div>
      </form>
    </>
  );
}
