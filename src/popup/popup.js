const $ = (id) => document.getElementById(id);
const LABELS = { online: "Online", paused: "Out of credits", offline: "Stopped", error: "Bot token invalid" };
let apps = [], current = null, cfgCache = null, confirmStop = false;
const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* theme is chosen in Settings (system / light / dark) */
chrome.storage.local.get("theme").then((v) => (document.documentElement.dataset.theme = v.theme || "system"));
chrome.storage.onChanged.addListener((ch) => { if (ch.theme) document.documentElement.dataset.theme = ch.theme.newValue || "system"; });

async function renderQuiet() {
  const q = await getQuiet(), el = $("quiet");
  el.hidden = !q.enabled;
  el.setAttribute("aria-label", `Quiet hours ${fmtTime(q.start)} to ${fmtTime(q.end)}${q.active ? ", active now" : ""}`);
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

/* loading skeleton: shown until the first real render so the layout doesn't jump */
function showSkeleton() {
  document.body.classList.add("boot");
  $("skeleton").hidden = false;
  ["main", "controls", "alert", "err"].forEach((id) => ($(id).hidden = true));
}
function endBoot() { document.body.classList.remove("boot"); $("skeleton").hidden = true; }

let updatedAt = 0;
function markUpdated(at) { updatedAt = at; $("updated").textContent = at ? "Updated " + ago(at) : ""; }
setInterval(() => { if (updatedAt) markUpdated(updatedAt); }, 5000); // count up while the popup stays open

/* copy buttons */
async function copyText(btn, text, label) {
  try { await navigator.clipboard.writeText(text); } catch (_) { return; }
  const span = btn.querySelector("span"); span.textContent = "Copied";
  btn.classList.add("done"); clearTimeout(btn._t);
  btn._t = setTimeout(() => { span.textContent = label; btn.classList.remove("done"); }, 1400);
}
const discordId = (app) => app && (app.discord_application_id || app.discord_app_id || app.discord_client_id || app.application_id || "");
$("copyApp").onclick = () => cfgCache && cfgCache.appId && copyText($("copyApp"), cfgCache.appId, "Copy app ID");
$("copyDiscord").onclick = async () => { const { last } = await chrome.storage.local.get("last"); const id = discordId(last && last.app); if (id) copyText($("copyDiscord"), String(id), "Copy Discord ID"); };

function render(s, err) {
  endBoot();
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
  markUpdated(s.at);
  $("copyDiscord").hidden = !discordId(s.app);
  // error alert
  const a = $("alert");
  if (s.unseenCount > 0) {
    a.hidden = false;
    const n = s.unseenCount;
    $("alertTitle").textContent = n === s.errors ? `${n} error${n === 1 ? "" : "s"} in the last 24h` : `${n} new error${n === 1 ? "" : "s"}`;
    const errs = s.recentErrors || [];
    $("alertMsg").textContent = errs[0] ? errs[0].message : "Open the logs to see what failed.";
    const logs = cfgCache ? `${cfgCache.dashBase}/apps/${cfgCache.appId}/logs` : "#";
    $("alertLink").href = logs;
    renderErrorList(errs, logs);
  } else a.hidden = true;
  renderPower(s);
}

/* expandable error list: last few unseen errors, each with its time, linking to the logs page */
function ago(ts) {
  const sec = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}
function renderErrorList(errs, logsUrl) {
  const list = $("alertList"); list.innerHTML = "";
  errs.forEach((e) => {
    const a = document.createElement("a"); a.className = "eitem"; a.href = logsUrl; a.target = "_blank";
    a.innerHTML = '<span class="emsg"></span><span class="etime"></span>';
    a.querySelector(".emsg").textContent = e.message || "Error";
    a.querySelector(".etime").textContent = ago(e.at);
    a.title = new Date(e.at).toLocaleString();
    list.appendChild(a);
  });
  $("alertToggle").disabled = !errs.length; // nothing to expand
  if (!errs.length) setAlertOpen(false);
}
function setAlertOpen(open) {
  $("alertList").hidden = !open; $("alertMsg").hidden = open;
  $("alertToggle").setAttribute("aria-expanded", String(open));
  $("alert").classList.toggle("open", open);
}
$("alertToggle").onclick = () => setAlertOpen($("alertList").hidden);

async function renderMenu(currentId) {
  const { botStates } = await chrome.storage.local.get("botStates");
  const dots = {}; (botStates || []).forEach((b) => { dots[b.id] = b; });
  const m = $("menu"); m.innerHTML = "";
  apps.forEach((a) => {
    const d = document.createElement("div"); d.className = "item"; d.setAttribute("role", "option"); d.tabIndex = -1;
    d.setAttribute("aria-selected", String(a.id === currentId));
    const b = dots[a.id], col = !b ? "muted-foreground" : b.kind === "error" || b.kind === "paused" || b.pct >= 100 || b.unseen > 0 ? "destructive" : b.kind === "offline" ? "muted-foreground" : b.pct >= 80 ? "yellow" : "green";
    d.innerHTML = `<div class="avatar">${initial(a.name)}</div><span class="name"></span><span class="sd" style="background:hsl(var(--${col}))" title="${b ? b.kind : ""}"></span>${a.id === currentId ? '<span class="check">✓</span>' : ""}`;
    d.querySelector(".name").textContent = a.name;
    d.setAttribute("aria-label", a.name + (b ? ", " + (LABELS[b.kind] || b.kind).toLowerCase() : ""));
    d.onclick = async () => { setMenu(false); await chrome.storage.local.set({ appId: a.id, last: null }); showSkeleton(); load(true); };
    m.appendChild(d);
  });
}

async function load(force, quiet) {
  const cfg = await getConfig(); cfgCache = cfg;
  if (!quiet) { document.body.classList.add("loading"); $("refresh").innerHTML = '<span class="spin"></span>Refreshing'; }
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
    if (!id) { endBoot(); $("state").textContent = "No apps"; return; }
    const s = await fetchStatus(cfg); await minDelay;
    await chrome.storage.local.set({ last: s, lastError: null });
    renderLinks(cfg); render(s);
    
    hideLogin();
  } catch (e) {
    await minDelay;
    endBoot();
    if (e.status === 401) return showLogin(cfg);
    $("err").hidden = false; $("err").textContent = String(e.message || e) + " (API: " + cfg.apiBase + ")"; $("state").textContent = "Couldn't load";
  }
  finally { document.body.classList.remove("loading"); $("refresh").textContent = "Refresh"; }
}

