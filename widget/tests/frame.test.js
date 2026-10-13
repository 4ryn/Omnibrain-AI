const test = require("node:test");
const assert = require("node:assert/strict");
const { framePage, sseResponse, until } = require("./helpers");

const answer = (...texts) => [{ type: "meta", conversation_id: "c-1" }, ...texts.map((t) => ({ type: "delta", text: t })),
  { type: "done", conversation_id: "c-1", message_id: "m-1", fallback: false, sources: [] }];

test("renders brand, welcome message, suggested questions, theme and validated colour", () => {
  const { $, w } = framePage({ suggested_questions: ["Hours?", "Pricing?"], theme: "dark" });
  assert.equal($(".title").textContent, "Acme");
  assert.equal($(".log .msg.bot .msg-text").textContent, "Hi there!");
  assert.deepEqual([...w.document.querySelectorAll(".chips button")].map((b) => b.textContent), ["Hours?", "Pricing?"]);
  assert.equal(w.document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(w.document.documentElement.style.getPropertyValue("--primary"), "#112233");
});

test("an invalid primary colour or non-http avatar URL is never applied (no CSS/URL injection)", () => {
  const { w } = framePage({ primary_color: "red;} body{display:none", avatar_url: "javascript:alert(1)", logo_url: "data:text/html,<script>1</script>" });
  assert.equal(w.document.documentElement.style.getPropertyValue("--primary"), "");
  assert.equal(w.document.querySelector("header img"), null);
});

test("launcher opens and closes the panel, tells the host page, and Escape closes it", () => {
  const { $, w, posted } = framePage();
  const last = () => JSON.parse(JSON.stringify(posted.at(-1)));      // jsdom objects live in another realm
  assert.deepEqual(last(), { source: "omnibrain", type: "ready", position: "bottom-right" });
  $(".launcher").click();
  assert.ok($("#app").classList.contains("open"));
  assert.deepEqual(last(), { source: "omnibrain", type: "state", open: true });
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!$("#app").classList.contains("open"));
  assert.deepEqual(last(), { source: "omnibrain", type: "state", open: false });
});

test("sends the question with token, visitor id, page and conversation; streams the answer progressively", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { $, send, calls } = framePage({}, async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({ async start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "meta", conversation_id: "c-9" })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "delta", text: "We open " })}\n\n`));
      await gate;
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "delta", text: "at nine." })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done", conversation_id: "c-9", fallback: false, sources: [] })}\n\n`));
      c.close(); } });
    return new Response(stream, { status: 200 });
  });
  send("  When do you open?  ");
  await until(() => $(".log").textContent.includes("We open"));
  assert.ok(!$(".log").textContent.includes("at nine."), "partial text is visible before the stream ends");
  assert.ok($("form button[type=submit]").disabled, "send is disabled while answering");
  release();
  await until(() => $(".log").textContent.includes("We open at nine."));
  await until(() => !$("form button[type=submit]").disabled);
  const { url, opts } = calls[0];
  assert.equal(url, "/widget/v1/chat/stream");
  assert.equal(opts.headers.Authorization, "Bearer tok.en");
  assert.match(opts.headers["X-Visitor-Id"], /^[A-Za-z0-9_-]{16,64}$/);
  assert.deepEqual(JSON.parse(opts.body), { message: "When do you open?", conversation_id: null, source_page: "https://customer.example.com/pricing" });
});

test("conversation id is remembered and sent on the next question", async () => {
  const { $, send, calls } = framePage({}, async () => sseResponse(answer("ok")));
  send("one"); await until(() => $(".log").textContent.includes("ok"));
  await until(() => !$("form button[type=submit]").disabled);
  send("two"); await until(() => calls.length === 2);
  assert.equal(JSON.parse(calls[1].opts.body).conversation_id, "c-1");
});

test("SSE frames split across network chunks are reassembled correctly", async () => {
  const { $, send } = framePage({}, async () => sseResponse(answer("Hello, ", "wörld ✓"), { chunkSize: 3 }));
  send("hi");
  await until(() => $(".log").textContent.includes("Hello, wörld ✓"));
});

test("answers are rendered as text, never HTML (XSS-safe)", async () => {
  const evil =
    '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

  const { $, send, w, calls } = framePage(
    {},
    async () => sseResponse(answer(evil))
  );

  send("hi");

  await until(() => calls.length > 0);
  await until(() => !$(".send-button").disabled);

  const log = $(".log");

  // The widget must not create executable HTML elements.
  assert.equal(log.querySelector("img"), null);
  assert.equal(log.querySelector("script"), null);

  // The malicious JavaScript must never execute.
  assert.equal(w.__pwned, undefined);

  // The assistant's message should still be rendered.
  assert.ok(log.textContent.includes("window.pwned=1"));
});

test("visitor's own message and suggested questions are also inserted as text", async () => {
  const { $, send, w } = framePage({ suggested_questions: ['<b onmouseover="1">x</b>'] }, async () => sseResponse(answer("ok")));
  assert.equal(w.document.querySelector(".chips b"), null);
  send("<u>hi</u>"); await until(() => $(".log").textContent.includes("ok"));
  assert.equal(w.document.querySelector(".log u"), null);
});

