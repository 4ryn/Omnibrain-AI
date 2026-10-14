// /*! OmniBrain loader.
//  *  Usage:
//  *  <script async src="https://YOUR-DOMAIN/widget.js" data-workspace="wk_..."></script>
//  *
//  *  Framework-independent, no dependencies.
//  *  The chat UI lives inside a cross-origin iframe.
//  */
// (function () {
//   "use strict";

//   /* --------------------------------------------------------------- */
//   /* Prevent duplicate loading                                       */
//   /* --------------------------------------------------------------- */

//   if (window.__omnibrainLoaded) {
//     return;
//   }

//   var script =
//     document.currentScript ||
//     document.querySelector(
//       'script[data-workspace][src*="widget.js"]'
//     );

//   if (!script) {
//     return;
//   }

//   var workspace =
//     script.getAttribute("data-workspace");

//   if (!workspace) {
//     console.warn(
//       "[OmniBrain] missing data-workspace attribute"
//     );
//     return;
//   }

//   window.__omnibrainLoaded = true;

//   /* --------------------------------------------------------------- */
//   /* Configuration                                                    */
//   /* --------------------------------------------------------------- */

//   var base =
//     new URL(
//       script.src,
//       window.location.href
//     ).origin;

//   var CLOSED_SIZE = 76;

//   var OPEN_WIDTH = 392;
//   var OPEN_HEIGHT = 640;

//   var MOBILE_BREAKPOINT = 520;

//   var EDGE_OFFSET = 12;

//   var frame = null;

//   var open = false;

//   var position = "bottom-right";

//   /* --------------------------------------------------------------- */
//   /* Apply iframe layout                                              */
//   /* --------------------------------------------------------------- */

//   function layout() {
//     if (!frame) {
//       return;
//     }

//     var style = frame.style;

//     var mobile =
//       window.innerWidth <=
//       MOBILE_BREAKPOINT;

//     /*
//      * Reset everything first so stale left/right/top/bottom
//      * values cannot interfere when switching between states.
//      */

//     style.position = "fixed";

//     style.border = "0";
//     style.margin = "0";
//     style.padding = "0";

//     style.background = "transparent";

//     style.zIndex = "2147483647";

//     style.display = "block";

//     style.overflow = "hidden";

//     style.visibility = "visible";

//     style.maxWidth = "100vw";
//     style.maxHeight = "100vh";

//     style.minWidth = "0";
//     style.minHeight = "0";

//     style.boxSizing = "border-box";

//     /*
//      * Do not animate iframe dimensions.
//      * The actual panel has its own visual transitions.
//      */

//     style.transition = "none";

//     if (open && mobile) {
//       /*
//        * Mobile:
//        * occupy the complete viewport.
//        */

//       style.top = "0";
//       style.right = "0";
//       style.bottom = "0";
//       style.left = "0";

//       style.width = "100vw";
//       style.height = "100vh";

//       return;
//     }

//     /*
//      * Desktop / tablet.
//      */

//     style.top = "auto";
//     style.left = "auto";

//     if (open) {
//       var width = Math.min(
//         OPEN_WIDTH,
//         window.innerWidth - EDGE_OFFSET * 2
//       );

//       var height = Math.min(
//         OPEN_HEIGHT,
//         window.innerHeight - EDGE_OFFSET * 2
//       );

//       style.width =
//         Math.max(width, 300) + "px";

//       style.height =
//         Math.max(height, 420) + "px";

//       style.bottom =
//         EDGE_OFFSET + "px";

//       if (
//         position === "bottom-left"
//       ) {
//         style.left =
//           EDGE_OFFSET + "px";

//         style.right = "auto";
//       } else {
//         style.right =
//           EDGE_OFFSET + "px";

//         style.left = "auto";
//       }

//     } else {
//       /*
//        * Closed launcher.
//        */

//       style.width =
//         CLOSED_SIZE + "px";

//       style.height =
//         CLOSED_SIZE + "px";

//       style.bottom =
//         EDGE_OFFSET + "px";

//       if (
//         position === "bottom-left"
//       ) {
//         style.left =
//           EDGE_OFFSET + "px";

//         style.right = "auto";
//       } else {
//         style.right =
//           EDGE_OFFSET + "px";

//         style.left = "auto";
//       }
//     }
//   }

//   /* --------------------------------------------------------------- */
//   /* Create iframe                                                    */
//   /* --------------------------------------------------------------- */

//   function init() {
//     frame =
//       document.createElement("iframe");

//     frame.title =
//       "OmniBrain AI Assistant";

//     frame.setAttribute(
//       "aria-label",
//       "OmniBrain AI Assistant"
//     );

//     frame.setAttribute(
//       "referrerpolicy",
//       "origin"
//     );

//     /*
//      * Required for browser microphone permission.
//      */

