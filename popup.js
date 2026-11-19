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
function safeRelativePath(input) { return CCP.safeRelativePath(input); }
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
  try {
    // مجوز باید همان لحظه کلیک (با user activation) گرفته شود، نه بعد از confirm
    if (!(await ensurePermission(directoryHandle))) { setCcpStatus("مجوز نوشتن در پوشه داده نشد. پوشه را دوباره انتخاب کن.", true); return; }
  } catch (e) {
    setCcpStatus("خطا در دریافت مجوز پوشه: " + e.message + " — پوشه را دوباره انتخاب کن.", true);
    return;
  }
  if (!confirm(`این تغییرات در پوشه ${directoryHandle.name} اعمال می‌شوند:\n\n${preview}\n\nادامه می‌دهی؟`)) return;
  try {
    const ccp = { ...ccpData, files: selectedFiles };
    const result = await CCP.applyCCP(directoryHandle, ccp, { overwrite: $("ccpOverwrite").checked });
    setCcpStatus(`تمام شد: ${result.written} ایجاد، ${result.replaced} جایگزین، ${result.patched} patch، ${result.deleted} حذف، ${result.skipped} رد شد.`, result.skipped > 0);
    $("ccpSummary").hidden = false;
    $("ccpSummary").textContent = result.log.join("\n");
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

const FENCE = "```";
const EXAMPLE_ORIGINAL_APP = 'const express = require("express");\nconst app = express();\n\napp.get("/", (req, res) => {\n  res.send("Hello");\n});\n\napp.listen(3000);\n';
const EXAMPLE_PATCH = [
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,8 +1,9 @@",
  ' const express = require("express");',
  '+const { greet } = require("./utils/greet");',
  " const app = express();",
  " ",
  ' app.get("/", (req, res) => {',
  '-  res.send("Hello");',
  '+  res.send(greet("World"));',
  " });",
  " ",
  " app.listen(3000);",
  ""
].join("\n");
const EXAMPLE_CCP = {
  format: "code-change-package",
  version: 1,
  project: { name: "my-app" },
  summary: "افزودن تابع greet و استفاده از آن در app.js",
  files: [
    { path: "src/utils/greet.js", action: "create", content: 'function greet(name) {\n  return `Hello ${name}`;\n}\n\nmodule.exports = { greet };\n' },
    { path: "src/app.js", action: "patch", patch: EXAMPLE_PATCH },
    { path: "src/config.js", action: "replace", content: 'module.exports = {\n  port: 3000\n};\n' },
    { path: "src/legacy.js", action: "delete" }
  ],
  commands: ["npm install", "node src/app.js"]
};
const EXAMPLE_JSON = JSON.stringify(EXAMPLE_CCP, null, 2);

const PROMPT_FA = `از این به بعد هنگام تولید یا اصلاح کد پروژه، خروجی را فقط به شکل یک «بسته تغییرات ساختاریافته» (Code Change Package) بده.

## قواعد کلی
1. مسیر هر فایل نسبی به ریشه پروژه باشد؛ بدون / ابتدایی، بدون .. و بدون درایو ویندوز.
2. فایل جدید: action برابر create و محتوای کامل در content.
3. فایل موجود با تغییر کوچک: action برابر patch و Git Unified Diff در patch.
4. فایل موجود با تغییر گسترده (بیش از حدود نیمی از فایل): action برابر replace و محتوای کامل فایل در content.
5. حذف فایل: action برابر delete (بدون content و patch).
6. کد را خلاصه نکن و عباراتی مثل «بقیه کد بدون تغییر» ننویس.
7. هر مسیر فقط یک بار در files بیاید.
8. دستورهای لازم (نصب وابستگی، مایگریشن، build و...) را در commands بنویس؛ اگر دستوری لازم نیست commands را [] بگذار. کلید commands همیشه باید وجود داشته باشد.
9. project.name و summary همیشه پر باشند.

## قواعد patch (مهم‌ترین بخش؛ خطا اینجا رایج است)
- دقیقاً این ساختار: خط --- a/مسیر، خط +++ b/مسیر، سپس یک یا چند hunk با هدر @@ -شروعقدیم,تعدادقدیم +شروعجدید,تعدادجدید @@
- در هر hunk هر خط با یکی از این سه نویسه شروع شود: فاصله (خط بدون تغییر)، - (حذف)، + (افزودن).
- خط خالیِ بدون تغییر هم باید یک فاصله داشته باشد (یعنی در JSON به شکل "\\n \\n"). خط کاملاً خالی بدون فاصله ننویس.
- حدود ۳ خط context بدون تغییر قبل و بعد از هر تغییر بگذار و متن context را دقیقاً مطابق فایل اصلی (با همان فاصله‌ها و indent) بنویس.
- تعداد قدیم = خطوط context + خطوط حذف‌شده. تعداد جدید = خطوط context + خطوط افزوده‌شده. شماره خط شروع را با دقت بنویس.
- اگر محتوای فعلی فایل را ندیده‌ای و مطمئن نیستی، به‌جای patch از replace استفاده کن؛ حدس نزن.
- پایان patch با یک \\n باشد.

## قواعد JSON
- JSON کاملاً معتبر باشد: رشته‌ها داخل "..."، خط جدید به شکل \\n، گیومه داخل رشته به شکل \\"، بک‌اسلش به شکل \\\\ ، و بدون کامنت و بدون ویرگول اضافی.
- format دقیقاً "code-change-package" و version عدد 1 باشد.
- action فقط یکی از create، patch، replace، delete باشد.

## قالب خروجی
- بالای بلوک کد دقیقاً یک خط تیتر ### diff بنویس، و بلافاصله بعد از آن یک بلوک کد با زبان json که کل JSON داخل آن است.
- هیچ توضیح دیگری قبل یا بعد از آن ننویس، مگر اینکه خودم بخواهم.

## مثال کامل (فقط الگوی ساختار است؛ محتوای آن را کپی نکن)
فرض کن فایل src/app.js فعلی این است:
${FENCE}js
${EXAMPLE_ORIGINAL_APP}${FENCE}

خروجی درست این است:

### diff
${FENCE}json
${EXAMPLE_JSON}
${FENCE}

## چک‌لیست قبل از ارسال
- آیا همه خطوط hunk با فاصله، - یا + شروع می‌شوند؟
- آیا خط‌های خالیِ context یک فاصله دارند؟
- آیا context دقیقاً مطابق فایل اصلی است؟
- آیا JSON معتبر است و commands وجود دارد؟
- آیا فقط یک تیتر ### diff و یک بلوک json ارسال می‌کنم؟`;

const PROMPT_EN = `From now on, when generating or modifying project code, output ONLY a structured Code Change Package.

## General rules
1. Every path is relative to the project root: no leading /, no .., no Windows drive letters.
2. New file: action "create" with the full content in "content".
3. Existing file, small change: action "patch" with a Git Unified Diff in "patch".
4. Existing file, large change (more than about half of the file): action "replace" with the full file in "content".
5. Delete a file: action "delete" (no content, no patch).
6. Never abbreviate code or write things like "rest of the code unchanged".
7. Each path may appear only once in "files".
8. Put required commands (install, migrate, build, ...) in "commands"; if none are needed use []. The "commands" key must always be present.
9. "project.name" and "summary" must always be filled in.

## Patch rules (the most important part; mistakes are common here)
- Exact structure: a "--- a/path" line, a "+++ b/path" line, then one or more hunks with a header like @@ -oldStart,oldCount +newStart,newCount @@
- Inside a hunk every line starts with exactly one of: a space (unchanged), - (removed), + (added).
- An unchanged blank line must still carry one space (in JSON: "\\n \\n"). Never write a completely empty line without the space.
- Include about 3 unchanged context lines before and after each change, copied exactly from the original file (same indentation and spacing).
- oldCount = context lines + removed lines. newCount = context lines + added lines. Compute the start line numbers carefully.
- If you have not seen the current file content and are not sure about it, use "replace" instead of "patch"; do not guess.
- The patch must end with a single \\n.

## JSON rules
- Fully valid JSON: strings in "...", newlines as \\n, quotes inside strings as \\", backslashes as \\\\ , no comments, no trailing commas.
- "format" must be exactly "code-change-package" and "version" must be the number 1.
- "action" must be only one of create, patch, replace, delete.

## Output format
- Right above the code block write exactly one heading line: ### diff, followed immediately by a single code block with language json that contains the whole JSON.
- Write no other text before or after it unless I ask.

## Full example (only a structure pattern; do not copy its content)
Assume the current src/app.js is:
${FENCE}js
${EXAMPLE_ORIGINAL_APP}${FENCE}

The correct output is:

### diff
${FENCE}json
${EXAMPLE_JSON}
${FENCE}

## Checklist before sending
- Does every hunk line start with a space, - or +?
- Do blank context lines carry a single space?
- Does the context match the original file exactly?
- Is the JSON valid and is "commands" present?
- Am I sending exactly one ### diff heading and one json block?`;

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
