(() => {
  if (window.__dsCodeManagerInstalled) return;
  window.__dsCodeManagerInstalled = true;

  const BUTTON_CLASS = "dscm-fold-button";
  const COLLAPSED_CLASS = "dscm-collapsed";
  const processed = new WeakSet();

  function cleanPath(value) {
    return (value || "").replace(/[`"'\\s]/g, "").replace(/^\/+/, "").trim();
  }

  function findCodeRoot(banner) {
    let node = banner;
    for (let i = 0; i < 7 && node; i++, node = node.parentElement) {
      const candidate = node.querySelector("pre");
      if (candidate && candidate !== banner) return { root: node, pre: candidate };
    }
    // Fallback: locate the next pre element in document order.
    let next = banner.parentElement;
    for (let i = 0; i < 5 && next; i++, next = next.parentElement) {
      const all = [...next.querySelectorAll("pre")];
      const pre = all.find(el => el.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_PRECEDING);
      if (pre) return { root: pre.parentElement || pre, pre };
    }
    return null;
  }

  function nearestPath(banner) {
    const headings = [...document.querySelectorAll("h1,h2,h3,h4")];
    let best = "";
    for (const heading of headings) {
      const relation = heading.compareDocumentPosition(banner);
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING) continue;
      const code = heading.querySelector("code");
      const text = cleanPath(code ? code.textContent : heading.textContent);
      if (text && (text.includes("/") || /\.[a-z0-9]{1,8}$/i.test(text))) best = text;
    }
    return best;
  }

  function addFoldControls(banner, pre) {
    if (processed.has(banner)) return;
    processed.add(banner);

    const controls = document.createElement("span");
    controls.className = "dscm-controls";

    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = BUTTON_CLASS;
    fold.textContent = "− جمع‌کردن";
    fold.title = "جمع‌کردن / بازکردن کد";
    fold.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = pre.classList.toggle(COLLAPSED_CLASS);
      fold.textContent = collapsed ? "+ بازکردن" : "− جمع‌کردن";
      fold.setAttribute("aria-expanded", String(!collapsed));
    });

    controls.appendChild(fold);
    const header = banner.querySelector(".md-code-block-banner") || banner;
    header.appendChild(controls);
  }

  function scan() {
    const banners = document.querySelectorAll(".md-code-block-banner-wrap");
    for (const banner of banners) {
      const found = findCodeRoot(banner);
      if (found) addFoldControls(banner, found.pre);
    }
  }

  function extractBlocks() {
    scan();
    const banners = [...document.querySelectorAll(".md-code-block-banner-wrap")];
    const result = [];
    banners.forEach((banner, index) => {
      const found = findCodeRoot(banner);
      if (!found) return;
      const code = found.pre.querySelector("code") || found.pre;
      const content = code.innerText ?? code.textContent ?? "";
      if (!content.trim()) return;

      const path = nearestPath(banner);
      result.push({
        id: `block-${index + 1}`,
        path,
        language: (banner.querySelector(".d813de27")?.textContent || "").trim(),
        content: content.replace(/\r\n/g, "\n"),
        hasPath: Boolean(path)
      });
    });
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DSCM_SCAN") {
      sendResponse({ blocks: extractBlocks(), page: location.href });
    }
    if (message?.type === "DSCM_COLLAPSE_ALL" || message?.type === "DSCM_EXPAND_ALL") {
      scan();
      const collapse = message.type === "DSCM_COLLAPSE_ALL";
      document.querySelectorAll(".md-code-block-banner-wrap").forEach(banner => {
        const found = findCodeRoot(banner);
        if (!found) return;
        found.pre.classList.toggle(COLLAPSED_CLASS, collapse);
        const button = banner.querySelector(`.${BUTTON_CLASS}`);
        if (button) {
          button.textContent = collapse ? "+ بازکردن" : "− جمع‌کردن";
          button.setAttribute("aria-expanded", String(!collapse));
        }
      });
      sendResponse({ ok: true });
    }
    return true;
  });

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  setTimeout(scan, 1200);
})();