// Only trusted extension pages may read the credential store directly.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "get-login" || !sender.tab) return;
  const url = new URL(sender.url);
  if (url.origin !== "https://moodlecse.iitkgp.ac.in" ||
      url.pathname !== "/moodle/login/index.php" || sender.frameId !== 0) return;
  chrome.storage.local.get("login").then(({ login }) => respond(login || null), () => respond(null));
  return true;
});
