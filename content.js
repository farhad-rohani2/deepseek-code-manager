(() => {
  if (window.__dsCodeManagerInstalled) return;
  window.__dsCodeManagerInstalled = true;

  const CCP = globalThis.CCP || null;

  const BUTTON_CLASS = "dscm-fold-button";
  const COLLAPSED_CLASS = "dscm-collapsed";
  const processed = new WeakSet();

  function cleanPath(value) {
    return (value || "").replace(/[`"'\s]/g, "").replace(/^\/+/, "").trim();
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

  function isDiffHeading(el) {
    if (!el || !/^H[1-6]$/.test(el.tagName)) return false;
    const text = (el.textContent || "").trim().toLowerCase();
    return text === "diff" || text === "code-change-package" || text === "ccp";
  }

  function closestCodeBlockAfter(heading) {
    let node = heading.nextElementSibling;
    let scanned = 0;
    while (node && scanned < 3) {
      if (node.tagName === "PRE") return node;
      const pre = node.querySelector && node.querySelector("pre");
      if (pre) return pre;
      node = node.nextElementSibling;
      scanned++;
    }
    return null;
  }

  function findLastCodeBlockText() {
    // ۱) اولویت: تیترهای h3/h2/... با عنوان diff / code-change-package / ccp
    let last = "";
    const headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for (const heading of headings) {
      if (!isDiffHeading(heading)) continue;
      const pre = closestCodeBlockAfter(heading);
      if (!pre) continue;
      const text = pre.innerText ?? pre.textContent ?? "";
      if (text && /"format"\s*:\s*"code-change-package"/.test(text)) last = text;
    }
    if (last) return last;

    // ۲) همه بلوک‌های کد معمولی
    const banners = [...document.querySelectorAll(".md-code-block-banner-wrap")];
    for (const banner of banners) {
      const found = findCodeRoot(banner);
      if (!found) continue;
      const code = found.pre.querySelector("code") || found.pre;
      const text = code.innerText ?? code.textContent ?? "";
      if (text && /"format"\s*:\s*"code-change-package"/.test(text)) last = text;
    }
    return last;
  }

  function extractCCP() {
    if (!CCP) return { ok: false, error: "ماژول CCP در صفحه بارگذاری نشد." };
    const text = findLastCodeBlockText();
    if (!text) return { ok: false, error: "هیچ بلوک Code Change Package در صفحه پیدا نشد." };
    const parsed = CCP.parseCCP(text);
    if (!parsed) return { ok: false, error: "JSON معتبر با format=code-change-package پیدا نشد." };
    const validation = CCP.validateCCP(parsed.ccp);
    if (!validation.ok) return { ok: false, error: "بسته تغییرات نامعتبر است.", errors: validation.errors };
    return { ok: true, ccp: parsed.ccp, raw: parsed.raw };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DSCM_SCAN") {
      sendResponse({ blocks: extractBlocks(), page: location.href });
    }
    if (message?.type === "DSCM_EXTRACT_CCP") {
      try { sendResponse(extractCCP()); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
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