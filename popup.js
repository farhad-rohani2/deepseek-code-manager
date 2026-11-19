const $ = (id) => document.getElementById(id);
let blocks = [];
let directoryHandle = null;
let ccpData = null;
let ccpSelected = new Set();
const DB_NAME = "dscm-db";
const STORE = "handles";
const STORAGE_KEY = "dscm:lastCcp";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, "project");
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function loadHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get("project");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function sendToPage(message) {
  const tab = await getActiveTab();
  if (!tab?.id || !/deepseek\.com$/.test(new URL(tab.url).hostname)) {
    throw new Error("این ابزار را از داخل صفحه DeepSeek اجرا کن.");
  }
  return chrome.tabs.sendMessage(tab.id, message);
}
function safeRelativePath(input) {
  let path = String(input || "").trim().replace(/\\\\/g, "/").replace(/^\/+/, "");
  if (!path || path.includes("\0") || /^[a-z]:/i.test(path)) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.some(p => p === "." || p === "..")) return null;
  return parts.join("/");
}
function renderBlocks() {
  $("fileList").innerHTML = "";
  blocks.forEach((block, index) => {
    const row = document.createElement("div");
    row.className = "file-row";
    const label = document.createElement("label");
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = Boolean(block.path); check.dataset.index = index;
    const text = document.createElement("div");
    const path = document.createElement("div");
    path.className = "file-path";
    path.textContent = block.path || `بدون مسیر مشخص · کد ${index + 1}`;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = `${block.language || "code"} · ${block.content.length.toLocaleString()} کاراکتر`;
    text.append(path, meta);
    label.append(check, text); row.append(label);
    $("fileList").append(row);
  });
  $("createFiles").disabled = !blocks.some(b => b.path);
}
function setStatus(message) { $("status").textContent = message; }

function setCcpStatus(message, isError) {
  const el = $("ccpStatus");
  el.textContent = message;
  el.style.color = isError ? "#b42318" : "#596271";
}

function renderCcp() {
  const list = $("ccpList");
  const summary = $("ccpSummary");
  list.innerHTML = "";
  ccpSelected = new Set();
  if (!ccpData) {
    summary.hidden = true;
    summary.textContent = "";
    updateApplyButton();
    return;
  }
  const ccp = ccpData;
  summary.hidden = false;
  summary.textContent =
    `${ccp.project?.name || "پروژه"} · ${ccp.summary || ""}\n` +
    `${ccp.files.length} فایل` +
    (ccp.commands?.length ? ` · ${ccp.commands.length} دستور` : "");
  ccp.files.forEach((file, index) => {
    ccpSelected.add(index);
    const row = document.createElement("div");
    row.className = "file-row selected";
    const label = document.createElement("label");
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = true; check.dataset.ccpIndex = String(index);
    check.addEventListener("change", () => {
      if (check.checked) ccpSelected.add(index); else ccpSelected.delete(index);
      row.classList.toggle("selected", check.checked);
      updateApplyButton();
    });
    const text = document.createElement("div");
    const path = document.createElement("div");
    path.className = "file-path";
    path.textContent = file.path;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    const badge = document.createElement("span");
    badge.className = "badge badge-" + file.action;
    badge.textContent = file.action;
    meta.append(badge);
    if (file.action === "patch") {
      const len = (file.patch || "").split("\n").length;
      meta.append(` · ${len} خط diff`);
    } else if (file.action === "delete") {
      meta.append(" · حذف کامل فایل");
    } else {
      meta.append(` · ${(file.content || "").length.toLocaleString()} کاراکتر`);
    }
    text.append(path, meta);
    label.append(check, text);
    row.append(label);
    list.append(row);
  });
  updateApplyButton();
}

function updateApplyButton() {
  const disabled = !ccpData || ccpSelected.size === 0;
  const main = $("applyCcp");
  const top = $("applyCcpTop");
  if (main) main.disabled = disabled;
  if (top) top.disabled = disabled;
}

function parseCcpText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { ok: false, error: "متنی برای تحلیل وجود ندارد." };
  }
  if (!window.CCP) return { ok: false, error: "ماژول CCP بارگذاری نشد." };
  const parsed = CCP.parseCCP(rawText);
  if (!parsed) return { ok: false, error: "JSON معتبر با format=code-change-package پیدا نشد." };
  const validation = CCP.validateCCP(parsed.ccp);
  if (!validation.ok) return { ok: false, error: "بسته تغییرات نامعتبر است.", errors: validation.errors };
  return { ok: true, ccp: parsed.ccp };
}

