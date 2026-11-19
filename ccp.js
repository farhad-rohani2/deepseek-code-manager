// ccp.js — Code Change Package parser/validator/applier
(function (global) {
    "use strict";

    const FORMAT = "code-change-package";
    const ACTIONS = new Set(["create", "patch", "replace", "delete"]);

    // --- پیدا کردن آخرین بلوک JSON معتبر داخل متن ---
    function extractJsonCandidates(text) {
        const candidates = [];
        const len = text.length;
        for (let i = 0; i < len; i++) {
            if (text[i] !== "{") continue;
            let depth = 0;
            let inStr = false;
            let esc = false;
            for (let j = i; j < len; j++) {
                const ch = text[j];
                if (inStr) {
                    if (esc) { esc = false; continue; }
                    if (ch === "\\") { esc = true; continue; }
                    if (ch === '"') inStr = false;
                    continue;
                }
                if (ch === '"') { inStr = true; continue; }
                if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) {
                        candidates.push({ start: i, end: j + 1, text: text.slice(i, j + 1) });
                        i = j;
                        break;
                    }
                }
            }
        }
        return candidates;
    }

    function parseCCP(text) {
        const candidates = extractJsonCandidates(text);
        for (let k = candidates.length - 1; k >= 0; k--) {
            const raw = candidates[k].text;
            let obj;
            try { obj = JSON.parse(raw); } catch { continue; }
            if (obj && obj.format === FORMAT) {
                return { ccp: obj, raw, range: candidates[k] };
            }
        }
        return null;
    }

    // --- اعتبارسنجی مسیر نسبی امن ---
    function safeRelativePath(input) {
        let path = String(input || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
        if (!path || path.includes("\0") || /^[a-z]:/i.test(path)) return null;
        const parts = path.split("/").filter(Boolean);
        if (parts.some(p => p === "." || p === "..")) return null;
        return parts.join("/");
    }

    // --- اعتبارسنجی حداقلی Git Unified Diff ---
    function validateUnifiedDiff(patch) {
        if (typeof patch !== "string" || !patch.trim()) {
            return { ok: false, error: "patch خالی است." };
        }
        const lines = patch.split("\n");
        let hasFileHeader = false;
        let hasHunk = false;
        for (const line of lines) {
            if (/^diff --git /.test(line)) hasFileHeader = true;
            else if (/^--- /.test(line) || /^\+\+\+ /.test(line)) hasFileHeader = true;
            else if (/^@@ /.test(line)) hasHunk = true;
        }
        if (!hasFileHeader) return { ok: false, error: "هدر فایل (---/+++/diff --git) در patch پیدا نشد." };
        if (!hasHunk) return { ok: false, error: "هیچ hunk (@@ ... @@) در patch پیدا نشد." };
        for (const line of lines) {
            if (/^@@ /.test(line)) {
                const m = line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
                if (!m) return { ok: false, error: "فرمت خط hunk نامعتبر است: " + line };
            }
        }
        return { ok: true };
    }

    function validateCCP(obj) {
        const errors = [];
        if (!obj || typeof obj !== "object") return { ok: false, errors: ["خروجی JSON نیست."] };
        if (obj.format !== FORMAT) errors.push(`format باید "${FORMAT}" باشد.`);
        if (obj.version !== 1) errors.push("version باید 1 باشد.");
        if (!obj.project || typeof obj.project.name !== "string" || !obj.project.name.trim()) {
            errors.push("project.name الزامی است.");
        }
        if (typeof obj.summary !== "string") errors.push("summary باید رشته باشد.");
        if (!Array.isArray(obj.files) || obj.files.length === 0) {
            errors.push("files باید آرایه غیرخالی باشد.");
        } else {
            const seenPaths = new Set();
            obj.files.forEach((f, i) => {
                const where = `files[${i}]`;
                if (!f || typeof f !== "object") { errors.push(`${where} معتبر نیست.`); return; }
                if (!ACTIONS.has(f.action)) errors.push(`${where}.action باید یکی از create/patch/replace/delete باشد.`);
                const safe = safeRelativePath(f.path);
                if (!safe) errors.push(`${where}.path نامعتبر یا ناامن است.`);
                else if (seenPaths.has(safe)) errors.push(`${where}.path تکراری است: ${safe}`);
                else seenPaths.add(safe);
                if (f.action === "patch") {
                    const v = validateUnifiedDiff(f.patch);
                    if (!v.ok) errors.push(`${where}.patch نامعتبر: ${v.error}`);
                } else if (f.action === "create" || f.action === "replace") {
                    if (typeof f.content !== "string") errors.push(`${where}.content باید رشته باشد.`);
                }
                // برای delete نیازی به content/patch نیست
            });
        }
        if (obj.commands !== undefined && !Array.isArray(obj.commands)) errors.push("commands در صورت وجود باید آرایه باشد.");
        return { ok: errors.length === 0, errors };
    }

    // --- پیاده‌سازی اعمال تغییرات ---
    async function ensurePermission(handle) {
        const opts = { mode: "readwrite" };
        if (await handle.queryPermission(opts) === "granted") return true;
        return (await handle.requestPermission(opts)) === "granted";
    }

    async function getDirectory(root, segments, create) {
        let current = root;
        for (const segment of segments) {
            current = await current.getDirectoryHandle(segment, { create });
        }
        return current;
    }

    async function readTextFile(root, path) {
        const parts = path.split("/");
        const name = parts.pop();
        const dir = await getDirectory(root, parts, false);
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        return file.text();
    }

    async function writeTextFile(root, path, content) {
        const parts = path.split("/");
        const name = parts.pop();
        const dir = await getDirectory(root, parts, true);
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(content);
        await w.close();
    }

    async function deleteFile(root, path) {
        const parts = path.split("/");
        const name = parts.pop();
        const dir = await getDirectory(root, parts, false);
        await dir.removeEntry(name);
    }

    async function fileExists(root, path) {
        try {
            const parts = path.split("/");
            const name = parts.pop();
            const dir = await getDirectory(root, parts, false);
            await dir.getFileHandle(name);
            return true;
        } catch { return false; }
    }

    // اعمال patch با تحمل خطاهای رایج خروجی مدل‌ها:
    //  - شماره خط نادرست (hunk با جست‌وجوی نزدیک‌ترین تطابق پیدا می‌شود)
    //  - تعداد خطوط نادرست در هدر hunk (نادیده گرفته می‌شود)
    //  - خط خالی context بدون فاصله ابتدایی
    //  - فایل‌های CRLF و فاصله‌های انتهایی خط
    function applyUnifiedDiff(originalText, patchText) {
        const eol = originalText.includes("\r\n") ? "\r\n" : "\n";
        const work = originalText.replace(/\r\n/g, "\n").split("\n");
        const patchLines = String(patchText).replace(/\r\n/g, "\n").split("\n");
        if (patchLines.length && patchLines[patchLines.length - 1] === "") patchLines.pop();

        const hunks = [];
        let cur = null;
        for (const line of patchLines) {
            const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (m) {
                cur = { oldStart: parseInt(m[1], 10), ops: [] };
                hunks.push(cur);
                continue;
            }
            if (!cur) continue;                      // هدرهای قبل از اولین hunk
            if (line.startsWith("\\")) continue;     // \ No newline at end of file
            if (/^diff --git /.test(line)) { cur = null; continue; }
            if (line === "") { cur.ops.push({ t: " ", s: "" }); continue; }
            const t = line[0];
            if (t !== " " && t !== "-" && t !== "+") throw new Error("خط نامعتبر در patch: " + line);
            cur.ops.push({ t, s: line.slice(1) });
        }
        if (!hunks.length) throw new Error("hunk در patch پیدا نشد.");

        const norm = (x) => x.replace(/\s+$/, "");
        let delta = 0;

        for (const [hi, hunk] of hunks.entries()) {
            let ops = hunk.ops;
            const attempt = (list) => {
                const old = list.filter(o => o.t !== "+").map(o => o.s);
                if (old.length === 0) {
                    const pos = Math.min(Math.max(hunk.oldStart + delta, 0), work.length);
                    return { start: pos, old };
                }
                const base = Math.min(Math.max(hunk.oldStart - 1 + delta, 0), work.length);
                const matches = (st) => {
                    if (st < 0 || st + old.length > work.length) return false;
                    for (let k = 0; k < old.length; k++) if (norm(work[st + k]) !== norm(old[k])) return false;
                    return true;
                };
                for (let d = 0; d <= work.length; d++) {
                    if (matches(base + d)) return { start: base + d, old };
                    if (d && matches(base - d)) return { start: base - d, old };
                }
                return null;
            };

            let found = attempt(ops);
            if (!found) {
                // تلاش دوم: حذف خطوط خالی context ابتدا/انتهای hunk
                let a = 0, b = ops.length;
                while (a < b && ops[a].t === " " && ops[a].s.trim() === "") a++;
                while (b > a && ops[b - 1].t === " " && ops[b - 1].s.trim() === "") b--;
                ops = ops.slice(a, b);
                found = attempt(ops);
            }
            if (!found) {
                const first = ops.find(o => o.t !== "+");
                throw new Error(`hunk شماره ${hi + 1} در فایل پیدا نشد (اولین خط مورد انتظار: "${first ? first.s : ""}"). احتمالاً فایل با نسخه‌ای که مدل دیده فرق دارد.`);
            }

            const out = [];
            let p = found.start;
            for (const op of ops) {
                if (op.t === " ") out.push(work[p++]);
                else if (op.t === "-") p++;
                else out.push(op.s);
            }
            work.splice(found.start, found.old.length, ...out);
            delta += out.length - found.old.length;
        }
        return work.join(eol);
    }

    async function applyCCP(rootHandle, ccp, options) {
        const overwrite = Boolean(options?.overwrite);
        const log = [];
        let written = 0, replaced = 0, patched = 0, deleted = 0, skipped = 0;

        if (!(await ensurePermission(rootHandle))) {
            throw new Error("مجوز نوشتن در پوشه داده نشد.");
        }

        for (const file of ccp.files) {
            const safe = safeRelativePath(file.path);
            if (!safe) { log.push(`✗ مسیر نامعتبر: ${file.path}`); skipped++; continue; }
            try {
                if (file.action === "create") {
                    if (await fileExists(rootHandle, safe)) {
                        if (!overwrite) { log.push(`↷ رد شد (موجود): ${safe}`); skipped++; continue; }
                        await writeTextFile(rootHandle, safe, file.content);
                        log.push(`✚ جایگزین شد: ${safe}`); written++;
                    } else {
                        await writeTextFile(rootHandle, safe, file.content);
                        log.push(`✚ ایجاد شد: ${safe}`); written++;
                    }
                } else if (file.action === "replace") {
                    const existed = await fileExists(rootHandle, safe);
                    await writeTextFile(rootHandle, safe, file.content);
                    log.push(existed ? `✎ جایگزین شد: ${safe}` : `✚ ایجاد شد (replace روی فایل ناموجود): ${safe}`);
                    replaced++;
                } else if (file.action === "patch") {
                    if (!(await fileExists(rootHandle, safe))) {
                        log.push(`✗ فایل برای patch پیدا نشد: ${safe}`); skipped++; continue;
                    }
                    const original = await readTextFile(rootHandle, safe);
                    let updated;
                    try { updated = applyUnifiedDiff(original, file.patch); }
                    catch (e) { log.push(`✗ patch ناموفق (${safe}): ${e.message}`); skipped++; continue; }
                    await writeTextFile(rootHandle, safe, updated);
                    log.push(`⇄ patch اعمال شد: ${safe}`); patched++;
                } else if (file.action === "delete") {
                    if (!(await fileExists(rootHandle, safe))) {
                        log.push(`↷ از قبل وجود ندارد (حذف‌شده فرض شد): ${safe}`); continue;
                    }
                    await deleteFile(rootHandle, safe);
                    log.push(`✗ حذف شد: ${safe}`); deleted++;
                }
            } catch (e) {
                log.push(`✗ خطا (${safe}): ${e.message}`); skipped++;
            }
        }
        return { written, replaced, patched, deleted, skipped, log };
    }

    global.CCP = { parseCCP, validateCCP, validateUnifiedDiff, applyCCP, safeRelativePath, applyUnifiedDiff };
})(self);
