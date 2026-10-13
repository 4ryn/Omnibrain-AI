const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 1500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await tick(5); }
  throw new Error("condition not met in time");
}

/** Loader running on a fake customer page (https://customer.example.com). */
function loaderPage({ attrs = 'data-workspace="wk_abc123"', width = 1280, height = 800, preExisting = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body><p>customer site</p>
    <script async src="https://api.omnibrain.test/widget.js" ${attrs}></script></body>`,
    { url: "https://customer.example.com/pricing?x=1", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.innerWidth = width; w.innerHeight = height;
  if (preExisting) w.__omnibrainLoaded = true;
  w.eval(read("widget.js"));
  return { dom, w, frame: () => w.document.querySelector("iframe") };
}

/** Chat UI (frame.js) with a scripted fetch(). */
function framePage(boot = {}, fetchImpl) {
  const bootData = Object.assign({
    workspace: "wk_abc123", token: "tok.en", brand_name: "Acme", welcome_message: "Hi there!", theme: "light",
    position: "bottom-right", logo_url: null, avatar_url: null, primary_color: "#112233", suggested_questions: [],
    voice_enabled: false, lead_capture_enabled: true, source_page: "https://customer.example.com/pricing" }, boot);
  const dom = new JSDOM(`<!doctype html><body><div id="app"></div>
    <script type="application/json" id="boot">${JSON.stringify(bootData).replace(/</g, "\\u003c")}</script></body>`,
    { url: "https://api.omnibrain.test/widget/frame?w=wk_abc123", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const calls = [], posted = [];
  w.fetch = async (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts, calls); };
  w.TextDecoder = TextDecoder;
  w.matchMedia = () => ({ matches: false });
  w.crypto.getRandomValues ||= (a) => require("node:crypto").webcrypto.getRandomValues(a);
  w.Element.prototype.scrollIntoView = () => {};
  const realPost = w.parent.postMessage.bind(w.parent);
  w.parent.postMessage = (msg, target) => { posted.push(msg); return realPost(msg, target); };
  w.eval(read("frame.js"));
  const $ = (s) => w.document.querySelector(s);
  const send = (text) => { $("textarea").value = text; $("form").dispatchEvent(new w.Event("submit", { cancelable: true })); };
  return { dom, w, $, calls, posted, send, bootData };
}

/** Build a streaming Response from SSE events, optionally split into awkward chunks. */
function sseResponse(events, { chunkSize = 17, status = 200 } = {}) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const enc = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < enc.length; i += chunkSize) c.enqueue(enc.slice(i, i + chunkSize)); c.close(); } });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

module.exports = { loaderPage, framePage, sseResponse, until, tick, read };