async function saveCcpToStorage(ccp, source) {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { ccp, savedAt: Date.now(), source: source || "popup" }
    });
  } catch (_) { /* ignore */ }
}

async function loadCcpFromStorage() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const entry = data?.[STORAGE_KEY];
    if (!entry?.ccp) return null;
    const validation = window.CCP ? CCP.validateCCP(entry.ccp) : { ok: true };
    if (!validation.ok) return null;
    return entry;
  } catch { return null; }
}

async function clearCcpFromStorage() {
  try { await chrome.storage.local.remove(STORAGE_KEY); } catch (_) {}
}

function applyLoadedCcp(entry, originLabel) {
  if (!entry?.ccp) return false;
  ccpData = entry.ccp;
  renderCcp();
  const when = entry.savedAt ? new Date(entry.savedAt).toLocaleTimeString() : "";
  $("ccpSavedHint").hidden = false;
  $("ccpSavedHint").textContent = `بسته ذخیره‌شده بازیابی شد (${originLabel})${when ? " · " + when : ""}.`;
  setCcpStatus(`بسته از ذخیره بازیابی شد: ${ccpData.files.length} فایل.`);
  return true;
}

async function loadCcpFromPage() {
  setCcpStatus("در حال خواندن بسته از صفحه...");
  try {
    const response = await sendToPage({ type: "DSCM_EXTRACT_CCP" });
    if (!response?.ok) {
      const detail = response?.errors?.length ? "\n" + response.errors.join("\n") : "";
      setCcpStatus((response?.error || "خطا در خواندن بسته.") + detail, true);
      $("ccpPasteWrap").open = true;
      return;
    }
    ccpData = response.ccp;
    renderCcp();
    await saveCcpToStorage(ccpData, "popup-load");
    $("ccpSavedHint").hidden = false;
    $("ccpSavedHint").textContent = "بسته در حافظه ذخیره شد؛ دفعه بعد نیازی به بازخوانی نیست.";
    setCcpStatus(`بسته شناسایی و ذخیره شد: ${ccpData.files.length} فایل.`);
  } catch (e) {
    setCcpStatus(e.message || "خطا در خواندن صفحه.", true);
    $("ccpPasteWrap").open = true;
  }
}

function parsePastedCcp() {
  const raw = $("ccpPasteArea").value;
  const result = parseCcpText(raw);
  if (!result.ok) {
    const detail = result.errors?.length ? "\n" + result.errors.join("\n") : "";
    setCcpStatus((result.error || "تحلیل ناموفق بود.") + detail, true);
    return;
  }
  ccpData = result.ccp;
  renderCcp();
  saveCcpToStorage(ccpData, "paste");
  $("ccpSavedHint").hidden = false;
  $("ccpSavedHint").textContent = "بسته پیست‌شده ذخیره شد.";
  setCcpStatus(`بسته پیست‌شده تحلیل و ذخیره شد: ${ccpData.files.length} فایل.`);
}

