export const TOY_UI_CSS = `:root {
  --bg: #0b1020;
  --panel: rgba(255, 255, 255, 0.06);
  --panel-2: rgba(255, 255, 255, 0.04);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.68);
  --muted-2: rgba(255, 255, 255, 0.5);
  --border: rgba(255, 255, 255, 0.12);
  --accent: #53b8ff;
  --danger: #ff5b5b;
  --ok: #51d69c;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--sans);
  background: radial-gradient(1200px 900px at 20% 10%, rgba(83, 184, 255, 0.14), transparent 60%),
    radial-gradient(900px 700px at 80% 0%, rgba(81, 214, 156, 0.1), transparent 55%),
    linear-gradient(180deg, #080b16, var(--bg));
  color: var(--text);
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.2px;
}

.title .sub {
  color: var(--muted);
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 14px;
}

@media (max-width: 940px) {
  .grid { grid-template-columns: 1fr; }
}

.card {
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.card h2 {
  margin: 0;
  padding: 12px 14px;
  font-size: 13px;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.88);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card .body {
  padding: 12px 14px;
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--muted);
}

.pill.ok { border-color: rgba(81, 214, 156, 0.45); color: rgba(81, 214, 156, 0.95); }
.pill.bad { border-color: rgba(255, 91, 91, 0.45); color: rgba(255, 91, 91, 0.92); }

.muted { color: var(--muted); }
.mono { font-family: var(--mono); }

.chat {
  height: 56vh;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}

.chatlog {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline {
  border-bottom: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline .list {
  max-height: 160px;
  overflow: auto;
}

.msg {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 10px;
  background: rgba(0, 0, 0, 0.14);
}

.msg .meta {
  font-size: 11px;
  color: var(--muted-2);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.msg .content {
  white-space: pre-wrap;
  line-height: 1.35;
  font-size: 13px;
}

.composer {
  border-top: 1px solid var(--border);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.composer textarea {
  width: 100%;
  resize: vertical;
  min-height: 80px;
  max-height: 220px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  outline: none;
  font-family: var(--sans);
  font-size: 13px;
}

.composer textarea:focus { border-color: rgba(83, 184, 255, 0.45); }

.input {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  font-size: 13px;
  outline: none;
}

.input:focus { border-color: rgba(83, 184, 255, 0.45); }

.btn {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 9px 10px;
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.btn:hover { border-color: rgba(83, 184, 255, 0.4); }
.btn.primary { border-color: rgba(83, 184, 255, 0.6); background: rgba(83, 184, 255, 0.12); }
.btn.danger { border-color: rgba(255, 91, 91, 0.6); background: rgba(255, 91, 91, 0.08); }

.kv {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 10px;
  font-size: 12px;
}

.kv .k { color: var(--muted-2); }

.codebox {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.18);
  font-family: var(--mono);
  font-size: 11px;
  white-space: pre-wrap;
  line-height: 1.3;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.14);
}

.item .row { justify-content: space-between; }

.small { font-size: 11px; color: var(--muted-2); }

.hr { height: 1px; background: var(--border); margin: 10px 0; }

.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tab {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.12);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  border-color: rgba(83, 184, 255, 0.6);
  background: rgba(83, 184, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
}

.panel { display: block; margin-top: 10px; }
.panel.hidden { display: none; }
.hidden { display: none !important; }

.inputarea {
  width: 100%;
  resize: vertical;
  min-height: 90px;
  max-height: 260px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.18);
  color: var(--text);
  outline: none;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.35;
}

.inputarea:focus { border-color: rgba(83, 184, 255, 0.45); }
`;

export const TOY_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenWork Toy UI</title>
    <link rel="icon" type="image/svg+xml" href="/ui/assets/openwork-mark.svg" />
    <link rel="stylesheet" href="/ui/assets/toy.css" />
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div class="title">
          <h1>OpenWork Toy UI</h1>
          <div class="sub">Local-first host contract harness (served by openwork-server)</div>
        </div>
        <div class="row">
          <span class="pill" id="pill-conn">disconnected</span>
          <span class="pill" id="pill-scope">scope: unknown</span>
        </div>
      </div>

      <div class="grid">
        <div class="card chat">
          <h2>
            <span>Session</span>
            <span class="small mono" id="session-id">session: -</span>
          </h2>
          <div class="timeline">
            <div class="row">
              <span class="pill" id="pill-run">idle</span>
              <span class="small" id="timeline-hint">Checkpoints stream from SSE events.</span>
            </div>
            <div class="list" id="timeline"></div>
          </div>
          <div class="chatlog" id="chatlog"></div>
          <div class="composer">
            <div class="row">
              <button class="btn" id="btn-new">New session</button>
              <button class="btn" id="btn-refresh">Refresh messages</button>
              <button class="btn" id="btn-delete-session">Delete session</button>
              <span class="small" id="hint">Tip: open this page as /w/&lt;id&gt;/ui#token=&lt;token&gt;</span>
            </div>
            <textarea id="prompt" placeholder="Write a prompt..." spellcheck="false"></textarea>
            <div class="row">
              <button class="btn primary" id="btn-send">Send prompt</button>
              <button class="btn" id="btn-skill">Turn into skill</button>
              <button class="btn" id="btn-events">Connect SSE</button>
              <button class="btn" id="btn-events-stop">Stop SSE</button>
              <span class="small" id="status"></span>
            </div>
          </div>
        </div>

        <div class="card">
          <h2><span>Host</span><span class="small mono" id="host-id">-</span></h2>
          <div class="body">
            <div class="kv">
              <div class="k">workspace</div>
              <div class="mono" id="workspace-id">-</div>
              <div class="k">workspace url</div>
              <div><a class="mono" id="workspace-url" href="#" target="_blank" rel="noreferrer">-</a></div>
              <div class="k">server</div>
              <div class="mono" id="server-version">-</div>
              <div class="k">sandbox</div>
              <div class="mono" id="sandbox">-</div>
              <div class="k">file injection</div>
              <div class="mono" id="file-injection">-</div>
            </div>

            <div class="hr"></div>

            <div class="tabs" id="tabs">
              <button class="tab active" data-tab="share">Share</button>
              <button class="tab" data-tab="skills">Skills</button>
              <button class="tab" data-tab="plugins">Plugins</button>
              <button class="tab" data-tab="apps">Apps</button>
              <button class="tab" data-tab="config">Config</button>
            </div>

            <div class="panel" data-panel="share">
              <div class="row">
                <select class="input" id="share-scope">
                  <option value="collaborator">collaborator</option>
                  <option value="viewer">viewer</option>
                </select>
                <input class="input" id="share-label" type="text" placeholder="label (optional)" />
                <button class="btn" id="btn-mint">Mint token</button>
                <button class="btn" id="btn-deploy">Deploy (Beta)</button>
              </div>
              <div class="small">Minting tokens requires an owner token (or host access).</div>

              <div class="hr"></div>

              <div class="row">
                <button class="btn" id="btn-share">Connect artifact (current token)</button>
                <button class="btn" id="btn-copy">Copy JSON</button>
                <button class="btn" id="btn-tokens">List tokens</button>
              </div>
              <div class="codebox" id="connect"></div>
              <div class="list" id="tokens"></div>

              <div class="hr"></div>

              <div class="row">
                <button class="btn" id="btn-export">Export workspace</button>
              </div>
              <div class="codebox" id="export"></div>

              <div class="hr"></div>

              <div class="row">
                <button class="btn" id="btn-import">Import workspace</button>
                <span class="small">(pastes JSON below)</span>
              </div>
              <textarea class="inputarea" id="import" placeholder="Paste export JSON..." spellcheck="false"></textarea>

              <div class="hr"></div>

              <div class="row">
                <button class="btn danger" id="btn-delete-workspace">Delete workspace</button>
                <span class="small">Removes from host config. Requires owner/host token.</span>
              </div>
            </div>

            <div class="panel hidden" data-panel="skills">
              <div class="row">
                <button class="btn" id="btn-skills-refresh">Refresh</button>
                <span class="small">Managed in <span class="mono">.opencode/skills/</span></span>
              </div>
              <div class="list" id="skills"></div>
            </div>

            <div class="panel hidden" data-panel="plugins">
              <div class="row">
                <input class="input" id="plugin-spec" type="text" placeholder="plugin spec" />
                <button class="btn" id="btn-plugin-add">Add</button>
                <button class="btn" id="btn-plugins-refresh">Refresh</button>
              </div>
              <div class="list" id="plugins"></div>
            </div>

            <div class="panel hidden" data-panel="apps">
              <div class="row">
                <button class="btn" id="btn-mcp-refresh">Refresh</button>
                <span class="small">MCP servers from <span class="mono">opencode.json</span></span>
              </div>
              <div class="list" id="mcp"></div>
            </div>

            <div class="panel hidden" data-panel="config">
              <div class="row">
                <input id="file" type="file" />
                <button class="btn" id="btn-upload">Upload to inbox</button>
              </div>
              <div class="small">Uploads go to <span class="mono">.opencode/openwork/inbox/</span> inside the workspace.</div>

              <div class="hr"></div>

              <div class="row">
                <button class="btn" id="btn-artifacts">List artifacts</button>
                <span class="small">Downloads read from <span class="mono">.opencode/openwork/outbox/</span>.</span>
              </div>
              <div class="list" id="artifacts"></div>

              <div class="hr"></div>

              <div class="row">
                <button class="btn" id="btn-approvals">Refresh approvals</button>
                <span class="small">(Owner or host token required)</span>
              </div>
              <div class="list" id="approvals"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script type="module" src="/ui/assets/toy.js"></script>
  </body>
