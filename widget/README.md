# OmniBrain widget

Sources live in `src/` and are served by the backend (`/widget.js`, `/widget/frame`, `/widget/assets/*`).

- `widget.js` – tiny loader. Creates a fixed iframe pointing at `/widget/frame`. No dependencies.
- `frame.html|js|css` – the chat UI (runs inside the iframe, same origin as the API).

Snippet shown in the dashboard:

    <script async src="https://YOUR-DOMAIN/widget.js" data-workspace="wk_xxxxxxxx"></script>

Security model: no secrets in the browser; the frame is only rendered for allowed embedding origins
(Referer check + CSP `frame-ancestors`), and chat calls use a short-lived signed token bound to the workspace.
