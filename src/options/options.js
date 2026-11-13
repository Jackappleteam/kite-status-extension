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
const msg = (t, bad) => { $("msg").textContent = t; $("msg").style.color = bad ? "hsl(0 90% 75%)" : "hsl(142 71% 55%)"; };

$("save").onclick = async () => {
  const apiBase = ($("apiBase").value.trim() || "https://api.kite.onl").replace(/\/+$/, "");
  const token = $("token").value.trim();
  try {
    if (!(await chrome.permissions.request({ origins: [new URL(apiBase).origin + "/*"] }))) return msg("Permission to reach " + apiBase + " was denied.", true);
    const apps = await kiteGet({ apiBase, token }, "/apps");
    const { appId } = await chrome.storage.local.get("appId");
    const keep = (apps || []).some((a) => a.id === appId) ? appId : apps[0] && apps[0].id;
    await chrome.storage.local.set({ quietEnabled: $("quietEnabled").checked, quietStart: $("quietStart").value || "22:00", quietEnd: $("quietEnd").value || "07:00", errorAlerts: $("errorAlerts").checked, apiBase, token, apps: apps || [], appId: keep || "" });
    msg(`Connected — found ${(apps || []).length} app(s). Click the toolbar icon.`);
  } catch (e) { msg("Failed: " + e.message, true); }
};
(async () => { const c = await getConfig(); $("apiBase").value = c.apiBase; $("token").value = c.token; const d = await chrome.storage.local.get(["errorAlerts", "quietEnabled", "quietStart", "quietEnd"]); $("quietEnabled").checked = !!d.quietEnabled; $("quietStart").value = d.quietStart || "22:00"; $("quietEnd").value = d.quietEnd || "07:00"; syncQuiet(); $("errorAlerts").checked = d.errorAlerts !== false; })();

function syncQuiet() { document.getElementById("quietTimes").classList.toggle("off", !document.getElementById("quietEnabled").checked); }
document.getElementById("quietEnabled").onchange = syncQuiet;