</html>
`;

export const TOY_UI_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none"><path d="M149.333333 478.186667l55.082667 32.213333 0.448-162.346667-55.082667-32.213333z" fill="#CAEDFF"/><path d="M204.864 348.032l54.549333-32.106667-0.448 162.346667-54.549333 32.128z" fill="#0070FF"/><path d="M149.781333 315.84l55.082667 32.213333 54.549333-32.128-55.082666-32.213333z" fill="#FFFFFF"/><path d="M959.786667 733.866667c-0.021333-1.173333-0.085333-2.346667-0.149334-3.562667l-0.192-4.202667-0.256-3.2a201.28 201.28 0 0 0-0.298666-3.797333l-0.192-2.474667c-0.170667-1.792-0.384-3.584-0.597334-5.397333l-0.341333-3.114667-0.106667-1.045333c-0.426667-3.242667-0.853333-6.506667-1.386666-9.792l-0.021334-0.213333-0.256-1.429334c-0.426667-2.730667-0.896-5.461333-1.386666-8.213333l-0.298667-1.450667-0.789333-3.946666-0.96-4.778667-0.618667-2.645333c-0.298667-1.408-0.64-2.837333-0.981333-4.266667l-0.746667-3.285333-1.024-3.968-1.109333-4.266667-0.554667-2.133333c-0.512-1.856-1.066667-3.733333-1.621333-5.610667-0.362667-1.216-0.682667-2.410667-1.066667-3.626667l-0.277333-1.045333a402.389333 402.389333 0 0 0-3.2-10.069333l-0.362667-1.066667c-0.981333-2.944-1.984-5.909333-3.050667-8.874667l-0.533333-1.408c-0.384-1.109333-0.810667-2.218667-1.216-3.306666-0.597333-1.621333-1.173333-3.221333-1.792-4.821334-0.384-1.024-0.810667-2.026667-1.216-3.050666a479.210667 479.210667 0 0 0-1.472-3.712l-1.066667-2.709334-2.261333-5.354666-1.258667-2.922667-0.426666-1.002667c-1.365333-3.157333-2.773333-6.293333-4.224-9.429333l-0.192-0.405333-1.258667-2.624c-1.130667-2.410667-2.282667-4.842667-3.456-7.253334l-0.576-1.130666c-0.981333-1.962667-1.984-3.882667-2.986667-5.824-0.810667-1.578667-1.578667-3.178667-2.410666-4.736l-0.469334-0.853334a491.178667 491.178667 0 0 0-8.32-15.018666l-0.704-1.28-0.853333-1.386667c-4.074667-6.954667-8.32-13.802667-12.736-20.522667-0.213333-0.362667-0.426667-0.746667-0.682667-1.109333l-1.258666-1.813333c-3.541333-5.333333-7.168-10.624-10.922667-15.765334l-0.064-0.106666c-2.666667-3.626667-5.376-7.253333-8.128-10.794667l-0.362667-0.469333a433.28 433.28 0 0 0-6.165333-7.722667l-1.173333-1.493333a436.586667 436.586667 0 0 0-7.530667-8.896l-0.362667-0.426667-2.325333-2.602667c-1.6-1.813333-3.178667-3.626667-4.778667-5.376l-0.938666-0.981333c-1.088-1.194667-2.197333-2.346667-3.306667-3.498667l-3.626667-3.882666-1.386666-1.365334c-1.194667-1.237333-2.410667-2.432-3.626667-3.626666l-3.093333-3.114667-1.813334-1.706667a378.24 378.24 0 0 0-3.946666-3.712l-2.709334-2.56-2.197333-1.92c-1.301333-1.194667-2.645333-2.346667-3.968-3.52l-2.410667-2.133333c-0.853333-0.746667-1.749333-1.450667-2.624-2.176l-3.925333-3.242667c-0.682667-0.533333-1.344-1.109333-2.005333-1.664l-3.328-2.56-3.648-2.816-1.493334-1.152c-1.493333-1.109333-2.986667-2.154667-4.501333-3.242666-1.024-0.746667-2.026667-1.493333-3.050667-2.197334a288.490667 288.490667 0 0 0-8.96-6.037333l-0.682666-0.426667a265.728 265.728 0 0 0-7.488-4.650666l-1.898667-1.109334-228.032-133.333333a244.693333 244.693333 0 0 0-6.122667-3.477333l-2.304-1.216a225.066667 225.066667 0 0 0-3.136-1.642667l-2.453333-1.28c-1.28-0.64-2.56-1.237333-3.861333-1.856l-2.773334-1.322667-1.152-0.533333a208.384 208.384 0 0 0-15.488-6.272l-0.981333-0.341333-2.794667-0.917334c-1.301333-0.426667-2.624-0.896-3.925333-1.301333-0.64-0.213333-1.28-0.362667-1.92-0.533333l-3.413333-0.96c-0.853333-0.234667-1.749333-0.512-2.624-0.725334-0.917333-0.234667-1.813333-0.405333-2.709334-0.618666a142.912 142.912 0 0 0-3.392-0.768l-1.792-0.405334c-1.066667-0.213333-2.090667-0.341333-3.136-0.512-1.322667-0.213333-2.624-0.469333-3.925333-0.64l-1.365333-0.256-3.178667-0.32c-1.408-0.149333-2.773333-0.32-4.181333-0.426666l-1.216-0.128c-0.917333-0.064-1.834667-0.042667-2.773334-0.085334a122.688 122.688 0 0 0-4.885333-0.170666l-1.365333-0.042667c-0.725333 0-1.408 0.085333-2.112 0.085333-2.026667 0.064-4.053333 0.149333-6.058667 0.298667l-1.813333 0.085333c-0.448 0.042667-0.874667 0.149333-1.322667 0.213334a101.674667 101.674667 0 0 0-9.024 1.301333l-0.768 0.128-0.213333 0.042667-1.749334 0.426666c-1.834667 0.426667-3.690667 0.853333-5.482666 1.365334-0.853333 0.234667-1.706667 0.533333-2.56 0.810666-1.152 0.362667-2.304 0.682667-3.434667 1.088-0.298667 0.106667-0.554667 0.256-0.853333 0.341334-1.706667 0.64-3.413333 1.365333-5.077334 2.112-0.810667 0.362667-1.664 0.682667-2.474666 1.066666a91.136 91.136 0 0 0-7.189334 3.797334l-167.850666 98.773333c2.346667-1.365333 4.757333-2.624 7.210666-3.797333 0.810667-0.384 1.642667-0.704 2.474667-1.066667a91.754667 91.754667 0 0 1 9.344-3.52l2.56-0.832c1.813333-0.512 3.648-0.938667 5.482667-1.365333l1.770666-0.426667 0.96-0.149333a106.325333 106.325333 0 0 1 18.24-1.898667l3.456-0.064c1.621333 0.021333 3.264 0.106667 4.906667 0.170667 1.322667 0.064 2.645333 0.106667 3.989333 0.213333l4.16 0.426667c1.514667 0.192 3.029333 0.341333 4.565334 0.576l3.904 0.64a143.125333 143.125333 0 0 1 13.653333 3.029333 160.128 160.128 0 0 1 9.258667 2.794667c0.938667 0.32 1.856 0.597333 2.794666 0.938666 5.781333 2.026667 11.669333 4.394667 17.621334 7.146667l2.773333 1.322667a244.010667 244.010667 0 0 1 17.898667 9.450666l228.032 133.333334c3.136 1.856 6.272 3.776 9.386666 5.781333l0.576 0.362667c3.029333 1.962667 6.058667 3.989333 9.045334 6.08l3.050666 2.218666c2.005333 1.429333 4.010667 2.88 5.994667 4.373334l3.648 2.816a350.016 350.016 0 0 1 18.282667 15.296 312.832 312.832 0 0 1 8.832 8.213333l4.906666 4.8 3.626667 3.626667c1.706667 1.728 3.349333 3.498667 5.034667 5.248l3.306666 3.52c1.92 2.069333 3.818667 4.202667 5.696 6.357333l2.346667 2.602667c2.645333 3.050667 5.269333 6.165333 7.872 9.322666l1.194667 1.493334a439.189333 439.189333 0 0 1 14.634666 18.986666l0.064 0.106667c3.754667 5.141333 7.381333 10.432 10.944 15.744l1.941334 2.944c4.394667 6.72 8.64 13.568 12.714666 20.522667 0.512 0.874667 1.066667 1.770667 1.557334 2.666666 2.88 4.949333 5.653333 9.962667 8.32 15.018667 0.981333 1.834667 1.92 3.712 2.88 5.568 1.002667 1.941333 2.026667 3.882667 2.986666 5.845333 1.386667 2.773333 2.709333 5.568 4.053334 8.362667l1.258666 2.645333c1.664 3.584 3.264 7.210667 4.842667 10.816l1.237333 2.922667a469.909333 469.909333 0 0 1 7.808 19.648l1.237334 3.328c1.237333 3.413333 2.432 6.848 3.584 10.282667 0.085333 0.32 0.213333 0.64 0.32 0.938666 1.237333 3.754667 2.410667 7.488 3.52 11.242667l1.066666 3.626667c0.725333 2.56 1.472 5.162667 2.154667 7.744l1.109333 4.266666c0.618667 2.410667 1.216 4.842667 1.792 7.253334l0.981334 4.266666c0.554667 2.474667 1.066667 4.949333 1.557333 7.424l0.789333 3.925334c0.618667 3.242667 1.173333 6.464 1.706667 9.685333l0.234667 1.429333c0.576 3.690667 1.066667 7.381333 1.536 11.050667l0.341333 3.114667a300.522667 300.522667 0 0 1 1.536 19.072l0.149333 3.562666a267.904 267.904 0 0 1-0.064 21.184c-0.042667 0.981333-0.128 1.941333-0.192 2.922667-0.128 2.410667-0.277333 4.8-0.490666 7.168l-0.426667 4.053333a198.826667 198.826667 0 0 1-4.202667 24.746667 170.048 170.048 0 0 1-4.565333 15.616c-0.384 1.088-0.746667 2.197333-1.152 3.285333a122.453333 122.453333 0 0 1-11.690667 23.808 109.098667 109.098667 0 0 1-14.506666 18.197334l-0.512 0.533333a94.528 94.528 0 0 1-9.685334 8.277333c-2.730667 2.048-5.546667 3.989333-8.469333 5.717334l167.850667-98.773334a91.541333 91.541333 0 0 0 10.432-7.253333c2.666667-2.090667 5.248-4.309333 7.722666-6.741333l0.512-0.533334c2.304-2.325333 4.501333-4.8 6.613334-7.381333l1.621333-2.005333c2.197333-2.794667 4.288-5.717333 6.250667-8.832l0.192-0.234667c2.624-4.181333 5.056-8.64 7.253333-13.333333l0.149333-0.341334c1.472-3.2 2.837333-6.485333 4.117334-9.898666l0.362666-0.853334 0.789334-2.432a153.386667 153.386667 0 0 0 2.026666-6.186666l0.533334-1.642667 0.64-2.432c0.469333-1.770667 0.938667-3.541333 1.365333-5.333333l0.554667-2.197334c0.192-0.810667 0.32-1.664 0.490666-2.474666 0.341333-1.536 0.64-3.093333 0.938667-4.672l0.469333-2.389334c0.170667-0.938667 0.277333-1.941333 0.426667-2.901333l0.64-4.266667 0.298667-2.133333c0.149333-1.237333 0.256-2.496 0.384-3.754667l0.426666-4.053333 0.149334-1.6c0.149333-1.813333 0.234667-3.690667 0.341333-5.546667l0.170667-2.922666 0.064-0.725334c0.128-3.093333 0.213333-6.229333 0.213333-9.429333v-0.554667c0-2.922667-0.021333-5.845333-0.128-8.789333l-0.064-1.685333z" fill="#FFFFFF"/><path d="M959.104 815.616l-1.834667 4.672-1.450666 3.477333-1.706667 3.84a134.016 134.016 0 0 1-5.12 9.856l-2.901333 4.821334a121.109333 121.109333 0 0 1-4.48 6.528l-4.16 5.333333a120.554667 120.554667 0 0 1-4.949334 5.717333l-3.008 3.136c-1.706667 1.706667-3.541333 3.349333-5.525333 5.013334l-5.269333 4.181333a114.048 114.048 0 0 1-6.357334 4.48l-3.072 1.92-167.850666 98.773333-10.816-18.389333 167.829333-98.773333c1.557333-0.917333 3.136-1.941333 4.821333-3.136l4.394667-3.264c1.770667-1.408 3.349333-2.730667 4.842667-4.074667l2.474666-2.410667 2.922667-3.093333 4.458667-5.290667c1.429333-1.834667 2.730667-3.626667 3.882666-5.290666l2.154667-3.306667 2.133333-3.541333 2.24-4.096 2.154667-4.458667c0.874667-1.877333 1.728-3.84 2.581333-5.973333l1.706667-4.373334 3.050667-9.344 2.794666-11.477333 2.090667-11.733333 1.450667-12.693334 0.533333-8.746666 0.149333-4.48 0.042667-8.064-0.768-17.706667-0.533333-6.72-0.938667-8.533333-0.64-4.693334-2.005333-12.586666-3.072-15.018667-4.117334-16.576-2.901333-10.026667-3.456-10.837333-7.637333-20.970667-6.314667-15.338666-8.213333-17.749334-7.018667-13.76-3.925333-7.253333-5.738667-10.026667a479.530667 479.530667 0 0 0-8.234667-13.546666l-6.101333-9.386667a524.245333 524.245333 0 0 0-7.36-10.773333l-3.392-4.736-3.84-5.184-7.509333-9.728-4.096-5.056-3.733334-4.48-11.797333-13.376-6.72-7.146667-9.664-9.557333-8.597333-7.957334-8.106667-7.061333-14.549333-11.584-8.064-5.824-3.882667-2.645333-4.629333-3.008-3.626667-2.282667-5.376-3.242667-230.976-135.04-11.712-6.186666-6.08-2.901334a199.466667 199.466667 0 0 0-7.402667-3.178666l-3.712-1.472-11.264-3.84-9.6-2.56-5.696-1.216-7.68-1.237334-7.637333-0.746666-8.213333-0.213334-4.245334 0.149334-4.202666 0.213333-5.504 0.725333-5.290667 0.938667-6.656 1.706667-4.693333 1.493333-3.349334 1.344-3.968 1.706667a80.426667 80.426667 0 0 0-6.357333 3.370666l-139.818667 82.282667-10.816-18.389333 139.797334-82.282667c2.538667-1.493333 5.205333-2.901333 8.021333-4.224l4.906667-2.133333 5.290666-2.069334 5.866667-1.856 1.877333-0.512 6.421334-1.536 5.632-0.938666 6.592-0.853334 5.205333-0.298666 5.738667-0.213334 9.685333 0.32 9.472 0.981334 10.837333 1.92 6.506667 1.472 8.512 2.346666 8.149333 2.730667c2.688 0.96 5.418667 1.984 8.213334 3.114667l4.053333 1.706666 13.290667 6.229334 7.146666 3.754666 3.2 1.792 233.194667 136.341334 8.469333 5.248 4.288 2.816 14.4 10.282666 9.258667 7.253334 6.784 5.610666 11.605333 10.453334 6.698667 6.314666 8.981333 9.088 8.426667 9.045334 5.888 6.634666 5.098667 5.973334 6.165333 7.573333 4.330667 5.504c1.962667 2.517333 3.84 4.992 5.546666 7.296l5.504 7.573333 10.496 15.402667c2.965333 4.48 5.866667 9.109333 8.746667 13.824l5.866667 9.877333 5.76 10.261334 4.053333 7.594666 6.08 11.946667 4.224 8.896 2.197333 4.8 7.701334 18.24 5.930666 15.573333 3.498667 10.176 5.994667 19.776 5.482666 22.229334 2.56 13.034666 1.28 7.616 0.746667 5.034667 0.96 7.616 1.578667 17.152 0.448 9.770667 0.106666 5.930666-0.042666 8.810667-0.917334 16.106667-0.981333 9.173333-1.813333 11.328-1.770667 8.704-2.453333 9.472-1.578667 4.906667-1.984 5.973333z" fill="#0E1F3B"/><path d="M600.298667 506.56c106.304 62.165333 192.213333 212.842667 191.850666 336.576-0.341333 123.733333-86.805333 173.610667-193.109333 111.445333l-228.053333-133.333333c-106.304-62.165333-192.213333-212.864-191.893334-336.597333 0.362667-123.733333 86.826667-173.610667 193.152-111.445334l228.053334 133.333334z" fill="#CAEDFF"/><path d="M362.24 528.192c15.189333 8.896 27.456 30.421333 27.413333 48.106667l-0.149333 52.778666c-0.042667 17.706667-12.394667 24.832-27.605333 15.936-15.210667-8.874667-27.477333-30.421333-27.434667-48.106666l0.149333-52.778667c0.042667-17.706667 12.394667-24.832 27.605334-15.936" fill="#0070FF"/><path d="M567.637333 252.821333l-0.448 157.141334-50.218666-29.354667 0.426666-157.141333z" fill="#D7F4FF"/><path d="M567.637333 252.821333l54.549334-32.106666-0.448 157.141333-54.549334 32.106667z" fill="#005DD4"/><path d="M517.418667 223.466667L571.946667 191.36l50.218666 29.376-54.549333 32.085333z" fill="#2F56B5"/><path d="M575.232 671.509333c15.210667 8.874667 27.477333 30.421333 27.434667 48.106667l-0.149334 52.778667c-0.042667 17.706667-12.394667 24.832-27.605333 15.936-15.210667-8.896-27.477333-30.421333-27.434667-48.106667l0.149334-52.778667c0.042667-17.706667 12.394667-24.832 27.605333-15.936" fill="#0070FF"/><path d="M892.245333 802.410667l-0.469333 162.346666-55.082667-32.213333 0.469334-162.346667z" fill="#CAEDFF"/><path d="M892.245333 802.410667l54.549334-32.106667-0.469334 162.346667-54.549333 32.106666z" fill="#0070FF"/><path d="M837.162667 770.197333l54.549333-32.106666 55.082667 32.213333-54.549334 32.106667z" fill="#5FA5FF"/><path d="M569.557333 280.298667c-64.768 0-117.290667-53.205333-117.290666-118.826667C452.266667 95.872 504.789333 42.666667 569.557333 42.666667c64.789333 0 117.333333 53.205333 117.333334 118.826666 0 65.6-52.544 118.805333-117.333334 118.805334" fill="#5BC7FF"/><path d="M64 632.106667L259.328 746.666667l0.213333-85.44-195.306666-114.56z" fill="#0070FF"/><path d="M259.84 660.8L259.541333 746.666667l38.826667-20.8L298.666667 640z" fill="#61A6FF"/><path d="M99.690667 533.333333L64 553.728l198.976 112.938667L298.666667 646.272z" fill="#5FA5FF"/><path d="M64 845.44L259.328 960l0.213333-85.44-195.306666-114.56z" fill="#6DD400"/><path d="M259.84 874.133333L259.541333 960l38.826667-20.8L298.666667 853.333333z" fill="#92EC34"/><path d="M99.690667 746.666667L64 767.061333l198.976 112.938667L298.666667 859.605333z" fill="#92EC34"/></svg>`;