//     frame.setAttribute(
//       "allow",
//       "microphone"
//     );

//     /*
//      * Prevent iframe scrollbars.
//      */

//     frame.setAttribute(
//       "scrolling",
//       "no"
//     );

//     frame.setAttribute(
//       "frameborder",
//       "0"
//     );

//     /*
//      * Explicit iframe source.
//      */

//     frame.src =
//       base +
//       "/widget/frame?w=" +
//       encodeURIComponent(workspace) +
//       "&p=" +
//       encodeURIComponent(
//         window.location.href.slice(
//           0,
//           1000
//         )
//       ) +
//       "&o=" +
//       encodeURIComponent(
//         window.location.origin
//       );

//     /*
//      * Set initial launcher size before
//      * inserting into the page.
//      */

//     open = false;

//     layout();

//     /*
//      * IMPORTANT:
//      * Register message listener BEFORE appending
//      * the iframe so we cannot miss an early
//      * "ready" message.
//      */

//     window.addEventListener(
//       "message",
//       function (event) {
//         if (
//           !frame ||
//           event.source !==
//             frame.contentWindow
//         ) {
//           return;
//         }

//         var data =
//           event.data;

//         if (
//           !data ||
//           data.source !==
//             "omnibrain"
//         ) {
//           return;
//         }

//         /* --------------------------------------------------------- */
//         /* Frame ready                                                */
//         /* --------------------------------------------------------- */

//         if (
//           data.type === "ready"
//         ) {
//           if (
//             /^bottom-(left|right)$/.test(
//               data.position
//             )
//           ) {
//             position =
//               data.position;
//           }

//           layout();

//           return;
//         }

//         /* --------------------------------------------------------- */
//         /* Open / close state                                         */
//         /* --------------------------------------------------------- */

//         if (
//           data.type === "state"
//         ) {
//           open =
//             data.open === true;

//           /*
//            * Resize immediately.
//            */

//           layout();

//           /*
//            * Run a second layout on the next
//            * animation frame to handle browsers
//            * that update iframe content dimensions
//            * asynchronously.
//            */

//           window.requestAnimationFrame(
//             function () {
//               layout();
//             }
//           );
//         }
//       }
//     );

//     /*
//      * Now insert iframe.
//      */

//     document.body.appendChild(
//       frame
//     );

//     /*
//      * Make sure the initial dimensions
//      * are applied after insertion.
//      */

//     layout();

//     /*
//      * Recalculate after iframe loads.
//      */

//     frame.addEventListener(
//       "load",
//       function () {
//         layout();
//       }
//     );

//     /*
//      * Handle viewport changes.
//      */

//     window.addEventListener(
//       "resize",
//       layout,
//       {
//         passive: true
//       }
//     );

//     window.addEventListener(
//       "orientationchange",
//       function () {
//         window.setTimeout(
//           layout,
//           50
//         );
//       },
//       {
//         passive: true
//       }
//     );
//   }

//   /* --------------------------------------------------------------- */
//   /* Start                                                             */
//   /* --------------------------------------------------------------- */

//   if (
//     document.body
//   ) {
//     init();
//   } else {
//     document.addEventListener(
//       "DOMContentLoaded",
//       init,
//       {
//         once: true
//       }
//     );
//   }
// })();
/*! OmniBrain loader.
 *  Usage:
 *  <script async src="https://YOUR-DOMAIN/widget.js" data-workspace="wk_..."></script>
 *
 *  Framework-independent, no dependencies.
 *  The chat UI lives inside a cross-origin iframe.
 */
