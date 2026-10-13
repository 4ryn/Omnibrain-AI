(function () {
  "use strict";

  var boot = JSON.parse(document.getElementById("boot").textContent);

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  var $ = function (tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };

  var store = function (storage, key, value) {
    try {
      if (value === undefined) return storage.getItem(key);
      storage.setItem(key, value);
    } catch (e) {
      return null;
    }
    return value;
  };

  function UserError(message) {
    this.message = message;
  }

  var MAX_LEN = 2000;

  /* ------------------------------------------------------------------ */
  /* SVG icons                                                          */
  /* ------------------------------------------------------------------ */

  var ICONS = {
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>',

    speaker:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M11 5L6.5 9H3v6h3.5L11 19V5z"></path>' +
      '<path d="M15 9.5c1.3 1.3 1.3 3.7 0 5"></path>' +
      '<path d="M17.8 7c2.8 2.8 2.8 7.2 0 10"></path></svg>',

    speakerOff:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M11 5L6.5 9H3v6h3.5L11 19V5z"></path>' +
      '<path d="M16 9l5 6"></path><path d="M21 9l-5 6"></path></svg>',

    mic:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="8" y="3" width="8" height="12" rx="4"></rect>' +
      '<path d="M5 11a7 7 0 0 0 14 0"></path>' +
      '<path d="M12 18v3"></path><path d="M9 21h6"></path></svg>',

    stop:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"></rect></svg>',

    send:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 4l16 8-16 8 3.5-8L4 4z"></path><path d="M7.5 12H20"></path></svg>',

    user:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="8" r="4"></circle>' +
      '<path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"></path></svg>'
  };

  function iconButton(className, icon, label) {
    var button = $("button", className);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.innerHTML = ICONS[icon];
    return button;
  }

  function timeNow() {
    try {
      return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Visitor / conversation state                                       */
  /* ------------------------------------------------------------------ */

  var visitorId =
    store(localStorage, "ob_v") ||
    (function () {
      var bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);

      var id = btoa(String.fromCharCode.apply(null, bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      store(localStorage, "ob_v", id);
      return id;
    })();

  var convKey = "ob_c_" + boot.workspace;
  var conversationId = store(sessionStorage, convKey) || null;

  var busy = false;
  var open = false;
  var autoSpeak = false;
  var recognition = null;
  var listening = false;
  var leadDone = false;

  /* ------------------------------------------------------------------ */
  /* Theme / branding                                                   */
  /* ------------------------------------------------------------------ */

  var root = document.documentElement;

  var dark =
    boot.theme === "dark" ||
    (boot.theme === "auto" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.setAttribute("data-theme", dark ? "dark" : "light");

  if (/^#[0-9a-fA-F]{3,8}$/.test(boot.primary_color || "")) {
    root.style.setProperty("--primary", boot.primary_color);
  }

  var safeImg = function (url) {
    return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
  };

  /* Builds the avatar contents (logo image or fallback letter) */
  function fillAvatar(container, url) {
    var src = safeImg(url);

    if (src) {
      var img = $("img");
      img.src = src;
      img.alt = "";
      container.appendChild(img);
    } else {
      container.appendChild($("span", "avatar-letter", "O"));
    }
  }

  /* ------------------------------------------------------------------ */
  /* App structure                                                      */
  /* ------------------------------------------------------------------ */

  var app = document.getElementById("app");
  app.className = boot.position === "bottom-left" ? "left" : "right";

  /* ------------------------------------------------------------------ */
  /* Floating launcher (circular glass)                                 */
  /* ------------------------------------------------------------------ */

  var launcher = $("button", "launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");

  var launcherGlow = $("span", "launcher-glow");
  var launcherGlass = $("span", "launcher-glass");
  var launcherInner = $("span", "launcher-inner");

  var launcherSrc = safeImg(boot.logo_url || boot.avatar_url);

  if (launcherSrc) {
    var launcherImage = $("img");
    launcherImage.src = launcherSrc;
    launcherImage.alt = "";
    launcherInner.appendChild(launcherImage);
  } else {
    launcherInner.appendChild($("span", "launcher-letter", "O"));
  }

  launcherGlass.appendChild(launcherInner);
  launcher.append(launcherGlow, launcherGlass);

  /* ------------------------------------------------------------------ */
  /* Chat panel                                                         */
  /* ------------------------------------------------------------------ */

  var panel = $("section", "panel");
  panel.setAttribute("aria-label", (boot.brand_name || "Assistant") + " chat");

  /* ------------------------------------------------------------------ */
  /* Header                                                             */
  /* ------------------------------------------------------------------ */

  var header = $("header", "chat-header");
  var headerIdentity = $("div", "header-identity");
  var headerAvatar = $("div", "header-avatar");

  fillAvatar(headerAvatar, boot.avatar_url || boot.logo_url);

  var headerInfo = $("div", "header-info");
  var title = $("div", "title", boot.brand_name || "Assistant");

  var status = $("div", "status");
  status.appendChild($("span", "status-dot"));
  status.appendChild($("span", "", "Online"));

  headerInfo.append(title, status);
  headerIdentity.append(headerAvatar, headerInfo);

  var headerActions = $("div", "header-actions");

  var speakToggle = iconButton(
    "header-icon speak-toggle",
    "speakerOff",
    "Read answers aloud"
  );
  speakToggle.setAttribute("aria-pressed", "false");
  speakToggle.title = "Read answers aloud";

  var close = iconButton("header-icon close-button", "close", "Close chat");

  headerActions.append(speakToggle, close);
  header.append(headerIdentity, headerActions);

  /* ------------------------------------------------------------------ */
  /* Messages                                                           */
  /* ------------------------------------------------------------------ */

  var log = $("div", "log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  /* ------------------------------------------------------------------ */
  /* Suggestions                                                        */
  /* ------------------------------------------------------------------ */

  var chips = $("div", "chips");

  /* ------------------------------------------------------------------ */
  /* Composer                                                           */
  /* ------------------------------------------------------------------ */

  var composer = $("form", "composer");
  var inputWrap = $("div", "input-wrap");

  var input = $("textarea");
  input.rows = 1;
  input.maxLength = MAX_LEN;
  input.placeholder = "Type your question…";
  input.setAttribute("aria-label", "Message");

  var counter = $("span", "char-count", "0/" + MAX_LEN);
  counter.setAttribute("aria-hidden", "true");

  var micButton = null;

  var SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  inputWrap.append(input, counter);

  if (boot.voice_enabled && SpeechRecognition) {
    micButton = iconButton("input-icon mic-button", "mic", "Speak your question");
    inputWrap.appendChild(micButton);
  }

  var send = iconButton("send-button", "send", "Send message");
  send.type = "submit";

  composer.append(inputWrap, send);

  /* ------------------------------------------------------------------ */
  /* Footer                                                             */
  /* ------------------------------------------------------------------ */

  var foot = $("div", "foot", "AI assistant · answers may be incomplete");

  panel.append(header, log, chips, composer, foot);
  app.append(launcher, panel);

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */

  function post(message) {
    parent.postMessage(Object.assign({ source: "omnibrain" }, message), "*");
  }

  function setOpen(value) {
    open = value;
    app.classList.toggle("open", value);
    post({ type: "state", open: value });

    if (value) {
      setTimeout(function () {
        input.focus();
      }, 50);
    } else {
      launcher.focus();
    }
  }

  function headers(json) {
    var h = {
      Authorization: "Bearer " + boot.token,
      "X-Visitor-Id": visitorId
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  function expired() {
    if (store(sessionStorage, "ob_reload") === "1") return false;
    store(sessionStorage, "ob_reload", "1");
    location.reload();
    return true;
  }

  function scrollBottom() {
    log.scrollTop = log.scrollHeight;
  }

  function updateCounter() {
    var n = input.value.length;
    counter.textContent = n + "/" + MAX_LEN;
    counter.classList.toggle("near-limit", n >= MAX_LEN - 100);
  }

  /* ------------------------------------------------------------------ */
  /* Clean AI output                                                    */
  /* ------------------------------------------------------------------ */

  // function cleanAssistantText(text) {
  //   return String(text || "")
  //     .replace(/\[source:[^\]]+\]/gi, "")
  //     .replace(/\[sources?:[^\]]+\]/gi, "")
  //     .replace(/【[^】]+】/g, "")
  //     .replace(/[ \t]{2,}/g, " ")
  //     .trim();
  // }
  function cleanAssistantText(text) {
    if (text == null) return "";

    var value = String(text)
      .replace(/\r\n?/g, "\n")
      .replace(/\u00A0/g, " ");

    // ------------------------------------------------------------
    // Remove source / citation artifacts
    // ------------------------------------------------------------
    value = value
      .replace(/\[source:[^\]]+\]/gi, "")
      .replace(/\[sources?:[^\]]+\]/gi, "")
      .replace(/\[\s*source\s*\d+\s*\]/gi, "")
      .replace(/\[\s*sources?\s*\d+(?:\s*[,;]\s*\d+)*\s*\]/gi, "")
      .replace(/【[^】]+】/g, "")
      .replace(/<citation[^>]*>.*?<\/citation>/gis, "")
      .replace(/<source[^>]*>.*?<\/source>/gis, "");

    // ------------------------------------------------------------
    // Remove image / image-link artifacts
    // ------------------------------------------------------------
    value = value
      .replace(/!\[[^\]]*\]\([^)]+\)/gi, "")
      .replace(/\[\s*image\s*\]\([^)]+\)/gi, "")
      .replace(/\[\s*image:[^\]]*\]\([^)]+\)/gi, "");

    // ------------------------------------------------------------
    // Remove raw URLs that appear on their own
    // Keep URLs inside normal sentences untouched.
    // ------------------------------------------------------------
    value = value.replace(
      /^\s*(?:https?:\/\/|www\.)\S+\s*$/gim,
      ""
    );

    // ------------------------------------------------------------
    // Remove Markdown heading markers
    // ------------------------------------------------------------
    value = value.replace(/^\s{0,3}#{1,6}\s+/gm, "");

    // ------------------------------------------------------------
    // Remove Markdown list markers
    //
    // - item
    // * item
    // + item
    // 1. item
    // 1) item
    // ------------------------------------------------------------
    value = value
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d{1,3}[.)]\s+/gm, "");

    // ------------------------------------------------------------
    // Remove Markdown emphasis markers while preserving text
    //
    // **bold**     -> bold
    // __bold__     -> bold
    // *italic*     -> italic
    // _italic_     -> italic
    // ~~strike~~   -> strike
    // ------------------------------------------------------------
    value = value
      .replace(/\*\*(.*?)\*\*/gs, "$1")
      .replace(/__(.*?)__/gs, "$1")
      .replace(/~~(.*?)~~/gs, "$1")
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");

    // ------------------------------------------------------------
    // Remove inline code markers
    //
    // `FastAPI` -> FastAPI
    // ------------------------------------------------------------
    value = value.replace(/`([^`\n]+)`/g, "$1");

    // ------------------------------------------------------------
    // Remove fenced code-block markers.
    // Keep the actual code/text inside.
    // ------------------------------------------------------------
    value = value
      .replace(/^\s*```[\w-]*\s*$/gm, "")
      .replace(/^\s*~~~[\w-]*\s*$/gm, "");

    // ------------------------------------------------------------
    // Convert Markdown links to their visible text
    //
    // [Zendesk](https://zendesk.com)
    //        -> Zendesk
    // ------------------------------------------------------------
    value = value.replace(
      /\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi,
      "$1"
    );

    // ------------------------------------------------------------
    // Remove HTML tags that an LLM may accidentally produce
    // ------------------------------------------------------------
    value = value.replace(/<\/?(?:br|p|div|span|strong|em|b|i)[^>]*>/gi, "");

    // ------------------------------------------------------------
    // Remove horizontal Markdown separators
    // ------------------------------------------------------------
    value = value.replace(
      /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm,
      ""
    );

    // ------------------------------------------------------------
    // Clean trailing Markdown punctuation/artifacts
    // ------------------------------------------------------------
    value = value
      .replace(/[ \t]+$/gm, "")
      .replace(/[ \t]{2,}/g, " ");

    // ------------------------------------------------------------
    // Normalize excessive blank lines
    // ------------------------------------------------------------
    value = value.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");

    // ------------------------------------------------------------
    // Remove empty lines at beginning/end
    // ------------------------------------------------------------
    value = value
      .replace(/^\s*\n+/, "")
      .replace(/\n+\s*$/, "")
      .trim();

    return value;
  }


  /* ------------------------------------------------------------------ */
  /* Safe Markdown rendering                                            */
  /* ------------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }


  function renderInlineMarkdown(value) {
    var s = escapeHtml(value);

    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    return s;
  }


  function renderAssistantMarkdown(value) {
    var text = cleanAssistantText(value);

    if (!text) return "";

    var lines = text.split("\n");
    var html = [];

    var inUl = false;
    var inOl = false;
    var paragraph = [];


    function closeLists() {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }

      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
    }


    function flushParagraph() {
      if (!paragraph.length) return;

      html.push(
        "<p>" +
        renderInlineMarkdown(paragraph.join(" ")) +
        "</p>"
      );

      paragraph = [];
    }


    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      if (!line) {
        flushParagraph();
        closeLists();
        continue;
      }


      var unordered = line.match(/^[-*•]\s+(.+)$/);
      var ordered = line.match(/^\d+[.)]\s+(.+)$/);


      if (unordered) {
        flushParagraph();

        if (inOl) {
          html.push("</ol>");
          inOl = false;
        }

        if (!inUl) {
          html.push("<ul>");
          inUl = true;
        }

        html.push(
          "<li>" +
          renderInlineMarkdown(unordered[1]) +
          "</li>"
        );

        continue;
      }


      if (ordered) {
        flushParagraph();

        if (inUl) {
          html.push("</ul>");
          inUl = false;
        }

        if (!inOl) {
          html.push("<ol>");
          inOl = true;
        }

        html.push(
          "<li>" +
          renderInlineMarkdown(ordered[1]) +
          "</li>"
        );

        continue;
      }


      closeLists();


      if (/^#{1,3}\s+/.test(line)) {
        flushParagraph();

        html.push(
          "<p><strong>" +
          renderInlineMarkdown(
            line.replace(/^#{1,3}\s+/, "")
          ) +
          "</strong></p>"
        );

        continue;
      }


      paragraph.push(line);
    }


    flushParagraph();
    closeLists();

    return html.join("");
  }


  /* ------------------------------------------------------------------ */
  /* URL source normalization                                           */
  /* ------------------------------------------------------------------ */

  function normalizeSourceUrl(url) {
    try {
      var parsed = new URL(String(url || ""));

      parsed.hash = "";

      if (parsed.pathname.length > 1) {
        parsed.pathname =
          parsed.pathname.replace(/\/+$/, "");
      }

      return parsed.toString();

    } catch (e) {
      return String(url || "")
        .trim()
        .replace(/#.*$/, "")
        .replace(/\/+$/, "");
    }
  }


  /* ------------------------------------------------------------------ */
  /* Clean webpage source title                                         */
  /* ------------------------------------------------------------------ */

  function cleanSourceTitle(source) {
    var raw = String(
      (source && (source.name || source.title)) ||
      (source && source.url) ||
      "Source"
    ).trim();


    if (!raw) {
      return "Source";
    }


    raw = raw
      .replace(
        /\s*\|\s*(Zendesk(?:\s+India)?|www\.[^|]+)$/i,
        ""
      )
      .replace(
        /\s*[-–—]\s*(Zendesk(?:\s+India)?|www\.[^-–—]+)$/i,
        ""
      )
      .trim();


    raw = raw
      .replace(/^\s*Zendesk\s*:\s*/i, "")
      .trim();


    if (/^https?:\/\//i.test(raw)) {
      try {
        var parsed = new URL(raw);

        var path = parsed.pathname
          .split("/")
          .filter(Boolean)
          .pop();


        if (path) {
          raw = decodeURIComponent(path)
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, function (c) {
              return c.toUpperCase();
            });
        } else {
          raw = parsed.hostname
            .replace(/^www\./i, "");
        }

      } catch (e) {
        raw = "Source";
      }
    }


    if (raw.length > 90) {
      raw = raw.slice(0, 87) + "…";
    }

    return raw;
  }


  /* ------------------------------------------------------------------ */
  /* Deduplicate URL sources                                            */
  /* ------------------------------------------------------------------ */

  function renderUrlSources(sources) {
    var unique = [];
    var seen = {};

    (sources || []).forEach(function (source) {

      var url = normalizeSourceUrl(
        source && source.url
      );


      if (!/^https?:\/\//i.test(url)) {
        return;
      }


      if (seen[url]) {
        return;
      }


      seen[url] = true;


      unique.push({
        index: source.index,
        name: cleanSourceTitle(source),
        url: url
      });
    });


    return unique.slice(0, 3);
  }

  /* ------------------------------------------------------------------ */
  /* Speech synthesis                                                   */
  /* ------------------------------------------------------------------ */

  function resetSpeakButton(button) {
    button.classList.remove("speaking");
    button.innerHTML = ICONS.speaker;
    button.setAttribute("aria-label", "Read message aloud");
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    
  }

  function speakText(text, button) {
    if (!text || !("speechSynthesis" in window)) return;

    stopSpeaking();

    var utterance = new SpeechSynthesisUtterance(cleanAssistantText(text));
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (button) {
      button.classList.add("speaking");
      button.innerHTML = ICONS.stop;
      button.setAttribute("aria-label", "Stop speaking");

      utterance.onend = function () {
        resetSpeakButton(button);
      };
    }

    utterance.onerror = function () {
      if (button) resetSpeakButton(button);
    };

    window.speechSynthesis.speak(utterance);
  }

  /* ------------------------------------------------------------------ */
  /* Header auto-speak                                                  */
  /* ------------------------------------------------------------------ */

  function toggleAutoSpeak() {
    autoSpeak = !autoSpeak;

    speakToggle.setAttribute("aria-pressed", String(autoSpeak));
    speakToggle.classList.toggle("active", autoSpeak);
    speakToggle.innerHTML = autoSpeak ? ICONS.speaker : ICONS.speakerOff;
    speakToggle.title = autoSpeak ? "Auto read is on" : "Read answers aloud";

    if (!autoSpeak) stopSpeaking();
  }

  speakToggle.addEventListener("click", toggleAutoSpeak);

  /* ------------------------------------------------------------------ */
  /* Bubble creation                                                    */
  /* ------------------------------------------------------------------ */

  function createBotBubble() {
    var row = $("div", "message-row bot-row");

    var avatar = $("div", "message-avatar");
    fillAvatar(avatar, boot.avatar_url || boot.logo_url);

    var content = $("div", "message-content");
    var bubble = $("div", "msg bot");
    var text = $("div", "msg-text");

    var meta = $("div", "message-meta");
    var time = $("span", "message-time", timeNow());

    meta.append(time);
    bubble.append(text, meta);
    content.appendChild(bubble);
    row.append(avatar, content);
    log.appendChild(row);

    scrollBottom();

    return {
      row: row,
      bubble: bubble,
      text: text,
      time: time
    };
  }

  function createUserBubble(value) {
    var row = $("div", "message-row user-row");

    var content = $("div", "message-content");
    var bubble = $("div", "msg user");

    var text = $("div", "msg-text", value);

    var meta = $("div", "message-meta");
    meta.appendChild($("span", "message-time", timeNow()));

    bubble.append(text, meta);
    content.appendChild(bubble);

    var avatar = $("div", "user-avatar");
    avatar.innerHTML = ICONS.user;
    avatar.setAttribute("aria-hidden", "true");

    row.append(content, avatar);
    log.appendChild(row);

    scrollBottom();

    return bubble;
  }

  function createErrorBubble(value) {
    var row = $("div", "message-row bot-row");
    var bubble = $("div", "msg err", value);

    row.appendChild(bubble);
    log.appendChild(row);

    scrollBottom();

    return bubble;
  }

  /* ------------------------------------------------------------------ */
  /* Typing indicator                                                   */
  /* ------------------------------------------------------------------ */

  function typingIndicator() {
    var wrapper = $("div", "typing");
    wrapper.append($("span"), $("span"), $("span"));
    return wrapper;
  }

  /* ------------------------------------------------------------------ */
  /* Ask backend                                                        */
  /* ------------------------------------------------------------------ */

  async function ask(text) {
    text = (text || "").trim();

    if (!text || busy) return;

    busy = true;
    send.disabled = true;
    chips.style.display = "none";

    createUserBubble(text);

    input.value = "";
    autoResize();
    updateCounter();

    var reply = createBotBubble();
    reply.text.textContent = "";
    reply.text.appendChild(typingIndicator());

    var full = "";
    var srcs = [];
    var isFallback = false;

    try {
      var response = await fetch("/widget/v1/chat/stream", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          source_page: boot.source_page
        })
      });

      if (response.status === 401 && expired()) return;

      if (response.status === 404 && conversationId) {
        conversationId = null;
        store(sessionStorage, convKey, "");
      }

      if (response.status === 429) {
        throw new UserError(
          "You're sending messages too quickly. Please wait a moment."
        );
      }

      if (!response.ok || !response.body) {
        throw new UserError("Something went wrong. Please try again.");
      }

      store(sessionStorage, "ob_reload", "0");

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      for (;;) {
        var result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });

        var parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].replace(/^data: ?/, "");
          if (!line) continue;

          var event;

          try {
            event = JSON.parse(line);
          } catch (e) {
            continue;
          }

          if (event.type === "meta" || event.type === "done") {
            conversationId = event.conversation_id;
            store(sessionStorage, convKey, conversationId);
          }

          if (event.type === "delta") {
            full += event.text || "";
            reply.text.textContent = cleanAssistantText(full);
            scrollBottom();
          }

          if (event.type === "replace") {
            full = event.text || "";
            reply.text.textContent = cleanAssistantText(full);
          }

          if (event.type === "done") {
            srcs = event.sources || [];
            isFallback = event.fallback === true;
          }

          if (event.type === "error") {
            throw new UserError(event.message || "Something went wrong.");
          }
        }
      }

      // if (!full) {
      //   reply.text.textContent = "Sorry, I couldn't generate an answer.";
      // }

      // /* Sources */

      // if (srcs.length) {
      //   var sourceBox = $("div", "srcs");
      //   sourceBox.appendChild($("span", "source-label", "Sources"));

      //   srcs.slice(0, 3).forEach(function (source) {
      //     var link = $("a");
      //     link.textContent = source.name || source.url || "Source";
      //     link.href = source.url || "#";
      //     link.target = "_blank";
      //     link.rel = "noopener noreferrer";
      //     sourceBox.appendChild(link);
      //   });

      //   log.appendChild(sourceBox);
      // }
      if (!full) {
        reply.text.textContent =
          "Sorry, I couldn't generate an answer.";
      }


      /* ------------------------------------------------------------------ */
      /* URL-backed answer rendering                                        */
      /* ------------------------------------------------------------------ */

      var cleanSources = renderUrlSources(srcs);
      if (cleanSources.length) {
        var sourceBox = $("div", "srcs");
        sourceBox.appendChild($("span", "source-label", "Sources"));

        cleanSources.forEach(function (source) {
          var link = $("a", "source-link");
          link.textContent = source.name;
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          sourceBox.appendChild(link);
        });

        log.appendChild(sourceBox);
      }
      if (full && cleanSources.length) {
        reply.text.innerHTML =
          renderAssistantMarkdown(full);
      }
      if (isFallback && boot.lead_capture_enabled) {
        leadForm(text);
      }

      // /* ------------------------------------------------------------------ */
      // /* Sources                                                            */
      // /* ------------------------------------------------------------------ */

      // if (cleanSources.length) {

      //   var sourceBox =
      //     $("div", "srcs url-sources");

      //   sourceBox.appendChild(
      //     $("span", "source-label", "Sources")
      //   );


      //   cleanSources.forEach(function (source) {

      //     var link =
      //       $("a", "source-link");

      //     link.textContent =
      //       source.name;

      //     link.href =
      //       source.url;

      //     link.target =
      //       "_blank";

      //     link.rel =
      //       "noopener noreferrer";

      //     sourceBox.appendChild(link);
      //   });


      //   log.appendChild(sourceBox);
      // }
      /* Auto speech */

      if (autoSpeak && full) {
        speakText(full, null);
      }

      scrollBottom();
    } catch (error) {
      reply.row.remove();

      createErrorBubble(
        error instanceof UserError
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      busy = false;
      send.disabled = false;
      scrollBottom();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lead capture                                                       */
  /* ------------------------------------------------------------------ */

  function leadForm(question) {
    if (leadDone) return;
    leadDone = true;

    var card = $("div", "msg bot lead");

    card.appendChild(
      $("div", "", "Would you like to leave your contact details so the team can help?")
    );

    var form = $("form", "leadform");

    function field(placeholder, type, autocomplete) {
      var el = $("input");
      el.type = type;
      el.placeholder = placeholder;
      el.maxLength = 254;
      el.autocomplete = autocomplete;
      el.setAttribute("aria-label", placeholder);
      form.appendChild(el);
      return el;
    }

    var name = field("Your name", "text", "name");
    var email = field("Email", "email", "email");
    var phone = field("Phone (optional)", "tel", "tel");

    var message = $("div", "leadmsg");
    var row = $("div", "leadrow");

    var submit = $("button", "lead-submit", "Send");
    submit.type = "submit";

    var no = $("button", "lead-cancel", "No thanks");
    no.type = "button";

    row.append(submit, no);
    form.append(message, row);
    card.appendChild(form);
    log.appendChild(card);

    scrollBottom();

    no.addEventListener("click", function () {
      card.remove();
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      message.textContent = "";

      if (!email.value.trim() && !phone.value.trim()) {
        message.textContent = "Please add an email or phone number.";
        return;
      }

      submit.disabled = true;

      try {
        var response = await fetch("/widget/v1/lead", {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({
            name: name.value,
            email: email.value,
            phone: phone.value,
            question: question,
            conversation_id: conversationId,
            source_page: boot.source_page
          })
        });

        if (response.status === 422) {
          message.textContent = "Please check your email or phone number.";
          submit.disabled = false;
          return;
        }

        if (!response.ok) throw new Error();

        card.textContent = "Thanks! The team will get back to you soon.";
      } catch (error) {
        message.textContent = "Sorry, that didn't go through. Please try again.";
        submit.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Browser-native microphone                                          */
  /* ------------------------------------------------------------------ */

  function setupSpeechRecognition() {
    if (!micButton || !SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang =
      document.documentElement.lang || navigator.language || "en-US";

    recognition.onstart = function () {
      listening = true;
      micButton.classList.add("recording");
      micButton.innerHTML = ICONS.stop;
      micButton.setAttribute("aria-label", "Stop listening");
      input.classList.add("listening");
    };

    recognition.onresult = function (event) {
      var transcript = "";

      for (var i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      if (transcript.trim()) {
        input.value = transcript.trim();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };

    recognition.onerror = function (event) {
      if (event.error === "not-allowed") {
        createErrorBubble("Microphone access was denied.");
      } else if (event.error !== "aborted") {
        createErrorBubble("Voice input isn't available right now.");
      }
    };

    recognition.onend = function () {
      listening = false;
      micButton.classList.remove("recording");
      micButton.innerHTML = ICONS.mic;
      micButton.setAttribute("aria-label", "Speak your question");
      input.classList.remove("listening");
      input.focus();
    };

    micButton.addEventListener("click", function () {
      if (listening) {
        recognition.stop();
        return;
      }

      try {
        stopSpeaking();
        recognition.start();
      } catch (error) {
        /* SpeechRecognition can throw if started twice. */
      }
    });
  }

  setupSpeechRecognition();

  /* ------------------------------------------------------------------ */
  /* Composer interactions                                              */
  /* ------------------------------------------------------------------ */

  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 130) + "px";
  }

  input.addEventListener("input", function () {
    autoResize();
    updateCounter();
  });

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    ask(input.value);
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Launcher / close                                                   */
  /* ------------------------------------------------------------------ */

  launcher.addEventListener("click", function () {
    setOpen(true);
  });

  close.addEventListener("click", function () {
    setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && open) {
      setOpen(false);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Initial welcome message                                            */
  /* ------------------------------------------------------------------ */

  var welcome = createBotBubble();

  welcome.text.textContent = cleanAssistantText(
    boot.welcome_message || "Hi! How can I help you today?"
  );

  /* ------------------------------------------------------------------ */
  /* Suggested questions                                                */
  /* ------------------------------------------------------------------ */

  (boot.suggested_questions || []).slice(0, 4).forEach(function (question) {
    var button = $("button", "suggestion");
    button.type = "button";
    button.textContent = String(question).slice(0, 120);

    button.addEventListener("click", function () {
      ask(question);
    });

    chips.appendChild(button);
  });

  /* ------------------------------------------------------------------ */
  /* Notify loader                                                      */
  /* ------------------------------------------------------------------ */

  post({
    type: "ready",
    position: boot.position
  });
})();