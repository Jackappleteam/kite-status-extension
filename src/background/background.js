importScripts("../shared/shared.js");

const COLORS = { online: "#23a55a", paused: "#f0b232", offline: "#80848e", error: "#f23f43" };
const MAX_BOTS = 10;
// Every 30s: bot list (status of all bots), logs for every bot (error alerts), credits for the SELECTED bot only.
// Every 5 min: the selected bot's plan limit.
const SLOW_MS = 5 * 60 * 1000;

/* ---------- one polling pass over all bots ---------- */
let polling = false, pending = false;
async function pollAll() {
  if (polling) { pending = true; return; } polling = true;
  try {
    const cfg = await getConfig();
    const st = await chrome.storage.local.get(["bots", "slowAt"]);
    const prev = st.bots || {};
    const slow = !st.slowAt || Date.now() - st.slowAt >= SLOW_MS - 2000;
    let apps;
    try { apps = ((await kiteGet(cfg, "/apps")) || []).slice(0, MAX_BOTS); }
    catch (e) {
      if (e.status === 429) return;                      // rate limited: just try again next tick
      await chrome.storage.local.set({ lastError: String(e.message || e) });
      chrome.action.setBadgeText({ text: "!" }); chrome.action.setBadgeBackgroundColor({ color: COLORS.error });
      return;
    }
    let selected = cfg.appId;
    if ((!selected || !apps.some((a) => a.id === selected)) && apps[0]) { selected = apps[0].id; await chrome.storage.local.set({ appId: selected }); }
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const bots = {};
    let usedSlow = false;
    await Promise.all(apps.map(async (app) => {
      const old = prev[app.id] || {};
      const get = async (p) => { try { return await kiteGet(cfg, p); } catch (e) { return e.status === 429 ? undefined : null; } };
      const logs = await get(`/apps/${app.id}/logs?limit=100`);            // all bots: error alerts
      let used = 0, limit = 0;
      if (app.id === selected) {                                           // selected bot only: credits + limit
        used = old.used || 0; limit = old.limit || 0;
        const c = await get(`/apps/${app.id}/usage/credits`);
        if (c) used = c.credits_used || 0;
        if (slow || !limit) {
          const f = await get(`/apps/${app.id}/billing/features`);
          if (f) { limit = f.usage_credits_per_month || 0; usedSlow = true; }
        }
      }
      const errList = logs
        ? logs.filter((l) => l.level === "error" && new Date(l.created_at).getTime() >= dayAgo)
            .sort((a, b) => b.id - a.id).slice(0, 20).map((l) => ({ id: l.id, message: l.message, at: l.created_at }))
        : old.errList || [];
      bots[app.id] = { app, used, limit, errList };
    }));
    if (slow && usedSlow) await chrome.storage.local.set({ slowAt: Date.now() });
    await chrome.storage.local.set({ bots, lastError: null });
    await derive(bots, true);
  } finally { polling = false; if (pending) { pending = false; pollAll(); } }
}

/* ---------- turn stored bot data into badge + notifications ---------- */
async function derive(bots, notify) {
  const list = Object.values(bots), states = [];
  for (const b of list) {
    const ack = (await chrome.storage.local.get("errAck:" + b.app.id))["errAck:" + b.app.id] || 0;
    const unseen = b.errList.filter((l) => l.id > ack);
    const pct = b.limit > 0 ? Math.min(100, (b.used / b.limit) * 100) : 0;
    const s = { app: b.app, used: b.used, limit: b.limit, pct, unseenCount: unseen.length,
      latestErrorId: b.errList[0] ? b.errList[0].id : 0, errorIds: b.errList.map((l) => l.id), recentErrors: unseen.slice(0, 3) };
    s.kind = statusKind(s);
    states.push(s);
    if (notify) await maybeNotify(s, s.kind);
  }
  await chrome.storage.local.set({ botStates: states.map((s) => ({ id: s.app.id, kind: s.kind, pct: s.pct, unseen: s.unseenCount })) });
  await setBadge(states);
}