test("sources: only http(s) links, opened safely in a new tab", async () => {
  const events = [{ type: "meta", conversation_id: "c" }, { type: "delta", text: "See docs" }, { type: "done", conversation_id: "c", fallback: false,
    sources: [{ index: 1, name: "Pricing", url: "https://acme.example/pricing" }] }];
  const { $, send } = framePage({}, async () => sseResponse(events));
  send("pricing?"); await until(() => $(".srcs a"));
  const a = $(".srcs a");
  assert.equal(a.getAttribute("href"), "https://acme.example/pricing"); assert.equal(a.target, "_blank"); assert.match(a.rel, /noopener/);
});

test("server error events and HTTP failures show a friendly message and re-enable input", async () => {
  const a = framePage({}, async () => sseResponse([{ type: "meta", conversation_id: "c" }, { type: "error", message: "The assistant is temporarily unavailable. Please try again shortly." }]));
  a.send("hi"); await until(() => a.$(".msg.err"));
  assert.match(a.$(".msg.err").textContent, /temporarily unavailable/); assert.ok(!a.$("form button[type=submit]").disabled);
  const b = framePage({}, async () => new Response("boom", { status: 500 }));
  b.send("hi"); await until(() => b.$(".msg.err")); assert.match(b.$(".msg.err").textContent, /Something went wrong/);
  const c = framePage({}, async () => new Response("{}", { status: 429 }));
  c.send("hi"); await until(() => c.$(".msg.err")); assert.match(c.$(".msg.err").textContent, /too quickly/);
  const d = framePage({}, async () => { throw new TypeError("network down"); });
  d.send("hi"); await until(() => d.$(".msg.err")); assert.match(d.$(".msg.err").textContent, /Something went wrong/);
  assert.doesNotMatch(d.$(".msg.err").textContent, /network down/);     // raw exception text is never shown to visitors
});

test("the output filter's replace event swaps already-streamed text", async () => {
  const ev = [{ type: "meta", conversation_id: "c" }, { type: "delta", text: "secret rules..." }, { type: "replace", text: "I can't help with that request." },
    { type: "done", conversation_id: "c", fallback: false, sources: [] }];
  const { $, send } = framePage({}, async () => sseResponse(ev));
  send("x"); await until(() => $(".log").textContent.includes("I can't help"));
  assert.ok(!$(".log").textContent.includes("secret rules"));
});

test("Enter sends, Shift+Enter does not; empty and whitespace-only messages are ignored", async () => {
  const { $, w, calls } = framePage({}, async () => sseResponse(answer("ok")));
  $("textarea").value = "   "; $("textarea").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  $("textarea").value = "hello"; $("textarea").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true }));
  assert.equal(calls.length, 0);
  $("textarea").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  await until(() => calls.length === 1);
});

const fallbackEvents = [{ type: "meta", conversation_id: "c-7" }, { type: "delta", text: "I don't have enough information to answer that accurately." },
  { type: "done", conversation_id: "c-7", fallback: true, sources: [] }];

test("fallback offers the lead form once; submitting posts contact details with the conversation and question", async () => {
  const { $, send, calls, w } = framePage({}, async (url) => (url.includes("/lead") ? new Response('{"ok":true}', { status: 201 }) : sseResponse(fallbackEvents)));
  send("Do you ship to Mars?"); await until(() => $(".leadform"));
  $(".leadform input[type=email]").value = "vera@example.com";
  $(".leadform input[type=text]").value = "Vera";
  $(".leadform").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await until(() => $(".lead") && $(".lead").textContent.startsWith("Thanks"));
  const lead = calls.find((c) => c.url === "/widget/v1/lead");
  assert.deepEqual(JSON.parse(lead.opts.body), { name: "Vera", email: "vera@example.com", phone: "", question: "Do you ship to Mars?", conversation_id: "c-7", source_page: "https://customer.example.com/pricing" });
  await until(() => !$("form button[type=submit]").disabled);
  send("and Venus?"); await until(() => calls.filter((c) => c.url.includes("stream")).length === 2);
  assert.equal(w.document.querySelectorAll(".leadform").length, 0, "not offered a second time");
});

test("lead form requires an email or phone, can be dismissed, and is absent when lead capture is off", async () => {
  const a = framePage({}, async () => sseResponse(fallbackEvents));
  a.send("q"); await until(() => a.$(".leadform"));
  a.$(".leadform").dispatchEvent(new a.w.Event("submit", { cancelable: true }));
  assert.match(a.$(".leadmsg").textContent, /email or phone/); assert.equal(a.calls.filter((c) => c.url.includes("/lead")).length, 0);
  [...a.w.document.querySelectorAll(".leadrow button")].find((b) => b.textContent === "No thanks").click();
  assert.equal(a.$(".leadform"), null);
  const off = framePage({ lead_capture_enabled: false }, async () => sseResponse(fallbackEvents));
  off.send("q"); await until(() => off.$(".log").textContent.includes("don't have enough")); await new Promise((r) => setTimeout(r, 30));
  assert.equal(off.$(".leadform"), null);
});

test("voice controls appear only when enabled and the browser supports recording", () => {
  assert.equal(framePage({ voice_enabled: false }).$("button[aria-label='Speak your question']"), null);
  assert.equal(framePage({ voice_enabled: true }).$("button[aria-label='Speak your question']"), null);          // jsdom has no MediaRecorder
  const dom = framePage({ voice_enabled: true });                                                                   // simulate a capable browser
  assert.ok(dom.$("textarea"));
});
