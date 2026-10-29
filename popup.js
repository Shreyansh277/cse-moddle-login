const byId = (id) => document.getElementById(id);
const status = (message) => { byId("status").textContent = message; };
chrome.storage.local.get("login").then(({ login }) => {
  if (!login) return;
  for (const key of ["username", "password"]) byId(key).value = login[key] || "";
  for (const key of ["enabled", "autoSubmit"]) byId(key).checked = Boolean(login[key]);
  byId("readCaptcha").checked = login.readCaptcha !== false;
}).catch(() => status("Could not load settings. Reopen the extension."));
byId("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ login: {
      username: byId("username").value.trim(), password: byId("password").value,
      readCaptcha: byId("readCaptcha").checked, enabled: byId("enabled").checked, autoSubmit: byId("autoSubmit").checked
    } });
    status("Saved. Open or reload Moodle to use these settings.");
  } catch { status("Could not save settings. Please try again."); }
});
byId("open").addEventListener("click", () => chrome.tabs.create({ url: "https://moodlecse.iitkgp.ac.in/moodle/login/index.php" }));
byId("forget").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("login");
    byId("settings").reset();
    status("Saved credentials removed.");
  } catch { status("Could not remove settings. Please try again."); }
});