// The toolbar badge follows the bot selected in the popup (other bots still send notifications).
async function setBadge(all) {
  const { appId } = await chrome.storage.local.get("appId");
  const s = all.find((x) => x.app.id === appId) || all[0];
  if (!s) { chrome.action.setBadgeText({ text: "" }); return; }
  let color = COLORS.online;
  if (s.kind === "error" || s.kind === "paused" || s.pct >= 100 || s.unseenCount > 0) color = COLORS.error;
  else if (s.kind === "offline") color = COLORS.offline;
  else if (s.pct >= 80) color = COLORS.paused;
  chrome.action.setBadgeText({ text: s.limit > 0 ? Math.round(s.pct) + "%" : s.kind === "offline" ? "OFF" : "ON" });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `${s.app.name}: ${s.kind}${s.limit ? ` — ${s.used}/${s.limit} credits (${Math.round(s.pct)}%)` : ""}${s.unseenCount ? `, ${s.unseenCount} new error${s.unseenCount === 1 ? "" : "s"}` : ""}` });
}

// Re-derive from stored data without any network calls (used after dismissing an alert).
async function recompute() {
  const { bots } = await chrome.storage.local.get("bots");
  if (bots) await derive(bots, false);
}

/* ---------- notifications (per bot) ---------- */
async function maybeNotify(s, kind) {
  if ((await getQuiet()).active) return; // quiet hours: hold alerts until they end
  const id = s.app.id, month = new Date().toISOString().slice(0, 7);
  const nk = "notified:" + id, lk = "lastKind:" + id;
  const st = await chrome.storage.local.get([nk, lk]);
  let notified = st[nk] && st[nk].month === month ? st[nk] : { month, t80: false, t100: false };
  const note = (title, message) => chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title, message });

  if (s.limit > 0 && s.pct >= 100 && !notified.t100) { notified.t100 = true; note(`Kite: ${s.app.name} is out of credits`, `Used all ${s.limit} credits.`); }
  else if (s.limit > 0 && s.pct >= 80 && !notified.t80) { notified.t80 = true; note(`Kite: ${s.app.name} at 80% of credits`, `${s.used}/${s.limit} used.`); }
  if (st[lk] && st[lk] !== kind && (kind === "offline" || kind === "error")) {
    note(`Kite: ${s.app.name} is ${kind}`, s.app.disabled_reason || (kind === "error" ? "Discord rejected the bot token." : "The app is disabled."));
  }
  await chrome.storage.local.set({ [nk]: notified, [lk]: kind });
  await maybeNotifyErrors(s);
}

// Alert when an error newer than the last one we told you about shows up.
async function maybeNotifyErrors(s) {
  if ((await getQuiet()).active) return;
  const cfg = await getConfig();
  const key = "errNotified:" + s.app.id;
  const prev = (await chrome.storage.local.get(key))[key];
  await chrome.storage.local.set({ [key]: Math.max(s.latestErrorId, prev || 0) });
  const { errorAlerts } = await chrome.storage.local.get("errorAlerts");
  if (errorAlerts === false || prev === undefined) return; // first run only records a baseline
  const fresh = (s.errorIds || []).filter((id) => id > prev).length;
  if (!fresh) return;
  const latest = s.recentErrors && s.recentErrors[0];
  chrome.notifications.create("kite-errors|" + cfg.dashBase + "/apps/" + s.app.id + "/logs", {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `Kite: ${fresh} new error${fresh === 1 ? "" : "s"} in ${s.app.name}`,
    message: latest ? latest.message.slice(0, 180) : "Click to open the logs.",
  });
}
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("kite-errors|")) chrome.tabs.create({ url: id.slice("kite-errors|".length) });
});

/* ---------- scheduling: every 30 seconds ---------- */
function schedule() { chrome.alarms.create("poll", { periodInMinutes: 0.5 }); pollAll(); }
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "poll") pollAll(); });
chrome.storage.onChanged.addListener((ch) => {
  if (ch.token || ch.apiBase) { chrome.storage.local.set({ slowAt: 0 }); pollAll(); }
  else if (ch.appId) pollAll(); // switched bots in the popup: load that bot's credits right away
});
chrome.runtime.onMessage.addListener((m) => { if (m === "refresh") pollAll(); if (m === "recompute") recompute(); });
