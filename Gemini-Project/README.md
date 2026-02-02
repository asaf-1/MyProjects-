````md
# AI ⇄ Google Sheets (Playwright) — Updated README

This project reads **prompts** from a Google Sheet and writes back **answers + status + timestamp**.
You can choose **one AI provider** via `.env` (Gemini UI or API providers like Groq/OpenAI/etc).

---

## ✅ What it does

- Reads prompts from **Column A** (starting from `A2`)
- For each row that is **pending**:
  - Pending = **Answer is empty** OR **Status is not DONE**
- Sends the prompt to the selected **AI Provider**
- Writes back:
  - **Column B**: Answer (normalized)
  - **Column C**: DONE / ERROR
  - **Column D**: updatedAt (ISO timestamp)
- Saves a Markdown report under `Reports/`

---

## ✨ Supported providers (choose ONE)

Set `AI_PROVIDER` in `.env` to exactly one of:

- `gemini-ui` ✅ (browser automation; no API key)
- `groq` ✅ (API, usually free tier)
- `openai` (API, requires API billing/quota)
- `anthropic` (API)
- `xai` (API)
- `perplexity` (API)

> **Important:** Only the provider in `AI_PROVIDER` is used.  
> Having other keys in `.env` does **not** matter, they are ignored unless that provider is selected.

---

## 📁 Where is the test?

Your test file is here:

- `C:\Users\asafn\Desktop\MyWork\tests\GeminiSheets.spec.ts`

You can run it from:

- `C:\Users\asafn\Desktop\MyWork`

---

## ✅ Prerequisites

### 1) Node + dependencies
- Node.js installed
- Inside your project folder run:
  - `npm install`

### 2) Google Sheets Service Account
- You must have a service account JSON file:
  - Example: `secrets/google-service-account.json`
- Share the Google Sheet with the service account email:
  - `xxxxx@xxxxx.iam.gserviceaccount.com`
  - Give **Editor** permission

---

## ⚙️ `.env` Template (copy/paste)

Create `.env` (or update it) and keep it simple.

### A) Gemini UI (no API key)
```env
AI_PROVIDER=gemini-ui
AI_TIER=best

GOOGLE_SHEET_ID=YOUR_SHEET_ID
GOOGLE_SHEET_TAB=Sheet1
GOOGLE_SA_PATH=C:/Users/asafn/Desktop/MyWork/Gemini-Project/secrets/google-service-account.json
````

### B) Groq API (recommended “free-ish” API option)

```env
AI_PROVIDER=groq
AI_TIER=fast
AI_MODEL=llama-3.1-8b-instant

GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxx
GROQ_BASE_URL=https://api.groq.com/openai/v1

GOOGLE_SHEET_ID=YOUR_SHEET_ID
GOOGLE_SHEET_TAB=Sheet1
GOOGLE_SA_PATH=C:/Users/asafn/Desktop/MyWork/Gemini-Project/secrets/google-service-account.json
```

### C) OpenAI API (requires API billing/quota)

```env
AI_PROVIDER=openai
AI_TIER=best
AI_MODEL=gpt-4o-mini

OPENAI_API_KEY=sk_xxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1

GOOGLE_SHEET_ID=YOUR_SHEET_ID
GOOGLE_SHEET_TAB=Sheet1
GOOGLE_SA_PATH=C:/Users/asafn/Desktop/MyWork/Gemini-Project/secrets/google-service-account.json
```

---

## 🧠 Model selection rules (simple)

* If you set `AI_MODEL=...` → it uses that model.
* If you **do not** set `AI_MODEL` → it selects a default model based on:

  * `AI_PROVIDER`
  * `AI_TIER` (`best | fast | cheap`)

**Tip:** For fewer issues, always set `AI_MODEL` explicitly.

---

## 📑 Multiple tabs support

You can run on one tab:

```env
GOOGLE_SHEET_TAB=Sheet1
```

Or multiple tabs:

```env
GOOGLE_SHEET_TABS=Sheet1,Sheet2,Sheet3
```

---

## ▶️ Run the test

### PowerShell / CMD

```bat
cd C:\Users\asafn\Desktop\MyWork
npx playwright test tests\GeminiSheets.spec.ts --project=chromium --headed --workers=1
```

### Git Bash

```bash
cd "/c/Users/asafn/Desktop/MyWork"
npx playwright test tests/GeminiSheets.spec.ts --project=chromium --headed --workers=1
```

> **Why `--headed` and `--workers=1`?**
> Makes runs more stable (especially for Gemini UI).

---

## 🧾 Reports

Reports are saved under:

* `Reports/AIReport_YYYY-MM-DDTHH-MM-SSZ.md`

Optional override:

```env
REPORT_DIR=C:/Users/asafn/Desktop/MyWork/Reports
```

---

## ✅ Expected sheet format

| Column | Name      | Purpose                         |
| ------ | --------- | ------------------------------- |
| A      | Prompt    | Input prompt (required)         |
| B      | Answer    | Output answer (written by test) |
| C      | Status    | DONE / ERROR                    |
| D      | UpdatedAt | ISO timestamp                   |

---

## 🛑 Common issues (and what they mean)

### 1) `[ERROR] HTTP 429 ... insufficient_quota` (OpenAI)

This means **OpenAI API billing/quota** is not available for your API project.

✅ Important: **ChatGPT Plus does NOT include API quota**
Plus is for ChatGPT UI; API is billed separately.

Fix:

* Enable billing / add payment method on OpenAI API platform
* Increase project limits / monthly budget

Workaround:

* Switch to `AI_PROVIDER=groq` (or use `gemini-ui`)

### 2) `[ERROR] HTTP 401 Unauthorized`

* Wrong API key
* Key not loaded from `.env`
* Key revoked

Fix:

* Verify `.env` path is loaded
* Recreate key

### 3) `[ERROR] HTTP 404 model not found`

* Model name not available on that provider

Fix:

* Change `AI_MODEL` to a valid model for that provider

### 4) Gemini UI “does nothing / can’t find editor”

* You’re not logged into Google
* Gemini UI changed selectors
* Headless issues

Fix:

* Run with `--headed`
* Log in to your Google account once
* Keep Gemini open and stable

---

## 🔐 Security notes (IMPORTANT)

* **Never paste API keys** into chats or commits
* If a key was exposed:

  * **Revoke it immediately**
  * Generate a new one

---

## ✅ Best practice setup (recommended)

If you want stability + free usage:

* Use `gemini-ui` for UI runs
* Use `groq` for API runs

---

## Roadmap (optional ideas)

* Add Gemini API (not UI)
* Retry logic + exponential backoff for rate limits
* Provider-specific model auto-detection (latest models)
* Better logging to console (exact HTTP errors)

---



