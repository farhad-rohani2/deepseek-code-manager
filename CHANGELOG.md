# Changelog

All notable changes to **DeepSeek Code Manager** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-19

### Added
- Detection of Code Change Package (CCP) blocks via a preceding `h3` heading with text `diff` (also accepts `code-change-package` and `ccp`).
- Support for CCP JSON placed inside plain `<pre>` blocks, not only DeepSeek code-block banners.
- Manual JSON paste section in the popup (`<details id="ccpPasteWrap">`) with a textarea and a "تحلیل JSON پیست‌شده" button, as a fallback when auto-detection fails.
- New popup button `loadCcp` ("بازخوانی بسته از صفحه") to re-read the CCP from the active DeepSeek tab.
- New content-script message handler `DSCM_EXTRACT_CCP` that parses and validates the latest CCP found on the page.
- `tabs` permission added to `manifest.json` for reliable tab querying from the popup.
- `ccp.js` is now loaded as part of the content scripts (before `content.js`) so the CCP module is available on the page.

### Changed
- `manifest.json` version bumped from `1.1.0` to `1.2.0`.
- Popup footer updated to "نسخه ۱.۲".
- Popup CCP panel layout: `loadCcp` and `applyCcp` now appear in a shared `.actions` grid, each spanning the full row.
- `.ccp-summary` now uses `white-space: pre-wrap` for multi-line summaries.
- Selected CCP file rows are highlighted via `.file-row.selected`.

### Fixed
- CCP extraction no longer depends solely on `.md-code-block-banner-wrap` banners; headings followed by `<pre>` are also scanned.
- Popup now opens the paste section automatically when auto-detection fails, making the fallback discoverable.

### Notes
- Requires reloading the extension from `chrome://extensions` after updating `manifest.json`.
- Requires `ccp.js` to be present; otherwise the popup shows "ماژول CCP بارگذاری نشد.".

## [1.1.0] - (previous release)

### Added
- Collapse/expand controls for DeepSeek code blocks.
- Popup scanning of page code blocks with nearest-path detection.
- Create-files flow into a user-selected project folder using the File System Access API.
- Initial Code Change Package (CCP) support: parse, validate, and apply `create` / `patch` / `replace` actions.
- Git Unified Diff validation and application (`applyUnifiedDiff`) with multi-hunk support.

[1.2.0]: #120---2026-11-19
[1.1.0]: #110---previous-release
