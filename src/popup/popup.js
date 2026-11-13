const $ = (id) => document.getElementById(id);
const LABELS = { online: "Online", paused: "Out of credits", offline: "Offline", error: "Bot token invalid" };
let apps = [], current = null, cfgCache = null, confirmStop = false;
const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* theme is chosen in Settings (system / light / dark) */
chrome.storage.local.get("theme").then((v) => (document.documentElement.dataset.theme = v.theme || "system"));
chrome.storage.onChanged.addListener((ch) => { if (ch.theme) document.documentElement.dataset.theme = ch.theme.newValue || "system"; });

async function renderQuiet() {
  const q = await getQuiet(), el = $("quiet");
  el.hidden = !q.enabled;
  el.dataset.tip = `Quiet hours: ${fmtTime(q.start)} – ${fmtTime(q.end)}${q.active ? " (active now)" : ""}. No notifications during this time.`;
}
renderQuiet();
chrome.storage.onChanged.addListener((ch) => { if (ch.quietEnabled || ch.quietStart || ch.quietEnd) renderQuiet(); });

function renderLinks(cfg) {
  const base = `${cfg.dashBase}/apps/${cfg.appId}`;
  $("links").innerHTML = "";
  [["Dashboard", ""], ["Commands", "/commands"], ["Events", "/events"], ["Logs", "/logs"]].forEach(([t, p]) => {
    const a = document.createElement("a"); a.textContent = t; a.href = base + p; a.target = "_blank"; $("links").appendChild(a);
  });
}

/* logged out: swap the error line for a friendly sign-in card */
function showLogin(cfg) {
  $("loginBtn").href = `${cfg.apiBase}/v1/auth/login?redirect=${encodeURIComponent("/apps")}`;
  document.querySelector(".top").hidden = true;
  ["main", "controls", "alert", "err"].forEach((id) => ($(id).hidden = true));
  $("login").hidden = false;
}
function hideLogin() { $("login").hidden = true; document.querySelector(".top").hidden = false; }
$("loginToken").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

function renderPower(s) {
  const b = $("power"); confirmStop = false;
  b.disabled = false;
  b.className = "btn sm " + (s.app.enabled ? "stop" : "start");
  b.textContent = s.app.enabled ? "Stop bot" : "Start bot";
}

function render(s, err) {
  $("err").hidden = !err; if (err) $("err").textContent = err;
  if (!s) return;
  const kind = statusKind(s);
  $("main").hidden = false; $("controls").hidden = false;
  $("name").textContent = s.app.name; $("avatar").textContent = initial(s.app.name);
  $("pill").className = "pill " + kind; $("state").textContent = LABELS[kind];
  $("used").textContent = s.usedKnown === false ? "—" : s.used.toLocaleString();
  if (s.warnings && s.warnings.length) { $("err").hidden = false; $("err").textContent = "Some data unavailable — " + s.warnings.join(" | "); }
  $("limit").textContent = s.limit ? "of " + s.limit.toLocaleString() : "no limit";
  $("fill").style.width = s.pct + "%";
  $("fill").className = "fill" + (s.pct >= 100 ? " bad" : s.pct >= 80 ? " warn" : "");
  $("pct").textContent = s.limit ? s.pct.toFixed(1) + "% used" : "";
  $("remaining").textContent = s.limit ? Math.max(0, s.limit - s.used).toLocaleString() + " left" : "";
  $("servers").textContent = s.app.discord_guild_count != null ? s.app.discord_guild_count + " servers" : "";
  $("reason").hidden = !s.app.disabled_reason; $("reason").textContent = s.app.disabled_reason || "";
  const mins = Math.round((Date.now() - s.at) / 60000);
  $("updated").textContent = mins < 1 ? "Updated just now" : `Updated ${mins}m ago`;
  // error alert
  const a = $("alert");
  if (s.unseenCount > 0) {
    a.hidden = false;
    const n = s.unseenCount;
    $("alertTitle").textContent = n === s.errors ? `${n} error${n === 1 ? "" : "s"} in the last 24h` : `${n} new error${n === 1 ? "" : "s"}`;
    $("alertMsg").textContent = s.recentErrors && s.recentErrors[0] ? s.recentErrors[0].message : "Open the logs to see what failed.";
    if (cfgCache) $("alertLink").href = `${cfgCache.dashBase}/apps/${cfgCache.appId}/logs`;
  } else a.hidden = true;
  renderPower(s);
}