async function applyCcp() {
  if (!ccpData) return;
  if (!directoryHandle) { setCcpStatus("ابتدا پوشه پروژه را انتخاب کن.", true); return; }
  const selectedFiles = ccpData.files.filter((_, i) => ccpSelected.has(i));
  if (!selectedFiles.length) { setCcpStatus("هیچ فایلی انتخاب نشده است.", true); return; }
  const preview = selectedFiles.map(f => `${f.action}: ${f.path}`).join("\n");
  if (!confirm(`این تغییرات در پوشه ${directoryHandle.name} اعمال می‌شوند:\n\n${preview}\n\nادامه می‌دهی؟`)) return;
  try {
    if (!(await ensurePermission(directoryHandle))) { setCcpStatus("مجوز نوشتن در پوشه داده نشد.", true); return; }
    const ccp = { ...ccpData, files: selectedFiles };
    const result = await CCP.applyCCP(directoryHandle, ccp, { overwrite: $("ccpOverwrite").checked });
    setCcpStatus(`تمام شد: ${result.written} ایجاد، ${result.replaced} جایگزین، ${result.patched} patch، ${result.deleted} حذف، ${result.skipped} رد شد.`);
    console.info("CCP log", result.log);
  } catch (e) {
    setCcpStatus("خطا در اعمال بسته: " + e.message, true);
  }
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("انتخاب پوشه در این نسخه Chrome پشتیبانی نمی‌شود. Chrome را به‌روز کن.");
    return;
  }
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveHandle(directoryHandle);
    $("folderLabel").textContent = directoryHandle.name;
    setStatus("پوشه پروژه انتخاب شد.");
  } catch (e) {
    if (e.name !== "AbortError") setStatus("انتخاب پوشه ناموفق بود: " + e.message);
  }
}
async function restoreFolder() {
  try {
    directoryHandle = await loadHandle();
    if (directoryHandle) $("folderLabel").textContent = directoryHandle.name + " (ذخیره‌شده)";
  } catch {}
}
async function scanPage() {
  try {
    const response = await sendToPage({ type: "DSCM_SCAN" });
    blocks = response.blocks || [];
    renderBlocks();
    const withPath = blocks.filter(b => b.path).length;
    setStatus(`${blocks.length} بلوک کد پیدا شد؛ ${withPath} مورد دارای مسیر فایل هستند.`);
  } catch (e) { setStatus(e.message || "خطا در خواندن صفحه."); }
}
async function collapseAll(type) {
  try { await sendToPage({ type }); }
  catch (e) { setStatus(e.message || "این دستور فقط در صفحه DeepSeek کار می‌کند."); }
}
async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  if (await handle.queryPermission(opts) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}
async function getDirectory(root, segments) {
  let current = root;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: true });
  return current;
}
async function writeOne(root, path, content, overwrite) {
  const parts = path.split("/");
  const name = parts.pop();
  const dir = await getDirectory(root, parts);
  if (!overwrite) {
    try { await dir.getFileHandle(name); return "exists"; }
    catch (e) { if (e.name !== "NotFoundError") throw e; }
  }
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
  return "written";
}
async function createFiles() {
  if (!directoryHandle) { setStatus("ابتدا پوشه پروژه را انتخاب کن."); return; }
  const selected = [...$("fileList").querySelectorAll('input[type="checkbox"]:checked')]
    .map(input => blocks[Number(input.dataset.index)]).filter(Boolean);
  const prepared = selected.map(block => ({ ...block, safePath: safeRelativePath(block.path) }));
  const invalid = prepared.filter(b => !b.safePath);
  if (invalid.length) { setStatus("مسیر نامعتبر وجود دارد؛ مسیر فایل‌ها را بررسی کن."); return; }
  if (!prepared.length) { setStatus("هیچ فایل مسیر‌داری انتخاب نشده است."); return; }

  const overwrite = $("overwrite").checked;
  const preview = prepared.map(b => b.safePath).join("\n");
  if (!confirm(`این فایل‌ها در پوشه ${directoryHandle.name} ساخته می‌شوند:\n\n${preview}\n\nادامه می‌دهی؟${overwrite ? "\nفایل‌های موجود جایگزین خواهند شد." : "\nفایل‌های موجود دست‌نخورده می‌مانند."}`)) return;
  try {
    if (!(await ensurePermission(directoryHandle))) { setStatus("مجوز نوشتن در پوشه داده نشد."); return; }
    let written = 0, skipped = 0;
    for (const block of prepared) {
      const result = await writeOne(directoryHandle, block.safePath, block.content, overwrite);
      if (result === "written") written++; else skipped++;
    }
    setStatus(`تمام شد: ${written} فایل ساخته/جایگزین شد، ${skipped} فایل موجود رد شد.`);
  } catch (e) { setStatus("خطا هنگام ساخت فایل: " + e.message); }
}

async function copyPrompt(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    $("promptStatus").textContent = `${label} کپی شد. در چت DeepSeek پیست کن.`;
  } catch (e) {
    $("promptStatus").textContent = "کپی ناموفق بود: " + e.message;
  }
}

