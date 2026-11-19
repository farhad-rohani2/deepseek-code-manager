const $ = (id) => document.getElementById(id);
let blocks = [];
let directoryHandle = null;
let ccpData = null;
let ccpSelected = new Set();
const DB_NAME = "dscm-db";
const STORE = "handles";

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
  $("applyCcp").disabled = !ccpData || ccpSelected.size === 0;
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

async function loadCcpFromPage() {
  setCcpStatus("در حال خواندن بسته از صفحه...");
  try {
    const response = await sendToPage({ type: "DSCM_EXTRACT_CCP" });
    if (!response?.ok) {
      ccpData = null; renderCcp();
      const detail = response?.errors?.length ? "\n" + response.errors.join("\n") : "";
      setCcpStatus((response?.error || "خطا در خواندن بسته.") + detail, true);
      $("ccpPasteWrap").open = true;
      return;
    }
    ccpData = response.ccp;
    renderCcp();
    setCcpStatus(`بسته شناسایی شد: ${ccpData.files.length} فایل.`);
  } catch (e) {
    ccpData = null; renderCcp();
    setCcpStatus(e.message || "خطا در خواندن صفحه.", true);
    $("ccpPasteWrap").open = true;
  }
}

function parsePastedCcp() {
  const raw = $("ccpPasteArea").value;
  const result = parseCcpText(raw);
  if (!result.ok) {
    ccpData = null; renderCcp();
    const detail = result.errors?.length ? "\n" + result.errors.join("\n") : "";
    setCcpStatus((result.error || "تحلیل ناموفق بود.") + detail, true);
    return;
  }
  ccpData = result.ccp;
  renderCcp();
  setCcpStatus(`بسته پیست‌شده تحلیل شد: ${ccpData.files.length} فایل.`);
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
    setCcpStatus(`تمام شد: ${result.written} ایجاد، ${result.replaced} جایگزین، ${result.patched} patch، ${result.skipped} رد شد.`);
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

$("chooseFolder").addEventListener("click", chooseFolder);
$("scan").addEventListener("click", scanPage);
$("collapseAll").addEventListener("click", () => collapseAll("DSCM_COLLAPSE_ALL"));
$("expandAll").addEventListener("click", () => collapseAll("DSCM_EXPAND_ALL"));
$("createFiles").addEventListener("click", createFiles);
$("loadCcp").addEventListener("click", loadCcpFromPage);
$("applyCcp").addEventListener("click", applyCcp);
$("parsePaste").addEventListener("click", parsePastedCcp);
restoreFolder();
