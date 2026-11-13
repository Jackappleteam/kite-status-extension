// Shared by popup + background. Talks to the Kite API with a personal API token.
async function getConfig() {
  const c = await chrome.storage.local.get(["apiBase", "token", "appId", "dashBase"]);
  const apiBase = (c.apiBase || "https://api.kite.onl").replace(/\/+$/, "");
  // Dashboard URL defaults to the API URL without the "api." prefix (api.kite.onl -> kite.onl).
  const dashBase = (c.dashBase || apiBase.replace("//api.", "//")).replace(/\/+$/, "");
  return { apiBase, token: c.token || "", appId: c.appId || "", dashBase };
}

async function kiteGet(cfg, path) { return kiteReq(cfg, "GET", path); }

async function kiteReq(cfg, method, path, reqBody) {
  // Uses your Kite login (session cookie) by default; an API token is optional.
  const headers = cfg.token ? { Authorization: "Bearer " + cfg.token } : {};
  if (reqBody !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(cfg.apiBase + "/v1" + path, {
    method, credentials: "include", headers, body: reqBody === undefined ? undefined : JSON.stringify(reqBody),
  });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok || (body && body.success === false)) {
    if (res.status === 401) { const e = new Error("Not logged in. Log in to Kite in this browser, or add an API token in Settings."); e.status = 401; throw e; }
    const msg = (body && body.error && body.error.message) || ("HTTP " + res.status);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return body ? body.data : null;
}

async function fetchStatus(cfg) {
  // Each call is independent so one missing route doesn't break the whole popup.
  const tryGet = async (path) => { try { return { data: await kiteGet(cfg, path) }; } catch (e) { return { err: `${path}: ${e.message}` }; } };
  const [appR, credR, featR, sumR, logR] = await Promise.all([
    tryGet(`/apps/${cfg.appId}`), tryGet(`/apps/${cfg.appId}/usage/credits`), tryGet(`/apps/${cfg.appId}/billing/features`),
    tryGet(`/apps/${cfg.appId}/logs/summary`), tryGet(`/apps/${cfg.appId}/logs?limit=100`),
  ]);
  const errors = sumR.data ? sumR.data.total_errors || 0 : 0;
  // Errors from the last 24h, newest first. "Unseen" = newer than the last one you dismissed.
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const allErr = ((logR.data || []).filter((l) => l.level === "error" && new Date(l.created_at).getTime() >= dayAgo))
    .sort((x, y) => y.id - x.id).map((l) => ({ id: l.id, message: l.message, at: l.created_at }));
  const ackKey = "errAck:" + cfg.appId;
  const ack = (await chrome.storage.local.get(ackKey))[ackKey] || 0;
  const unseen = allErr.filter((l) => l.id > ack);
  const latestErrorId = allErr.length ? allErr[0].id : 0;
  const recentErrors = unseen.slice(0, 3), unseenCount = unseen.length;
  const errorIds = unseen.map((l) => l.id);
  let app = appR.data;
  if (!app) { // fall back to the app list entry
    const list = await kiteGet(cfg, "/apps");
    app = (list || []).find((x) => x.id === cfg.appId);
    if (!app) throw new Error(appR.err || "App not found");
  }
  const { manualLimit } = await chrome.storage.local.get("manualLimit");
  const used = credR.data ? credR.data.credits_used || 0 : null;
  const limit = Number(manualLimit) || (featR.data ? featR.data.usage_credits_per_month || 0 : 0);
  // Logs are optional extras, so their failures are not shown as warnings.
  const warnings = [credR.err, featR.err && !manualLimit ? featR.err : null].filter(Boolean);
  return { app, used: used || 0, usedKnown: used !== null, limit, pct: limit > 0 ? Math.min(100, ((used || 0) / limit) * 100) : 0, warnings, errors, recentErrors, unseenCount, latestErrorId, errorIds, at: Date.now() };
}

// "online" | "paused" | "offline" | "error"
function statusKind(s) {
  if (s.app.token_invalid) return "error";
  if (!s.app.enabled) return "offline";
  if (s.app.no_credits || (s.limit > 0 && s.used >= s.limit)) return "paused";
  return "online";
}

// Quiet hours: no notifications between start and end (local time, can wrap past midnight).
async function getQuiet() {
  const q = await chrome.storage.local.get(["quietEnabled", "quietStart", "quietEnd"]);
  const start = q.quietStart || "22:00", end = q.quietEnd || "07:00";
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(start), b = toMin(end);
  const active = !!q.quietEnabled && a !== b && (a < b ? cur >= a && cur < b : cur >= a || cur < b);
  return { enabled: !!q.quietEnabled, start, end, active };
}
function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