/* start / stop (needs your Kite login; API tokens can't change apps) */
function setPending(text) { $("pill").className = "pill pending"; $("state").textContent = text; }
$("power").onclick = async () => {
  const st = await chrome.storage.local.get("last"); const s = st.last; if (!s) return;
  const b = $("power");
  if (s.app.enabled && !confirmStop) { confirmStop = true; b.textContent = "Click again to stop"; setTimeout(() => { if (confirmStop) renderPower(s); }, 3000); return; }
  confirmStop = false; b.disabled = true;
  const stopping = s.app.enabled;
  b.innerHTML = '<span class="spin"></span>' + (stopping ? "Stopping…" : "Starting…");
  setPending(stopping ? "Stopping…" : "Starting…");
  try {
    const res = await kiteReq(cfgCache, "PUT", "/apps/" + cfgCache.appId, { name: s.app.name, description: s.app.description || null, enabled: !stopping });
    // Show the new state right away from the response instead of waiting for the next poll.
    const next = { ...s, app: { ...s.app, ...(res && typeof res === "object" ? res : {}), enabled: !stopping }, at: Date.now() };
    await chrome.storage.local.set({ last: next });
    render(next); markUpdated(next.at);
    chrome.runtime.sendMessage("refresh");
    setTimeout(() => load(false, true), 1500); // quiet re-check that the change stuck
  } catch (e) { $("err").hidden = false; $("err").textContent = "Couldn't change the bot: " + e.message; render(s); }
};

/* bot dropdown: mouse, plus Escape / arrow keys / Home / End / Enter */
const menuItems = () => [...$("menu").querySelectorAll(".item")];
function setMenu(open, focusSel) {
  $("menu").hidden = !open; $("trigger").setAttribute("aria-expanded", String(open));
  if (open) { const it = menuItems(); (focusSel === "last" ? it[it.length - 1] : it.find((i) => i.getAttribute("aria-selected") === "true") || it[0])?.focus(); }
}
$("trigger").onclick = (e) => { e.stopPropagation(); setMenu($("menu").hidden); };
$("trigger").onkeydown = (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setMenu(true, e.key === "ArrowUp" ? "last" : ""); }
};
$("menu").onkeydown = (e) => {
  const it = menuItems(), i = it.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); it[(i + 1) % it.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); it[(i - 1 + it.length) % it.length].focus(); }
  else if (e.key === "Home") { e.preventDefault(); it[0].focus(); }
  else if (e.key === "End") { e.preventDefault(); it[it.length - 1].focus(); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement.click(); }
  else if (e.key === "Tab") setMenu(false);
};
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("menu").hidden) { e.preventDefault(); setMenu(false); $("trigger").focus(); }
  else if ($("viewUsage").classList.contains("active")) { e.preventDefault(); showView("main"); $("openUsage").focus(); }
});
document.addEventListener("click", () => setMenu(false));
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

/* page switching: both views stay mounted; the wrapper animates to the active view's height */
function fit() { const v = document.querySelector(".view.active"); if (v) $("views").style.height = v.offsetHeight + "px"; }
function showView(v) {
  $("viewMain").classList.toggle("active", v === "main");
  $("viewUsage").classList.toggle("active", v === "usage");
  $("viewMain").inert = v !== "main"; $("viewUsage").inert = v !== "usage";
  fit();
}
const ro = new ResizeObserver(fit); ro.observe($("viewMain")); ro.observe($("viewUsage"));
$("viewUsage").inert = true; fit();
requestAnimationFrame(() => requestAnimationFrame(() => $("views").classList.add("ready")));
$("openUsage").onclick = () => { openUsage(); setTimeout(() => $("back").focus({ preventScroll: true }), 30); };
$("back").onclick = () => { showView("main"); setTimeout(() => $("openUsage").focus({ preventScroll: true }), 30); };

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
  $("alert").hidden = true; setAlertOpen(false); chrome.runtime.sendMessage("recompute");
};
