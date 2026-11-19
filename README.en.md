# DeepSeek Code Manager

> A lightweight Chrome extension that streamlines working with code blocks in **DeepSeek Chat** and lets you apply structured **Code Change Packages (CCP)** directly into a project folder.

---

## ✨ Features

- **Collapse / expand code blocks** — every block gets a fold button; all blocks can be toggled at once.
- **Scan page code blocks** — the popup lists each block with its detected language and likely file path.
- **Write files into a project folder** — uses the File System Access API; optional overwrite of existing files.
- **Apply Code Change Packages (CCP)** with three actions:
  - `create` — new file
  - `patch` — apply a standard Git Unified Diff to an existing file
  - `replace` — replace the entire file content
- **Detection via an `### diff` heading** — place it above the JSON block (also accepts `code-change-package` and `ccp`).
- **Manual JSON paste fallback** — if auto-detection fails, paste the JSON into the popup.
- **Safe paths** — relative only; `..`, absolute paths, and Windows drive letters are rejected.
- **No external requests** — all parsing and file operations happen locally in your browser.

---

## 📦 Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. The extension icon appears in the toolbar.

---

## 🚀 Usage

### 1. Choose a project folder
Click **Select project folder** in the popup and pick a folder. Access is persisted after the first grant.

### 2. Collapse code blocks
- **Scan page code blocks** — lists all blocks on the page.
- **Collapse all / Expand all** — quick control over long code.

### 3. Create files
- Tick the blocks that have a detected path.
- Enable **Overwrite existing files** if needed.
- Click **Create selected files in project**.

### 4. Apply a Code Change Package
1. In the model's reply, place a heading above the JSON block:

   ```markdown
   ### diff
   ```json
   { "format": "code-change-package", ... }
   ```
   ```

2. In the popup click **Reload CCP from page**.
3. Review and confirm the file list.
4. Click **Apply Code Change Package**.

> If auto-detection fails, open the **Manual JSON paste** section, paste the text, and click **Parse pasted JSON**.

---

## 🧩 Code Change Package format

```json
{
  "format": "code-change-package",
  "version": 1,
  "project": { "name": "my-project" },
  "summary": "Description of the changes",
  "files": [
    {
      "path": "src/example.js",
      "action": "create",
      "content": "// Full content of the new file"
    },
    {
      "path": "src/app.js",
      "action": "patch",
      "patch": "--- a/src/app.js\n+++ b/src/app.js\n@@ -1,3 +1,4 @@\n ..."
    },
    {
      "path": "src/config.js",
      "action": "replace",
      "content": "// Full replacement content"
    }
  ],
  "commands": ["npm install", "npm run build"]
}
```

### Rules
- `format` must be exactly `code-change-package` and `version` must be `1`.
- `action` must be one of `create` / `patch` / `replace`.
- `path` must be relative and must not start with `/`; `..` is not allowed.
- For `patch`, use a standard **Git Unified Diff** (`--- a/...`, `+++ b/...`, `@@ -l,c +l,c @@`).
- All strings must be valid, properly escaped JSON.

---

## 🔐 Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Temporary access to the active tab |
| `scripting` | Inject scripts into the DeepSeek page |
| `storage` | Persist settings |
| `tabs` | Identify the active tab to send messages |

Host access is limited to:
- `https://chat.deepseek.com/*`
- `https://*.deepseek.com/*`

No data is sent to external servers.

---

## 🗂️ Project structure

```
deepseek-code-manager/
├── ccp.js          # CCP parser / validator / applier
├── content.js      # Page script: fold code blocks, extract CCP
├── content.css     # Fold button styles
├── manifest.json   # Extension manifest (MV3)
├── popup.html      # Popup UI
├── popup.css       # Popup styles
├── popup.js        # Popup logic
├── README.md       # Persian README
├── README.en.md    # This file (English)
├── CHANGELOG.md    # Change history
└── RELEASE.md      # Release notes
```

---

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full change history.

### Version 1.2.0
- CCP detection via an `### diff` heading
- Support for plain `<pre>` blocks
- Manual JSON paste in the popup
- "Reload CCP from page" button
- Added `tabs` permission and loaded `ccp.js` in content scripts

---

## 🛠️ Development

```bash
# Clone
git clone <repo-url>
cd deepseek-code-manager

# Load in Chrome
# chrome://extensions → Load unpacked → select the folder
```

After making changes, click **Reload** on the extension card in `chrome://extensions`.

---

## ⚠️ Limitations
- Works only in Chrome and Chromium-based browsers that support the File System Access API.
- File paths must be present in the model's reply.
- `patch` only works on text files.

---

## 📄 License

MIT
