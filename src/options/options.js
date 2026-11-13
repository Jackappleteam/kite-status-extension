chrome.storage.local.get("theme").then((v) => {
  document.documentElement.dataset.theme = v.theme || "system";
  document.getElementById("theme").value = v.theme || "system";
});
// Theme applies immediately and is remembered for the popup.
document.getElementById("theme").onchange = (e) => {
  document.documentElement.dataset.theme = e.target.value;
  chrome.storage.local.set({ theme: e.target.value });
};
const $ = (id) => document.getElementById(id);
// kind: "ok" | "bad" | "busy"
const msg = (t, bad) => { const kind = bad === true ? "bad" : bad || "ok"; $("msg").textContent = t; $("msg").className = "small status " + kind; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const formUrl = () => ($("apiBase").value.trim() || "https://api.kite.onl").replace(/\/+$/, "");

/* Test connection: checks the URL, permission and login without saving anything */
$("test").onclick = async () => {
  const apiBase = formUrl(), token = $("token").value.trim(), btn = $("test");
  btn.disabled = true; msg("Testing…", "busy");
  try {
    if (!(await chrome.permissions.request({ origins: [new URL(apiBase).origin + "/*"] }))) return msg("Permission to reach " + apiBase + " was denied.", true);
    const cfg = { apiBase, token };
    const apps = (await kiteGet(cfg, "/apps")) || [];
    let who = "";
    try { const u = await kiteGet(cfg, "/users/@me"); who = u && (u.display_name || u.discord_username) || ""; } catch (_) { /* API tokens may not be allowed to read the profile */ }
    msg(`✓ Connected${who ? " as " + who : ""} · found ${plural(apps.length, "bot")}`);
  } catch (e) { msg("Couldn't connect: " + e.message.replace("in Settings", "above"), true); }
  finally { btn.disabled = false; }
};

$("save").onclick = async () => {
  const apiBase = formUrl();
  const token = $("token").value.trim(), btn = $("save");
  btn.disabled = true; btn.textContent = "Saving…"; msg("Saving…", "busy");
  try {
    if (!(await chrome.permissions.request({ origins: [new URL(apiBase).origin + "/*"] }))) return msg("Permission to reach " + apiBase + " was denied.", true);
    const apps = await kiteGet({ apiBase, token }, "/apps");
    const { appId } = await chrome.storage.local.get("appId");
    const keep = (apps || []).some((a) => a.id === appId) ? appId : apps[0] && apps[0].id;
    await chrome.storage.local.set({ quietEnabled: $("quietEnabled").checked, quietStart: $("quietStart").value || "22:00", quietEnd: $("quietEnd").value || "07:00", errorAlerts: $("errorAlerts").checked, apiBase, token, apps: apps || [], appId: keep || "" });
    msg(`Saved. Connected — found ${plural((apps || []).length, "bot")}. Click the toolbar icon.`);
    btn.textContent = "✓ Saved"; btn.classList.add("saved");
    setTimeout(() => { btn.textContent = "Save & connect"; btn.classList.remove("saved"); }, 2000);
    return;
  } catch (e) { msg("Failed: " + e.message.replace("in Settings", "above"), true); }
  finally { btn.disabled = false; if (!btn.classList.contains("saved")) btn.textContent = "Save & connect"; }
};
(async () => { const c = await getConfig(); $("apiBase").value = c.apiBase; $("token").value = c.token; const d = await chrome.storage.local.get(["errorAlerts", "quietEnabled", "quietStart", "quietEnd"]); $("quietEnabled").checked = !!d.quietEnabled; $("quietStart").value = d.quietStart || "22:00"; $("quietEnd").value = d.quietEnd || "07:00"; syncQuiet(); $("errorAlerts").checked = d.errorAlerts !== false; })();

function syncQuiet() { document.getElementById("quietTimes").classList.toggle("off", !document.getElementById("quietEnabled").checked); }
document.getElementById("quietEnabled").onchange = syncQuiet;

$("version").textContent = "v" + chrome.runtime.getManifest().version;