const PROMPT_FA = `از این به بعد هنگام تولید یا اصلاح کد پروژه، خروجی را به شکل یک بسته تغییرات ساختاریافته (Code Change Package) تولید کن.

قواعد:

1. اگر فایل جدیدی لازم است، مسیر کامل نسبی آن را مشخص کن.
2. اگر فایل موجود باید اصلاح شود، به‌جای ارسال کل فایل، تغییرات را در قالب Git Unified Diff ارائه بده.
3. اگر تغییرات گسترده هستند و Diff قابل اتکا نیست، محتوای کامل فایل را ارسال کن.
4. هیچ تغییری را بدون مشخص کردن مسیر فایل انجام‌شده فرض نکن.
5. تغییرات هر فایل باید مستقل و قابل بررسی باشند.
6. وابستگی‌ها، دستورات نصب و دستورات لازم برای اجرا را نیز مشخص کن.
7. مسیرها باید نسبی به ریشه پروژه باشند.
8. کدها را خلاصه نکن و از عبارت‌هایی مثل «بقیه کد بدون تغییر» استفاده نکن.
9. خروجی نهایی را فقط در یک بلوک JSON معتبر قرار بده؛ قبل و بعد از آن توضیح اضافه ننویس.

ساختار خروجی:

{
  "format": "code-change-package",
  "version": 1,
  "project": { "name": "project-name" },
  "summary": "توضیح تغییرات",
  "files": [
    { "path": "src/example.js", "action": "create", "content": "کد کامل فایل جدید" },
    { "path": "src/app.js", "action": "patch", "patch": "محتوای کامل Git Unified Diff" },
    { "path": "src/config.js", "action": "replace", "content": "محتوای کامل فایل جایگزین" },
    { "path": "src/legacy.js", "action": "delete" }
  ],
  "commands": [ "npm install", "npm run build" ]
}

مقادیر action فقط create، patch، replace و delete باشند.
برای patch حتماً Diff استاندارد و قابل اعمال با Git تولید کن.
JSON باید معتبر باشد و رشته‌ها، خط‌های جدید و کاراکترهای خاص به‌درستی Escape شوند.

خروجی را در یک بلاک کد با زبان json قرار بده. حتماً format دقیقاً برابر code-change-package و version برابر 1 باشد. برای patch از Git Unified Diff استاندارد (--- a/... و +++ b/... و خطوط @@ -l,c +l,c @@) استفاده کن و مسیرها در path نسبی و بدون / ابتدایی باشند.`;

const PROMPT_EN = `From now on, when generating or modifying project code, produce the output as a structured Code Change Package.

Rules:

1. If a new file is needed, specify its full relative path.
2. If an existing file must be modified, provide the changes as a Git Unified Diff instead of the full file.
3. If the changes are large and a diff is not reliable, provide the full file content.
4. Do not assume any change without specifying the file path.
5. Each file's changes must be independent and reviewable.
6. Also specify dependencies, install commands, and commands needed to run.
7. Paths must be relative to the project root.
8. Do not abbreviate code or use phrases like "rest of the code unchanged".
9. Put the final output only inside a single valid JSON block; no extra text before or after.

Output structure:

{
  "format": "code-change-package",
  "version": 1,
  "project": { "name": "project-name" },
  "summary": "Description of changes",
  "files": [
    { "path": "src/example.js", "action": "create", "content": "Full content of new file" },
    { "path": "src/app.js", "action": "patch", "patch": "Full Git Unified Diff" },
    { "path": "src/config.js", "action": "replace", "content": "Full replacement content" },
    { "path": "src/legacy.js", "action": "delete" }
  ],
  "commands": [ "npm install", "npm run build" ]
}

The action values must be only create, patch, replace, or delete.
For patch, always produce a standard, git-applicable diff.
JSON must be valid; escape strings, newlines, and special characters correctly.

Place the output inside a code block with language json. The format must be exactly code-change-package and version must be 1. For patch, use a standard Git Unified Diff (--- a/... and +++ b/... and @@ -l,c +l,c @@ lines), and paths must be relative without a leading slash.`;

$("chooseFolder").addEventListener("click", chooseFolder);
$("scan").addEventListener("click", scanPage);
$("collapseAll").addEventListener("click", () => collapseAll("DSCM_COLLAPSE_ALL"));
$("expandAll").addEventListener("click", () => collapseAll("DSCM_EXPAND_ALL"));
$("createFiles").addEventListener("click", createFiles);
$("loadCcp").addEventListener("click", loadCcpFromPage);
$("applyCcp").addEventListener("click", applyCcp);
$("applyCcpTop").addEventListener("click", applyCcp);
$("parsePaste").addEventListener("click", parsePastedCcp);
$("copyPromptFa").addEventListener("click", () => copyPrompt(PROMPT_FA, "پرامپت فارسی"));
$("copyPromptEn").addEventListener("click", () => copyPrompt(PROMPT_EN, "English prompt"));
$("clearSavedCcp").addEventListener("click", async () => {
  await clearCcpFromStorage();
  ccpData = null; renderCcp();
  $("ccpSavedHint").hidden = true;
  setCcpStatus("بسته ذخیره‌شده پاک شد.");
});

async function bootstrap() {
  await restoreFolder();
  const saved = await loadCcpFromStorage();
  if (saved) {
    applyLoadedCcp(saved, saved.source === "inline-button" ? "از دکمه صفحه" : "ذخیره‌شده");
  } else {
    // اگر ذخیره‌ای نبود، یک‌بار تلاش می‌کنیم از صفحه بخوانیم.
    loadCcpFromPage().catch(() => {});
  }
}

bootstrap();