async function renderMenu(currentId) {
  const { botStates } = await chrome.storage.local.get("botStates");
  const dots = {}; (botStates || []).forEach((b) => { dots[b.id] = b; });
  const m = $("menu"); m.innerHTML = "";
  apps.forEach((a) => {
    const d = document.createElement("div"); d.className = "item";
    const b = dots[a.id], col = !b ? "muted-foreground" : b.kind === "error" || b.kind === "paused" || b.pct >= 100 || b.unseen > 0 ? "destructive" : b.kind === "offline" ? "muted-foreground" : b.pct >= 80 ? "yellow" : "green";
    d.innerHTML = `<div class="avatar">${initial(a.name)}</div><span class="name"></span><span class="sd" style="background:hsl(var(--${col}))" title="${b ? b.kind : ""}"></span>${a.id === currentId ? '<span class="check">✓</span>' : ""}`;
    d.querySelector(".name").textContent = a.name;
    d.onclick = async () => { m.hidden = true; await chrome.storage.local.set({ appId: a.id, last: null }); load(true); };
    m.appendChild(d);
  });
}

async function load(force) {
  const cfg = await getConfig(); cfgCache = cfg;
  document.body.classList.add("loading"); $("refresh").innerHTML = '<span class="spin"></span>Refreshing';
  const minDelay = force ? sleep(450) : Promise.resolve(); // brief, visible load on manual refresh
  const st = await chrome.storage.local.get(["last", "lastError", "apps"]);
  if (st.apps) { apps = st.apps; renderMenu(cfg.appId); }
  if (st.last && !force && st.last.app.id === cfg.appId) { render(st.last, st.lastError); renderLinks(cfg); }
  try {
    apps = (await kiteGet(cfg, "/apps")) || [];
    await chrome.storage.local.set({ apps });
    let id = cfg.appId;
    if (!apps.some((a) => a.id === id)) { id = apps[0] && apps[0].id; await chrome.storage.local.set({ appId: id }); cfg.appId = id; }
    renderMenu(id);
    if (!id) { $("state").textContent = "No apps"; return; }
    const s = await fetchStatus(cfg); await minDelay;
    await chrome.storage.local.set({ last: s, lastError: null });
    renderLinks(cfg); render(s);
    
    hideLogin();
  } catch (e) {
    await minDelay;
    if (e.status === 401) return showLogin(cfg);
    $("err").hidden = false; $("err").textContent = String(e.message || e) + " (API: " + cfg.apiBase + ")"; $("state").textContent = "Couldn't load";
  }
  finally { document.body.classList.remove("loading"); $("refresh").textContent = "Refresh"; }
}

/* start / stop (needs your Kite login; API tokens can't change apps) */
$("power").onclick = async () => {
  const st = await chrome.storage.local.get("last"); const s = st.last; if (!s) return;
  const b = $("power");
  if (s.app.enabled && !confirmStop) { confirmStop = true; b.textContent = "Click again to stop"; setTimeout(() => { if (confirmStop) renderPower(s); }, 3000); return; }
  confirmStop = false; b.disabled = true; b.innerHTML = '<span class="spin"></span>' + (s.app.enabled ? "Stopping…" : "Starting…");
  try {
    await kiteReq(cfgCache, "PUT", "/apps/" + cfgCache.appId, { name: s.app.name, description: s.app.description || null, enabled: !s.app.enabled });
    await load(true);
  } catch (e) { $("err").hidden = false; $("err").textContent = "Couldn't change the bot: " + e.message; renderPower(s); }
};

$("trigger").onclick = (e) => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
document.addEventListener("click", () => ($("menu").hidden = true));
$("refresh").onclick = (e) => { e.preventDefault(); load(true); };
$("settings").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
load();

/* ---------- usage page ---------- */
const num = (n) => Math.round(n).toLocaleString();
const pretty = (t) => (t || "other").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
// Same groups, labels and colors as Kite's "Usage by type" chart, in this order.
const TYPES = [
  { key: "command_flow_execution", label: "Commands", color: "var(--chart-3)" },
  { key: "message_flow_execution", label: "Messages", color: "var(--chart-5)" },
  { key: "event_listener_flow_execution", label: "Events", color: "var(--chart-4)" },
];

