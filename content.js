(async () => {
  if (location.pathname !== "/moodle/login/index.php" || window.top !== window) return;
  const login = await chrome.runtime.sendMessage({ type: "get-login" });
  if (!login?.enabled || !login.username || !login.password) return;

  const password = document.querySelector('input[name="password"]');
  const form = password?.form;
  const username = form?.querySelector('input[name="username"]');
  if (!form || !username || !password) return;
  for (const [input, value] of [[username, login.username], [password, login.password]]) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const notice = document.createElement("p");
  notice.setAttribute("role", "status");
  notice.style.cssText = "padding:12px;border:1px solid #b6d5ee;border-radius:6px;background:#edf7ff;color:#163d59;font:14px/1.5 system-ui";
  form.prepend(notice);
  let submitted = false;
  function submitLogin() {
    if (!login.autoSubmit || submitted) return;
    const key = "cse-moodle-login-attempt";
    const lastAttempt = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastAttempt < 120000 || form.querySelector('[role="alert"], .alert-danger, .error')) {
      notice.textContent = "Details filled. Automatic retry paused; check your details and click Log in.";
      return;
    }
    if (form.checkValidity && !form.checkValidity()) {
      notice.textContent = "Details filled. Complete the required fields, then click Log in.";
      return;
    }
    const button = form.querySelector('button#loginbtn, button[type="submit"], input[type="submit"]');
    if (button?.disabled) {
      notice.textContent = "Details filled. The Log in button is disabled.";
      return;
    }
    submitted = true;
    sessionStorage.setItem(key, String(Date.now()));
    notice.textContent = "Signing in to CSE Moodle…";
    if (button) button.click();
    else form.requestSubmit();
  }
  const input = form.querySelector('input[name*="captcha" i]:not([type="hidden"]), input[id*="captcha" i]:not([type="hidden"]), input[placeholder*="captcha" i], input[aria-label*="captcha" i]');
  const image = form.querySelector('img[alt*="captcha" i], img[id*="captcha" i], img[src*="captcha" i]');
  const challenge = input || image || form.querySelector('[class*="captcha" i], iframe') ||
    document.querySelector('iframe[src*="captcha" i], script[src*="recaptcha" i], script[src*="hcaptcha" i]');
  if (challenge) {
    input?.focus();
    if (login.readCaptcha === false) {
      notice.textContent = "Details filled. CAPTCHA autofill is off in the extension settings.";
      return;
    }
    if (!input || !image) {
      notice.textContent = "Details filled. Could not locate a supported CAPTCHA image and text field. Please complete the challenge manually.";
      return;
    }
    if (typeof globalThis.readMoodleCaptcha !== "function") {
      notice.textContent = "CAPTCHA reader is missing. Reload CSE Moodle Quick Login on chrome://extensions, then reload this page.";
      return;
    }
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Read CAPTCHA again";
    retry.style.cssText = "margin:0 0 12px;padding:8px 12px;border:1px solid #b6d5ee;border-radius:5px;cursor:pointer";
    notice.after(retry);
    let generation = 0;
    let generatedValue = null;
    let edited = false;
    input.addEventListener("input", (event) => {
      if (event.isTrusted) edited = true;
    });
    const read = async (force = false) => {
      if (input.value && generatedValue === null && !force) {
        notice.textContent = "Details filled. Your existing CAPTCHA entry was kept.";
        return;
      }
      const current = ++generation;
      const previousValue = input.value;
      edited = false;
      retry.disabled = true;
      notice.textContent = "Reading CAPTCHA locally…";
      try {
        const result = await globalThis.readMoodleCaptcha(image);
        if (current !== generation || edited || input.value !== previousValue) return;
        input.value = result;
        generatedValue = result;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        notice.textContent = "CAPTCHA filled automatically. Click Log in to continue.";
        submitLogin();
      } catch (error) {
        if (current === generation) notice.textContent = error.message || "Could not read CAPTCHA. Please enter it manually.";
      } finally {
        if (current === generation) retry.disabled = false;
      }
    };
    retry.addEventListener("click", () => read(true));
    // Load fires even when the server refreshes the image using the same URL.
    image.addEventListener("load", () => {
      if (generatedValue !== null && input.value === generatedValue) input.value = "";
      read();
    });
    await read();
    return;
  }
  if (!login.autoSubmit) {
    notice.textContent = "CSE Moodle Login filled your details. Click Log in to continue.";
    return;
  }
  submitLogin();
})().catch(() => { /* The normal Moodle login remains usable if the extension is unavailable. */ });
