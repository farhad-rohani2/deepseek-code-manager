# DeepSeek Code Manager — Release v1.2.0

## عنوان کوتاه (Short Title)
DeepSeek Code Manager — مدیریت کد و بسته تغییرات

---

## توضیح کوتاه (Short Description — حداکثر ۱۳۲ کاراکتر)
جمع‌کردن کدهای DeepSeek، ساخت فایل در پوشه پروژه و اعمال بسته تغییرات ساختاریافته (create / patch / replace).

---

## توضیح کامل (Full Description)

**DeepSeek Code Manager** یک افزونه سبک و کاربردی برای مرورگر Chrome است که کار با بلوک‌های کد در صفحه‌های DeepSeek Chat را ساده‌تر می‌کند و امکان اعمال بسته‌های تغییرات ساختاریافته (Code Change Package) را مستقیم روی پوشه پروژه فراهم می‌سازد — بدون نیاز به کپی/پیست دستی.

### ✨ ویژگی‌ها

- **جمع‌کردن و بازکردن کدها**
  هر بلوک کد در صفحه یک دکمهٔ کوچک جمع/باز شدن دارد. با یک کلیک همه را می‌توانید جمع یا باز کنید.

- **شناسایی خودکار کدهای صفحه**
  پاپ‌آپ افزونه فهرست بلوک‌های کد صفحه را با زبان و مسیر احتمالی فایل نشان می‌دهد.

- **ساخت فایل در پوشه پروژه**
  با انتخاب یک پوشه (File System Access API) کدهای انتخاب‌شده به‌صورت مستقیم در ساختار درست ساخته می‌شوند. گزینهٔ جایگزینی فایل‌های موجود هم فراهم است.

- **پشتیبانی از Code Change Package (CCP)**
  پاسخ‌های ساختاریافتهٔ مدل را (با `format=code-change-package`) از صفحه می‌خواند، اعتبارسنجی می‌کند و سه نوع تغییر را اعمال می‌کند:
  - `create` — ساخت فایل جدید
  - `patch` — اعمال Git Unified Diff روی فایل موجود
  - `replace` — جایگزینی کامل محتوای فایل

- **تشخیص با تیتر `diff`**
  کافی است بالای بلوک JSON یک تیتر `### diff` بگذارید؛ افزونه آن را پیدا و پردازش می‌کند. عنوان‌های `code-change-package` و `ccp` هم پذیرفته می‌شوند.

- **پیست دستی JSON**
  اگر تشخیص خودکار به هر دلیلی انجام نشد، بخش «پیست دستی JSON» در پاپ‌آپ هست؛ متن را پیست کنید، تحلیل می‌شود و در صورت معتبر بودن اعمال می‌شود.

- **امنیت و کنترل**
  - مسیرهای نسبی اعتبارسنجی می‌شوند (بدون `..`، بدون مسیر مطلق، بدون درایو ویندوز).
  - هر نوشتن فایل پیش از اجرا از کاربر تأیید گرفته می‌شود.
  - هیچ داده‌ای به سرور خارجی ارسال نمی‌شود؛ همه پردازش‌ها محلی‌اند.

### 🔧 مناسب چه کسانی است؟
- توسعه‌دهندگانی که با DeepSeek Chat کد تولید می‌کنند و می‌خواهند تغییرات را مستقیم در پروژه اعمال کنند.
- کسانی که از خروجی «Code Change Package» استفاده می‌کنند و به‌دنبال اعمال یک‌کلیکی هستند.
- افرادی که می‌خواهند بلوک‌های کد طولانی صفحه را مرتب جمع کنند.

### 📌 نکات نسخه ۱.۲.۰
- پشتیبانی از تیتر `diff` برای تشخیص CCP
- پشتیبانی از `<pre>` معمولی (نه فقط بنر کد)
- افزودن پیست دستی JSON در پاپ‌آپ
- افزودن دکمهٔ «بازخوانی بسته از صفحه»
- ارتقای manifest به نسخه `1.2.0` و افزودن مجوز `tabs`

### 🛡️ مجوزها
- `activeTab`, `scripting`, `storage`, `tabs`
- دسترسی میزبان فقط محدود به `chat.deepseek.com` و `*.deepseek.com`

### 🚀 نصب / به‌روزرسانی
1. فایل افزونه (پوشه یا zip) را از `chrome://extensions` بارگذاری/Reload کنید.
2. وارد صفحهٔ `chat.deepseek.com` شوید.
3. از پاپ‌آپ، پوشه پروژه را انتخاب کنید.

---

## متن آماده برای صفحه Chrome Web Store

**نام:** DeepSeek Code Manager
**نسخه:** 1.2.0
**دسته:** Developer Tools / Productivity

**توضیح کوتاه:**
Collapse DeepSeek code blocks, jump to them from popup, and apply structured Code Change Packages (create/patch/replace) into your project folder.

**توضیح کامل (انگلیسی):**
DeepSeek Code Manager is a lightweight Chrome extension that streamlines working with code blocks on DeepSeek Chat.

- **Collapse / expand** any code block, or all of them at once.
- **Scan** the page and list every code block with its detected path and language.
- **Write files** directly into a project folder you choose (File System Access API). Optional overwrite of existing files.
- **Apply Code Change Packages (CCP):**
  - `create` new files
  - `patch` existing files with standard Git Unified Diff
  - `replace` files entirely
- **Detection via an `### diff` heading** above the JSON block (also accepts `code-change-package` / `ccp`).
- **Manual JSON paste fallback** in the popup when auto-detection fails.
- **Safe paths:** relative only; `..`, absolute paths, and Windows drive letters are rejected.
- **No external requests.** All parsing and file operations happen locally in your browser.

**Permissions:** `activeTab`, `scripting`, `storage`, `tabs`. Host access limited to `chat.deepseek.com` and `*.deepseek.com`.

**Install / update:**
1. Load or reload the extension from `chrome://extensions`.
2. Open `chat.deepseek.com`.
3. In the popup, pick your project folder and start applying changes.

---

## تغییرات نسخه (Changelog v1.2.0)

### Added
- CCP detection via `h3 diff` heading (also `code-change-package`, `ccp`).
- Support for CCP inside plain `<pre>` blocks.
- Manual JSON paste section in popup.
- "Reload CCP from page" button.
- Content-script message `DSCM_EXTRACT_CCP`.
- `tabs` permission and `ccp.js` loaded as content script.

### Changed
- Version bumped to `1.2.0`.
- Popup footer updated to "نسخه ۱.۲".
- CCP action buttons span full width.
- Multi-line summary styling.

### Fixed
- CCP extraction no longer relies only on code-block banners.
- Paste section opens automatically when auto-detection fails.
