
const test = require("node:test");
const assert = require("node:assert/strict");
const { loaderPage, tick } = require("./helpers");

const msg = (w, frame, data) =>
  w.dispatchEvent(
    new w.MessageEvent("message", {
      origin: "https://api.omnibrain.test",
      data: Object.assign({ source: "omnibrain" }, data),
      source: frame.contentWindow
    })
  );

test("loader injects one sandbox-friendly iframe pointing at the OmniBrain frame for the workspace", () => {
  const { w, frame } = loaderPage();
  const f = frame();

  assert.ok(f, "iframe created");

  const u = new URL(f.src);
  assert.equal(u.origin, "https://api.omnibrain.test");
  assert.equal(u.pathname, "/widget/frame");
  assert.equal(u.searchParams.get("w"), "wk_abc123");
  assert.equal(
    u.searchParams.get("p"),
    "https://customer.example.com/pricing?x=1"
  );

  assert.equal(f.getAttribute("referrerpolicy"), "origin");
  assert.equal(f.getAttribute("allow"), "microphone");
  assert.equal(w.document.querySelectorAll("iframe").length, 1);
  assert.match(f.style.cssText, /position:\s*fixed/);
  assert.equal(f.style.zIndex, "2147483647");
  assert.equal(f.style.width, "112px");
});

test("loader does nothing without a workspace and never loads twice", () => {
  assert.equal(loaderPage({ attrs: "" }).frame(), null);
  assert.equal(loaderPage({ preExisting: true }).frame(), null);

  const { w } = loaderPage();
  w.eval(require("./helpers").read("widget.js"));

  assert.equal(w.document.querySelectorAll("iframe").length, 1);
});

test("opening on desktop enlarges the frame; closing restores the launcher", () => {
  const { w, frame } = loaderPage({
    width: 1280,
    height: 800
  });

  const f = frame();

  msg(w, f, { type: "state", open: true });

  assert.equal(f.style.width, "392px");
  assert.equal(f.style.height, "640px");
  assert.equal(f.style.right, "12px");
  assert.equal(f.style.bottom, "12px");

  msg(w, f, { type: "state", open: false });

  assert.equal(f.style.width, "112px");
  assert.equal(f.style.height, "112px");
  assert.equal(f.style.bottom, "0px");
});

test("mobile: opened chat stays inside the viewport; small desktop windows do not overflow", () => {
  const { w, frame } = loaderPage({
    width: 390,
    height: 700
  });

  const f = frame();

  msg(w, f, { type: "state", open: true });

  assert.equal(f.style.width, "374px");
  assert.equal(f.style.height, "684px");
  assert.equal(f.style.top, "8px");
  assert.equal(f.style.left, "8px");
  assert.equal(f.style.right, "8px");
  assert.equal(f.style.bottom, "8px");

  const small = loaderPage({
    width: 600,
    height: 300
  });

  const smallFrame = small.frame();
  msg(small.w, smallFrame, {
    type: "state",
    open: true
  });

  assert.equal(smallFrame.style.height, "276px");
});

test("position from saved widget settings is applied (bottom-left)", () => {
  const { w, frame } = loaderPage();
  const f = frame();

  msg(w, f, {
    type: "ready",
    position: "bottom-left"
  });

  assert.equal(f.style.left, "0px");
});

test("messages from other windows or with a bad shape are ignored", () => {
  const { w, frame } = loaderPage();
  const f = frame();

  w.dispatchEvent(
    new w.MessageEvent("message", {
      data: {
        source: "omnibrain",
        type: "state",
        open: true
      },
      source: w
    })
  );

  msg(w, f, {
    type: "ready",
    position: "top-left; background:red"
  });

  w.dispatchEvent(
    new w.MessageEvent("message", {
      data: "string payload",
      source: f.contentWindow
    })
  );

  assert.equal(f.style.width, "112px");
  assert.equal(f.style.height, "112px");
});

test("readiness timeout reports actionable browser checks without claiming a specific failure", () => {
  const { w, triggerReadyTimeout } = loaderPage({ captureReadyTimeout: true });
  const errors = [];
  w.console.error = (...args) => errors.push(args);

  triggerReadyTimeout();

  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /did not send a ready signal within 15 seconds/);
  assert.match(errors[0][0], /script-src\/frame-src/);
  assert.match(errors[0][0], /frame-ancestors/);
});

test("resizing the window re-lays-out an open widget", async () => {
  const { w, frame } = loaderPage({
    width: 1280,
    height: 800
  });

  const f = frame();

  msg(w, f, {
    type: "state",
    open: true
  });

  w.innerWidth = 400;
  w.dispatchEvent(new w.Event("resize"));

  assert.equal(f.style.width, "384px");

  await tick();
});