function showView(v) { $("viewMain").hidden = v !== "main"; $("viewUsage").hidden = v !== "usage"; }
$("openUsage").onclick = () => openUsage();
$("back").onclick = () => showView("main");

function chartSvg(byDay, daysInMonth, today, avg) {
  const W = 300, H = 110, pad = 16, bw = W / daysInMonth, byIdx = {};
  byDay.forEach((e) => { byIdx[new Date(e.date).getUTCDate()] = e.credits_used; });
  const max = Math.max(1, avg, ...Object.values(byIdx));
  let bars = "", labels = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const future = d > today, v = future ? avg : byIdx[d] || 0;
    const h = Math.max(v > 0 ? 2 : 1, (v / max) * (H - pad - 4)), x = (d - 1) * bw + 1;
    bars += `<rect x="${x.toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="hsl(var(--primary))" opacity="${future ? 0.22 : 1}"/>`;
    if (d === 1 || d % 5 === 0) labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="9" fill="hsl(var(--muted-foreground))">${d}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}">${bars}${labels}</svg>`;
}

async function openUsage() {
  showView("usage"); $("uerr").hidden = true;
  const cfg = await getConfig(); const { last } = await chrome.storage.local.get("last");
  if (!last) return;
  $("uname").textContent = last.app.name;
  $("uused").textContent = num(last.used); $("ulimit").textContent = last.limit ? "of " + num(last.limit) : "no limit";
  $("ufill").style.width = last.pct + "%"; $("ufill").className = "fill" + (last.pct >= 100 ? " bad" : last.pct >= 80 ? " warn" : "");
  document.body.classList.add("loading");
  try {
    const [byDay, byType] = await Promise.all([kiteGet(cfg, `/apps/${cfg.appId}/usage/by-day`), kiteGet(cfg, `/apps/${cfg.appId}/usage/by-type`)]);
    const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth(), today = now.getUTCDate();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const avg = last.used / Math.max(1, today);
    $("uavg").textContent = num(avg); $("uproj").textContent = "~" + num(avg * dim);
    $("ureset").textContent = new Date(Date.UTC(y, m + 1, 1)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    $("chart").innerHTML = chartSvg(byDay || [], dim, today, avg);
    const byKey = {}; (byType || []).forEach((t) => { byKey[t.type] = (byKey[t.type] || 0) + t.credits_used; });
    const rows = TYPES.map((t) => ({ ...t, value: byKey[t.key] || 0 }));
    Object.keys(byKey).filter((k) => !TYPES.some((t) => t.key === k)).forEach((k) => rows.push({ key: k, label: pretty(k), color: "var(--muted-foreground)", value: byKey[k] }));
    const total = rows.reduce((n, r) => n + r.value, 0);
    $("types").innerHTML = "";
    const stack = document.createElement("div"); stack.className = "stack";
    rows.forEach((r) => { if (r.value > 0) { const i = document.createElement("i"); i.style.width = (r.value / total) * 100 + "%"; i.style.background = `hsl(${r.color})`; stack.appendChild(i); } });
    $("types").appendChild(stack);
    rows.forEach((r) => {
      const el = document.createElement("div"); el.className = "trow";
      el.innerHTML = '<span class="sw"></span><span class="tn"></span><span class="tb"><i></i></span><span class="tv"></span>';
      el.querySelector(".sw").style.background = `hsl(${r.color})`;
      el.querySelector(".tn").textContent = r.label; el.querySelector("i").style.background = `hsl(${r.color})`;
      el.querySelector("i").style.width = total ? (r.value / total) * 100 + "%" : "0";
      el.querySelector(".tv").textContent = num(r.value) + " · " + (total ? Math.round((r.value / total) * 100) : 0) + "%";
      $("types").appendChild(el);
    });
  } catch (e) { $("uerr").hidden = false; $("uerr").textContent = "Couldn't load usage: " + e.message; }
  finally { document.body.classList.remove("loading"); }
}

/* dismiss the error alert; it comes back when a newer error appears */
$("alertClose").onclick = async () => {
  const { last } = await chrome.storage.local.get("last"); if (!last) return;
  await chrome.storage.local.set({ ["errAck:" + cfgCache.appId]: last.latestErrorId || 0 });
  last.unseenCount = 0; last.recentErrors = []; await chrome.storage.local.set({ last });
  $("alert").hidden = true; chrome.runtime.sendMessage("recompute");
};