export const TOY_UI_JS = String.raw`const qs = (sel) => document.querySelector(sel);

const pillConn = qs("#pill-conn");
const pillScope = qs("#pill-scope");
const chatlog = qs("#chatlog");
const promptEl = qs("#prompt");
const statusEl = qs("#status");
const sessionIdEl = qs("#session-id");
const workspaceIdEl = qs("#workspace-id");
const serverVersionEl = qs("#server-version");
const sandboxEl = qs("#sandbox");
const fileInjectionEl = qs("#file-injection");
const artifactsEl = qs("#artifacts");
const approvalsEl = qs("#approvals");
const connectEl = qs("#connect");
const tokensEl = qs("#tokens");
const exportEl = qs("#export");
const importEl = qs("#import");
const skillsEl = qs("#skills");
const pluginsEl = qs("#plugins");
const pluginSpecEl = qs("#plugin-spec");
const mcpEl = qs("#mcp");
const hostIdEl = qs("#host-id");
const pillRun = qs("#pill-run");
const timelineEl = qs("#timeline");
const workspaceUrlEl = qs("#workspace-url");
const shareScopeEl = qs("#share-scope");
const shareLabelEl = qs("#share-label");
const tabsEl = qs("#tabs");

const STORAGE_TOKEN = "openwork.toy.token";
const STORAGE_SESSION_PREFIX = "openwork.toy.session.";

function setPill(el, label, kind) {
  el.textContent = label;
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

function setRun(label, kind) {
  if (!pillRun) return;
  setPill(pillRun, label, kind);
}

function clearTimeline() {
  if (!timelineEl) return;
  timelineEl.innerHTML = "";
}

function summarizeEvent(payload) {
  if (!payload || typeof payload !== "object") return "";
  const keys = ["name", "tool", "action", "summary", "status", "message"];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function addCheckpoint(label, detail) {
  if (!timelineEl) return;

  const row = document.createElement("div");
  row.className = "item";

  const top = document.createElement("div");
  top.className = "row";

  const left = document.createElement("div");
  const name = document.createElement("div");
  name.className = "mono";
  name.textContent = label;

  const meta = document.createElement("div");
  meta.className = "small";
  meta.textContent = new Date().toLocaleTimeString();

  left.appendChild(name);
  left.appendChild(meta);
  top.appendChild(left);
  row.appendChild(top);

  if (detail) {
    const d = document.createElement("div");
    d.className = "small";
    d.textContent = detail;
    row.appendChild(d);
  }

  timelineEl.appendChild(row);
  timelineEl.scrollTop = timelineEl.scrollHeight;

  while (timelineEl.children.length > 80) {
    timelineEl.removeChild(timelineEl.firstChild);
  }
}

let activeTab = "share";

function setTab(tab) {
  activeTab = tab;
  if (tabsEl) {
    const buttons = tabsEl.querySelectorAll(".tab");
    buttons.forEach((btn) => {
      const t = btn.getAttribute("data-tab") || "";
      btn.classList.toggle("active", t === tab);
    });
  }

  const panels = document.querySelectorAll(".panel");
  panels.forEach((panel) => {
    const t = panel.getAttribute("data-panel") || "";
    panel.classList.toggle("hidden", t !== tab);
  });
}

function getTokenFromHash() {
  const raw = (location.hash || "").startsWith("#") ? (location.hash || "").slice(1) : (location.hash || "");
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  return (params.get("token") || "").trim();
}

function stripHashToken() {
  const raw = (location.hash || "").startsWith("#") ? (location.hash || "").slice(1) : (location.hash || "");
  if (!raw) return;
  const params = new URLSearchParams(raw);
  if (!params.has("token")) return;
  params.delete("token");
  const next = params.toString();
  const url = location.pathname + location.search + (next ? "#" + next : "");
  history.replaceState(null, "", url);
}

function readToken() {
  const fromHash = getTokenFromHash();
  if (fromHash) {
    try { localStorage.setItem(STORAGE_TOKEN, fromHash); } catch {}
    stripHashToken();
    return fromHash;
  }
  try {
    return (localStorage.getItem(STORAGE_TOKEN) || "").trim();
  } catch {
    return "";
  }
}

function parseWorkspaceIdFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const wIndex = parts.indexOf("w");
  if (wIndex !== -1 && parts[wIndex + 1]) return decodeURIComponent(parts[wIndex + 1]);
  return "";
}

async function apiFetch(path, options) {
  const token = readToken();
  const opts = options || {};
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", "Bearer " + token);
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json && json.message ? json.message : (text || res.statusText);
    const code = json && json.code ? json.code : "request_failed";
    const err = new Error(code + ": " + msg);
    err.status = res.status;
    err.code = code;
    err.details = json && json.details ? json.details : undefined;
    throw err;
  }
  return json;
}

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.style.color = kind === "bad" ? "var(--danger)" : kind === "ok" ? "var(--ok)" : "var(--muted)";
}

function appendMsg(role, text) {
  const el = document.createElement("div");
  el.className = "msg";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = role;
  const content = document.createElement("div");
  content.className = "content";
  content.textContent = text;
  el.appendChild(meta);
  el.appendChild(content);
  chatlog.appendChild(el);
  chatlog.scrollTop = chatlog.scrollHeight;
}

function renderMessages(items) {
  chatlog.innerHTML = "";
  if (!Array.isArray(items) || !items.length) {
    appendMsg("system", "No messages yet.");
    return;
  }
  for (const msg of items) {
    const info = msg && msg.info ? msg.info : null;
    const parts = Array.isArray(msg && msg.parts) ? msg.parts : [];
    const role = info && info.role ? info.role : "message";
    const textParts = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text);
    const body = textParts.length ? textParts.join("\n") : JSON.stringify(parts, null, 2);
    appendMsg(role, body);
  }
}

function sessionKey(workspaceId) {
  return STORAGE_SESSION_PREFIX + workspaceId;
}

function readSessionId(workspaceId) {
  try { return (localStorage.getItem(sessionKey(workspaceId)) || "").trim(); } catch { return ""; }
}

function writeSessionId(workspaceId, sessionId) {
  try { localStorage.setItem(sessionKey(workspaceId), sessionId); } catch {}
}

async function resolveDefaultModel(workspaceId) {
  try {
    const providers = await apiFetch("/w/" + encodeURIComponent(workspaceId) + "/opencode/config/providers");
    const def = providers && providers.default ? providers.default : null;
    if (def && typeof def === "object") {
      const entries = Object.entries(def);
      if (entries.length) {
        const providerID = entries[0][0];
        const modelID = entries[0][1];
        if (providerID && modelID) return { providerID, modelID };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function ensureSession(workspaceId) {
  const existing = readSessionId(workspaceId);
  if (existing) return existing;
  const created = await apiFetch("/w/" + encodeURIComponent(workspaceId) + "/opencode/session", {
    method: "POST",
    body: JSON.stringify({ title: "OpenWork Toy UI" }),
  });
  const id = created && created.id ? String(created.id) : "";
  if (!id) throw new Error("session_create_failed");
  writeSessionId(workspaceId, id);
  return id;
}

async function refreshHost(workspaceId) {
  const token = readToken();
  if (!token) {
    setPill(pillConn, "token missing", "bad");
    setStatus("Add #token=... to the URL fragment", "bad");
    return;
  }
  try {
    const status = await apiFetch("/status");
    const caps = await apiFetch("/capabilities");
    hostIdEl.textContent = location.origin;
    serverVersionEl.textContent = caps && caps.serverVersion ? caps.serverVersion : (status && status.version ? status.version : "-");
    const sandbox = caps && caps.sandbox ? caps.sandbox : null;
    sandboxEl.textContent = sandbox ? (sandbox.backend + " (" + (sandbox.enabled ? "on" : "off") + ")") : "-";
    const files = caps && caps.toolProviders && caps.toolProviders.files ? caps.toolProviders.files : null;
    fileInjectionEl.textContent = files ? ((files.injection ? "upload" : "no upload") + " / " + (files.outbox ? "download" : "no download")) : "-";
    workspaceIdEl.textContent = workspaceId || "-";
    setPill(pillConn, "connected", "ok");
    setStatus("Connected", "ok");

    try {
      const me = await apiFetch("/whoami");
      const scope = me && me.actor && me.actor.scope ? me.actor.scope : "unknown";
      pillScope.textContent = "scope: " + scope;
    } catch {
      pillScope.textContent = "scope: unknown";
    }
  } catch (e) {
    setPill(pillConn, "disconnected", "bad");
    setStatus(e && e.message ? e.message : "Disconnected", "bad");
  }
}

async function refreshMessages(workspaceId) {
  const sessionId = readSessionId(workspaceId);
  sessionIdEl.textContent = sessionId ? ("session: " + sessionId) : "session: -";
  if (!sessionId) {
    renderMessages([]);
    return;
  }
  const url = "/w/" + encodeURIComponent(workspaceId) + "/opencode/session/" + encodeURIComponent(sessionId) + "/message?limit=50";
  const msgs = await apiFetch(url);
  renderMessages(msgs);
}

async function listArtifacts(workspaceId) {
  const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/artifacts");
  const items = Array.isArray(data && data.items) ? data.items : [];
  artifactsEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No artifacts found.";
    artifactsEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const top = document.createElement("div");
    top.className = "row";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "mono";
    name.textContent = item.path;
    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = String(item.size) + " bytes";
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Download";
    btn.onclick = async () => {
      try {
        const res = await fetch(
          "/workspace/" + encodeURIComponent(workspaceId) + "/artifacts/" + encodeURIComponent(item.id),
          { headers: { Authorization: "Bearer " + readToken() } },
        );
        if (!res.ok) throw new Error("download_failed: " + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const parts = String(item.path || "artifact").split("/");
        a.download = parts.length ? parts[parts.length - 1] : "artifact";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setStatus(e && e.message ? e.message : "Download failed", "bad");
      }
    };

    top.appendChild(left);
    top.appendChild(btn);
    row.appendChild(top);
    artifactsEl.appendChild(row);
  }
}

async function refreshApprovals() {
  approvalsEl.innerHTML = "";
  try {
    const data = await apiFetch("/approvals");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No pending approvals.";
      approvalsEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";

      const top = document.createElement("div");
      top.className = "row";

      const left = document.createElement("div");
      const action = document.createElement("div");
      action.className = "mono";
      action.textContent = item.action;
      const summary = document.createElement("div");
      summary.className = "small";
      summary.textContent = item.summary;
      left.appendChild(action);
      left.appendChild(summary);

      const buttons = document.createElement("div");
      buttons.className = "row";

      const allow = document.createElement("button");
      allow.className = "btn primary";
      allow.textContent = "Allow";

      const deny = document.createElement("button");
      deny.className = "btn danger";
      deny.textContent = "Deny";

      allow.onclick = async () => {
        await apiFetch("/approvals/" + encodeURIComponent(item.id), {
          method: "POST",
          body: JSON.stringify({ reply: "allow" }),
        });
        await refreshApprovals();
      };

      deny.onclick = async () => {
        await apiFetch("/approvals/" + encodeURIComponent(item.id), {
          method: "POST",
          body: JSON.stringify({ reply: "deny" }),
        });
        await refreshApprovals();
      };

      buttons.appendChild(allow);
      buttons.appendChild(deny);

      top.appendChild(left);
      top.appendChild(buttons);
      row.appendChild(top);
      approvalsEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "Approvals unavailable";
    approvalsEl.appendChild(warn);
  }
}

let eventsAbort = null;

async function connectSse(workspaceId) {
  if (eventsAbort) return;
  const controller = new AbortController();
  eventsAbort = controller;
  setStatus("Connecting SSE...", "");
  addCheckpoint("sse.connecting");

  const url = "/w/" + encodeURIComponent(workspaceId) + "/opencode/event";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + readToken() },
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    eventsAbort = null;
    throw new Error("sse_failed: " + res.status);
  }

  setStatus("SSE connected", "ok");
  addCheckpoint("sse.connected");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  const pump = async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const rest = line.slice(5);
            dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
          }
        }
        if (!dataLines.length) continue;
        const raw = dataLines.join("\n");
        try {
          const event = JSON.parse(raw);
          const payload = event && event.payload ? event.payload : event;
          const type = payload && payload.type ? String(payload.type) : (event && event.type ? String(event.type) : "event");
          addCheckpoint(type, summarizeEvent(payload));
          if (type.endsWith(".completed") || type.endsWith(".finished") || type.endsWith(".stopped")) {
            setRun("idle");
          }
          if (payload && payload.type === "message.part.updated") {
            void refreshMessages(workspaceId);
          }
        } catch {
          // ignore
        }
      }
    }
  };

  pump()
    .catch(() => undefined)
    .finally(() => {
      eventsAbort = null;
      try { reader.releaseLock(); } catch {}
      setStatus("SSE disconnected", "");
      addCheckpoint("sse.disconnected");
      setRun("idle");
    });
}

function stopSse() {
  if (!eventsAbort) return;
  eventsAbort.abort();
  eventsAbort = null;
}

function renderConnectArtifact(workspaceId, token, scope) {
  const hostUrl = location.origin;
  const workspaceUrl = hostUrl + "/w/" + encodeURIComponent(workspaceId);
  const payload = {
    kind: "openwork.connect.v1",
    hostUrl: hostUrl,
    workspaceId: workspaceId,
    workspaceUrl: workspaceUrl,
    token: token,
    tokenScope: scope,
    createdAt: Date.now(),
  };
  connectEl.textContent = JSON.stringify(payload, null, 2);
}

async function showConnectArtifact(workspaceId) {
  const token = readToken();
  let scope = "collaborator";
  try {
    const me = await apiFetch("/whoami");
    const s = me && me.actor && me.actor.scope ? me.actor.scope : "";
    if (s) scope = s;
  } catch {
    // ignore
  }
  renderConnectArtifact(workspaceId, token, scope);
}

async function mintShareToken(workspaceId) {
  const scope = shareScopeEl && shareScopeEl.value ? String(shareScopeEl.value) : "collaborator";
  const label = shareLabelEl && shareLabelEl.value ? String(shareLabelEl.value).trim() : "";
  const issued = await apiFetch("/tokens", {
    method: "POST",
    body: JSON.stringify({ scope, label: label || undefined }),
  });
  const token = issued && issued.token ? String(issued.token) : "";
  const tokenScope = issued && issued.scope ? String(issued.scope) : scope;
  if (!token) throw new Error("token_missing");
  renderConnectArtifact(workspaceId, token, tokenScope);
  setStatus("Token minted: " + tokenScope, "ok");
}

async function refreshTokens() {
  if (!tokensEl) return;
  tokensEl.innerHTML = "";
  try {
    const data = await apiFetch("/tokens");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No tokens.";
      tokensEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const top = document.createElement("div");
      top.className = "row";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "mono";
      title.textContent = (item.scope ? String(item.scope) : "token") + "  " + (item.id ? String(item.id) : "");
      const meta = document.createElement("div");
      meta.className = "small";
      meta.textContent = item.label ? String(item.label) : "";
      left.appendChild(title);
      if (meta.textContent) left.appendChild(meta);

      const revoke = document.createElement("button");
      revoke.className = "btn danger";
      revoke.textContent = "Revoke";
      revoke.onclick = async () => {
        try {
          await apiFetch("/tokens/" + encodeURIComponent(String(item.id || "")), { method: "DELETE" });
          await refreshTokens();
        } catch (e) {
          setStatus(e && e.message ? e.message : "Revoke failed", "bad");
        }
      };

      top.appendChild(left);
      top.appendChild(revoke);
      row.appendChild(top);
      tokensEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "Tokens unavailable";
    tokensEl.appendChild(warn);
  }
}

async function exportWorkspace(workspaceId) {
  if (!exportEl) return;
  exportEl.textContent = "";
  const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/export");
  exportEl.textContent = JSON.stringify(data, null, 2);
}

async function importWorkspace(workspaceId) {
  if (!importEl) return;
  const raw = (importEl.value || "").trim();
  if (!raw) throw new Error("import_json_missing");
  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!payload) throw new Error("import_json_invalid");
  await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function refreshSkills(workspaceId) {
  if (!skillsEl) return;
  skillsEl.innerHTML = "";
  try {
    const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/skills");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No skills found.";
      skillsEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const top = document.createElement("div");
      top.className = "row";
      const left = document.createElement("div");
      const name = document.createElement("div");
      name.className = "mono";
      name.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "small";
      meta.textContent = item.description || (item.scope ? String(item.scope) : "");
      left.appendChild(name);
      if (meta.textContent) left.appendChild(meta);

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.disabled = item.scope !== "project";
      delBtn.onclick = async () => {
        try {
          await apiFetch(
            "/workspace/" + encodeURIComponent(workspaceId) + "/skills/" + encodeURIComponent(item.name),
            { method: "DELETE" },
          );
          await refreshSkills(workspaceId);
        } catch (e) {
          setStatus(e && e.message ? e.message : "Delete failed", "bad");
        }
      };

      top.appendChild(left);
      top.appendChild(delBtn);
      row.appendChild(top);
      skillsEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "Skills unavailable";
    skillsEl.appendChild(warn);
  }
}

async function refreshPlugins(workspaceId) {
  if (!pluginsEl) return;
  pluginsEl.innerHTML = "";
  try {
    const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/plugins");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No plugins.";
      pluginsEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const top = document.createElement("div");
      top.className = "row";
      const left = document.createElement("div");
      const spec = document.createElement("div");
      spec.className = "mono";
      spec.textContent = item.spec;
      const meta = document.createElement("div");
      meta.className = "small";
      meta.textContent = (item.source ? String(item.source) : "") + (item.scope ? " / " + String(item.scope) : "");
      left.appendChild(spec);
      if (meta.textContent) left.appendChild(meta);

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Remove";
      delBtn.disabled = item.source !== "config";
      delBtn.onclick = async () => {
        try {
          await apiFetch(
            "/workspace/" + encodeURIComponent(workspaceId) + "/plugins/" + encodeURIComponent(item.spec),
            { method: "DELETE" },
          );
          await refreshPlugins(workspaceId);
        } catch (e) {
          setStatus(e && e.message ? e.message : "Remove failed", "bad");
        }
      };

      top.appendChild(left);
      top.appendChild(delBtn);
      row.appendChild(top);
      pluginsEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "Plugins unavailable";
    pluginsEl.appendChild(warn);
  }
}

async function refreshMcp(workspaceId) {
  if (!mcpEl) return;
  mcpEl.innerHTML = "";
  try {
    const data = await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/mcp");
    const items = Array.isArray(data && data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "No MCP servers.";
      mcpEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const name = document.createElement("div");
      name.className = "mono";
      name.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "small";
      meta.textContent = item.disabledByTools ? "disabled" : "enabled";
      row.appendChild(name);
      row.appendChild(meta);
      mcpEl.appendChild(row);
    }
  } catch (e) {
    const warn = document.createElement("div");
    warn.className = "item";
    warn.textContent = e && e.message ? e.message : "MCP unavailable";
    mcpEl.appendChild(warn);
  }
}

async function copyConnectArtifact() {
  const text = connectEl.textContent || "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied", "ok");
  } catch {
    setStatus("Clipboard unavailable", "bad");
  }
}

async function main() {
  const workspaceId = parseWorkspaceIdFromPath();
  if (!workspaceId) {
    const token = readToken();
    if (!token) {
      appendMsg("system", "Open this as /ui#token=<token> or /w/<workspaceId>/ui#token=<token>");
      return;
    }
    try {
      const workspaces = await apiFetch("/workspaces");
      const active = (workspaces && workspaces.activeId) || (workspaces && workspaces.items && workspaces.items[0] && workspaces.items[0].id) || "";
      if (active) {
        location.href = "/w/" + encodeURIComponent(active) + "/ui";
        return;
      }
    } catch {
      // ignore
    }
    appendMsg("system", "No workspace configured.");
    return;
  }

  setRun("idle");
  clearTimeline();
  if (workspaceUrlEl) {
    const wsUrl = location.origin + "/w/" + encodeURIComponent(workspaceId);
    workspaceUrlEl.textContent = wsUrl;
    workspaceUrlEl.href = wsUrl;
  }

  await refreshHost(workspaceId);
  sessionIdEl.textContent = readSessionId(workspaceId) ? ("session: " + readSessionId(workspaceId)) : "session: -";
  await refreshMessages(workspaceId).catch(() => undefined);

  setTab(activeTab);
  if (tabsEl) {
    const buttons = tabsEl.querySelectorAll(".tab");
    buttons.forEach((btn) => {
      btn.onclick = async () => {
        const tab = btn.getAttribute("data-tab") || "share";
        setTab(tab);
        try {
          if (tab === "skills") await refreshSkills(workspaceId);
          if (tab === "plugins") await refreshPlugins(workspaceId);
          if (tab === "apps") await refreshMcp(workspaceId);
          if (tab === "share") await refreshTokens().catch(() => undefined);
        } catch {
          // ignore
        }
      };
    });
  }
  qs("#btn-new").onclick = async () => {
    try {
      writeSessionId(workspaceId, "");
      const id = await ensureSession(workspaceId);
      sessionIdEl.textContent = "session: " + id;
      await refreshMessages(workspaceId);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Failed to create session", "bad");
    }
  };

  qs("#btn-refresh").onclick = async () => {
    await refreshMessages(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "refresh failed", "bad"));
  };

  qs("#btn-delete-session").onclick = async () => {
    const sessionId = readSessionId(workspaceId);
    if (!sessionId) {
      setStatus("No session selected", "bad");
      return;
    }
    if (!confirm("Delete this session? This cannot be undone.")) return;
    try {
      await apiFetch(
        "/workspace/" + encodeURIComponent(workspaceId) + "/sessions/" + encodeURIComponent(sessionId),
        { method: "DELETE" },
      );
      writeSessionId(workspaceId, "");
      sessionIdEl.textContent = "session: -";
      chatlog.innerHTML = "";
      clearTimeline();
      setRun("idle");
      setStatus("Session deleted", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "delete failed", "bad");
    }
  };

  qs("#btn-send").onclick = async () => {
    const text = (promptEl.value || "").trim();
    if (!text) return;
    clearTimeline();
    addCheckpoint("prompt.submitted", text.length > 120 ? (text.slice(0, 120) + "...") : text);
    setRun("running");
    void connectSse(workspaceId).catch(() => undefined);
    appendMsg("user", text);
    promptEl.value = "";
    try {
      const sessionId = await ensureSession(workspaceId);
      sessionIdEl.textContent = "session: " + sessionId;
      const model = await resolveDefaultModel(workspaceId);
      const body = { parts: [{ type: "text", text: text }] };
      if (model) body.model = model;
      await apiFetch(
        "/w/" + encodeURIComponent(workspaceId) + "/opencode/session/" + encodeURIComponent(sessionId) + "/prompt_async",
        { method: "POST", body: JSON.stringify(body) },
      );
      setStatus("Prompt accepted", "ok");
      addCheckpoint("prompt.accepted");
      await refreshMessages(workspaceId).catch(() => undefined);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Prompt failed", "bad");
      addCheckpoint("prompt.failed", e && e.message ? e.message : "Prompt failed");
      setRun("idle");
    }
  };

  qs("#btn-skill").onclick = () => {
    const template = [
      "Turn this into a skill.",
      "",
      "Requirements:",
      "- Skill name: my-skill",
      "- Write to .opencode/skills/my-skill/SKILL.md",
      "- Include usage, inputs, steps, and examples",
      "",
      "Use the most recent conversation as source material.",
    ].join("\n");
    const existing = (promptEl.value || "").trim();
    promptEl.value = existing ? (existing + "\n\n" + template) : template;
    promptEl.focus();
  };

  qs("#btn-mint").onclick = async () => {
    try {
      await mintShareToken(workspaceId);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Token mint failed", "bad");
    }
  };

  qs("#btn-deploy").onclick = () => {
    setStatus("Deploy (Beta) is not implemented in the Toy UI yet", "");
  };

  qs("#btn-events").onclick = async () => {
    try {
      await connectSse(workspaceId);
    } catch (e) {
      setStatus(e && e.message ? e.message : "SSE failed", "bad");
    }
  };

  qs("#btn-events-stop").onclick = () => stopSse();

  qs("#btn-upload").onclick = async () => {
    const input = qs("#file");
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (!file) {
      setStatus("Pick a file first", "bad");
      return;
    }
    try {
      const form = new FormData();
      form.set("file", file);
      await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/inbox", { method: "POST", body: form });
      setStatus("Uploaded", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "Upload failed", "bad");
    }
  };

  qs("#btn-artifacts").onclick = async () => {
    await listArtifacts(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "artifacts failed", "bad"));
  };

  qs("#btn-approvals").onclick = async () => {
    await refreshApprovals().catch(() => undefined);
  };

  qs("#btn-share").onclick = async () => {
    await showConnectArtifact(workspaceId).catch(() => undefined);
  };

  qs("#btn-copy").onclick = async () => {
    await copyConnectArtifact();
  };

  qs("#btn-tokens").onclick = async () => {
    await refreshTokens().catch((e) => setStatus(e && e.message ? e.message : "tokens failed", "bad"));
  };

  qs("#btn-export").onclick = async () => {
    try {
      await exportWorkspace(workspaceId);
      setStatus("Exported", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "export failed", "bad");
    }
  };

  qs("#btn-import").onclick = async () => {
    try {
      await importWorkspace(workspaceId);
      setStatus("Import requested (check approvals)", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "import failed", "bad");
    }
  };

  qs("#btn-delete-workspace").onclick = async () => {
    if (!confirm("Delete this workspace from the host's OpenWork server config?")) return;
    try {
      await apiFetch("/workspaces/" + encodeURIComponent(workspaceId), { method: "DELETE" });
      setStatus("Workspace deleted (refresh workspaces)", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "workspace delete failed", "bad");
    }
  };

  qs("#btn-skills-refresh").onclick = async () => {
    await refreshSkills(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "skills failed", "bad"));
  };

  qs("#btn-plugins-refresh").onclick = async () => {
    await refreshPlugins(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "plugins failed", "bad"));
  };

  qs("#btn-plugin-add").onclick = async () => {
    const spec = pluginSpecEl && pluginSpecEl.value ? String(pluginSpecEl.value).trim() : "";
    if (!spec) {
      setStatus("plugin spec required", "bad");
      return;
    }
    try {
      await apiFetch("/workspace/" + encodeURIComponent(workspaceId) + "/plugins", {
        method: "POST",
        body: JSON.stringify({ spec }),
      });
      if (pluginSpecEl) pluginSpecEl.value = "";
      await refreshPlugins(workspaceId);
      setStatus("Plugin added", "ok");
    } catch (e) {
      setStatus(e && e.message ? e.message : "plugin add failed", "bad");
    }
  };

  qs("#btn-mcp-refresh").onclick = async () => {
    await refreshMcp(workspaceId).catch((e) => setStatus(e && e.message ? e.message : "mcp failed", "bad"));
  };
}

main().catch((e) => {
  setStatus(e && e.message ? e.message : "Startup failed", "bad");
});
`;

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function cssResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function jsResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function svgResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