(function () {
  "use strict";

  if (window.__omnibrainLoaded) return;

  var script =
    document.currentScript ||
    document.querySelector('script[data-workspace][src*="widget.js"]');

  if (!script) return;

  var workspace = script.getAttribute("data-workspace");

  if (!workspace) {
    console.warn("[OmniBrain] missing data-workspace attribute");
    return;
  }

  // window.__omnibrainLoaded = true;

  /* --------------------------------------------------------------- */
  /* Configuration                                                    */
  /* --------------------------------------------------------------- */

  var base;

  try {
    var scriptUrl = new URL(script.src, window.location.href);

    if (scriptUrl.protocol !== "https:" && scriptUrl.protocol !== "http:") {
      console.error("[OmniBrain] Unsupported widget script URL");
      return;
    }

    base = scriptUrl.origin;
  } catch (error) {
    console.error("[OmniBrain] Invalid widget script URL", error);
    return;
  }

  /*
   * Closed iframe is larger than the 64px launcher so the glow has
   * room and is never clipped into a visible square. The launcher
   * sits 24px inside this frame (see .launcher in the CSS).
   */
  var CLOSED_SIZE = 112;
  var CLOSED_OFFSET = 0;

  var OPEN_WIDTH = 392;
  var OPEN_HEIGHT = 640;
  var OPEN_OFFSET = 12;

  var MOBILE_BREAKPOINT = 520;

  var SHADOW =
    "0 22px 60px rgba(0,0,0,.32), 0 4px 18px rgba(0,0,0,.14)";

  var frame = null;
  var open = false;
  var position = "bottom-right";

  /* --------------------------------------------------------------- */
  /* Apply iframe layout                                              */
  /* --------------------------------------------------------------- */

  function layout() {
    if (!frame) return;

    var style = frame.style;
    var mobile = window.innerWidth <= MOBILE_BREAKPOINT;

    style.position = "fixed";
    style.border = "0";
    style.margin = "0";
    style.padding = "0";
    style.background = "transparent";
    style.colorScheme = "normal"; /* keeps the iframe background transparent */
    style.zIndex = "2147483647";
    style.display = "block";
    style.overflow = "hidden";
    style.visibility = "visible";
    style.maxWidth = "100vw";
    style.maxHeight = "100vh";
    style.minWidth = "0";
    style.minHeight = "0";
    style.boxSizing = "border-box";
    style.transition = "none";

    if (open && mobile) {
      /* Mobile: near full-screen rounded card */
      style.top = "8px";
      style.right = "8px";
      style.bottom = "8px";
      style.left = "8px";
      style.width = window.innerWidth - 16 + "px";
      style.height = window.innerHeight - 16 + "px";
      style.borderRadius = "20px";
      style.boxShadow = SHADOW;
      return;
    }

    style.top = "auto";
    style.left = "auto";

    var offset = open ? OPEN_OFFSET : CLOSED_OFFSET;

    if (open) {
      var availableWidth = Math.max(1, window.innerWidth - OPEN_OFFSET * 2);
      var availableHeight = Math.max(1, window.innerHeight - OPEN_OFFSET * 2);

      style.width = Math.min(OPEN_WIDTH, availableWidth) + "px";
      style.height = Math.min(OPEN_HEIGHT, availableHeight) + "px";
    } else {
      style.width = CLOSED_SIZE + "px";
      style.height = CLOSED_SIZE + "px";
    }

    /*
     * The IFRAME itself is clipped and shadowed, so the corners are
     * rounded even if the page behind it is not transparent.
     */
    style.borderRadius = open ? "21px" : "50%";
    style.boxShadow = open ? SHADOW : "none";

    style.bottom = offset + "px";

    if (position === "bottom-left") {
      style.left = offset + "px";
      style.right = "auto";
    } else {
      style.right = offset + "px";
      style.left = "auto";
    }
  }

  /* --------------------------------------------------------------- */
  /* Create iframe                                                    */
  /* --------------------------------------------------------------- */

  function init() {
    if (window.__omnibrainLoaded) return;

    if (!document.body) {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    frame = document.createElement("iframe");

    frame.title = "OmniBrain AI Assistant";
    frame.setAttribute("aria-label", "OmniBrain AI Assistant");
    frame.setAttribute("referrerpolicy", "origin");
    frame.setAttribute("allow", "microphone");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowtransparency", "true");

    frame.src =
      base +
      "/widget/frame?w=" +
      encodeURIComponent(workspace) +
      "&p=" +
      encodeURIComponent(window.location.href.slice(0, 1000)) +
      "&o=" +
      encodeURIComponent(window.location.origin);
    
    
    window.__omnibrainLoaded = true;
    open = false;
    layout();

    /* Register before appending so an early "ready" is not missed. */
    window.addEventListener("message", function (event) {
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== base) return;

      var data = event.data;

      if (!data || data.source !== "omnibrain") return;

      if (data.type === "ready") {
        readyReceived = true;
        window.clearTimeout(readyTimeout);
        if (/^bottom-(left|right)$/.test(data.position)) {
          position = data.position;
        }
        layout();
        return;
      }

      if (data.type === "state") {
        open = data.open === true;
        layout();
        window.requestAnimationFrame(layout);
      }
    });

    document.body.appendChild(frame);
    layout();

    frame.addEventListener("load", layout);
    var readyReceived = false;

    var readyTimeout = window.setTimeout(function () {
      if (!readyReceived) {
        console.error(
          "[OmniBrain] The loader ran, but the widget iframe did not send a ready signal within 15 seconds. " +
          "Check the /widget/frame and /widget/assets/frame.js requests, the site's script-src/frame-src " +
          "policies, the saved Allowed websites origin, and the frame-ancestors response header. " +
          "The browser console and Network panel can distinguish failures that the cross-origin parent cannot."
        );
      }
    }, 15000);
    window.addEventListener("resize", layout, { passive: true });

    window.addEventListener(
      "orientationchange",
      function () {
        window.setTimeout(layout, 50);
      },
      { passive: true }
    );
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();