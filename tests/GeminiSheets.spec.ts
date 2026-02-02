// tests/GeminiSheets.spec.ts
import { test, expect, Page, Locator, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

test.setTimeout(15 * 60 * 1000);
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** =====================================
 *  SETTINGS
 *  ===================================== */
const ANSWER_MODE: 'singleline' | 'raw' | 'truncate' = 'singleline';
const TRUNCATE_MAX = 1500;

/** -------------------------
 *  Load .env (works if you run from MyWork OR from Gemini-Project)
 *  ------------------------- */
function loadEnvSmart() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.env'),
    path.join(cwd, 'Gemini-Project', '.env'),
    path.join(cwd, '..', 'Gemini-Project', '.env'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      console.log(`✅ Loaded ENV from: ${p}`);
      return;
    }
  }
  console.log('⚠️ No .env found. Using process.env only.');
}
loadEnvSmart();

/** -------------------------
 *  Report path helpers
 *  ------------------------- */
function safeTimestampForWindows(d = new Date()) {
  // 2026-02-01T22-11-33.123Z
  return d.toISOString().replace(/:/g, '-');
}

function resolveReportDir(): string {
  const envDir = (process.env.REPORT_DIR || '').trim();
  if (envDir) {
    const abs = path.isAbsolute(envDir) ? envDir : path.join(process.cwd(), envDir);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  // Default: try to keep it in MyWork/Gemini-Project/Reports even if running from MyWork
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'Gemini-Project', 'Reports'),
    path.join(cwd, '..', 'Gemini-Project', 'Reports'),
    path.join(cwd, 'Reports'),
  ];

  for (const p of candidates) {
    try {
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }

  // fallback
  const fallback = path.join(process.cwd(), 'Reports');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const REPORT_DIR = resolveReportDir();

/** -------------------------
 *  Google Sheets Client
 *  ------------------------- */
type SheetRow = {
  rowNumber: number;
  prompt: string;
  answer: string;
  status: string;
  updatedAt: string;
};

function normalizeAnswerForSheet(answer: string): string {
  const a = (answer || '').toString();

  if (ANSWER_MODE === 'raw') return a.trim();

  if (ANSWER_MODE === 'truncate') {
    const oneLine = a.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= TRUNCATE_MAX) return oneLine;
    return oneLine.slice(0, TRUNCATE_MAX) + ' ...[TRUNCATED]';
  }

  return a.replace(/\s+/g, ' ').trim();
}

// ✅ Sheet אחד או כמה Sheets עם פסיקים
function getSheetTabsFromEnv(): string[] {
  const raw =
    (process.env.GOOGLE_SHEET_TABS ||
      process.env.GOOGLE_SHEET_TAB ||
      process.env.SHEET_TABS ||
      process.env.SHEET_TAB ||
      'Sheet1') + '';

  const tabs = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return tabs.length ? tabs : ['Sheet1'];
}

class SheetsClient {
  private sheets = google.sheets('v4');
  private spreadsheetId: string;
  private tabName: string;

  constructor(spreadsheetId: string, tabName: string) {
    this.spreadsheetId = spreadsheetId;
    this.tabName = tabName;
  }

  static async createFromServiceAccount(tabNameOverride?: string): Promise<SheetsClient> {
    const spreadsheetId = (process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID || '').trim();
    const saPath = (
      process.env.GOOGLE_SA_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      ''
    ).trim();
    const tabName = (tabNameOverride ||
      process.env.GOOGLE_SHEET_TAB ||
      process.env.SHEET_TAB ||
      'Sheet1').trim();

    if (!spreadsheetId) throw new Error('Missing env: GOOGLE_SHEET_ID (or SHEET_ID)');
    if (!saPath) throw new Error('Missing env: GOOGLE_SA_PATH (or GOOGLE_APPLICATION_CREDENTIALS)');

    const abs = path.isAbsolute(saPath) ? saPath : path.join(process.cwd(), saPath);
    if (!fs.existsSync(abs)) throw new Error(`Service account JSON not found at: ${abs}`);

    const saJson = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const auth = new google.auth.JWT({
      email: saJson.client_email,
      key: saJson.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    google.options({ auth });

    return new SheetsClient(spreadsheetId, tabName);
  }

  getTabName() {
    return this.tabName;
  }

  getSpreadsheetId() {
    return this.spreadsheetId;
  }

  /** ✅ מוצא את השורה האחרונה שיש בה Prompt באמת */
  private async getLastPromptRowFromColumnA(): Promise<number> {
    const range = `${this.tabName}!A2:A`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });

    const values = res.data.values || [];
    let lastRow = 1; // only header

    for (let i = 0; i < values.length; i++) {
      const prompt = (values[i]?.[0] || '').toString().trim();
      if (prompt) lastRow = i + 2;
    }

    return lastRow;
  }

  /** Read A2:D{lastPromptRow} => Prompt/Answer/Status/UpdatedAt */
  async readPendingRows(): Promise<SheetRow[]> {
    const lastPromptRow = await this.getLastPromptRowFromColumnA();
    if (lastPromptRow < 2) return [];

    const range = `${this.tabName}!A2:D${lastPromptRow}`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });

    const values = res.data.values || [];
    const out: SheetRow[] = [];

    for (let i = 0; i < values.length; i++) {
      const rowNumber = i + 2;
      const prompt = (values[i]?.[0] || '').toString().trim();
      const answer = (values[i]?.[1] || '').toString();
      const status = (values[i]?.[2] || '').toString().trim().toUpperCase();
      const updatedAt = (values[i]?.[3] || '').toString();

      if (!prompt) continue;

      const isPending = !answer.trim() || status !== 'DONE';
      if (isPending) out.push({ rowNumber, prompt, answer, status, updatedAt });
    }

    return out;
  }

  async writeResult(
    rowNumber: number,
    answer: string,
    status: 'DONE' | 'ERROR',
    updatedAtOverride?: string
  ): Promise<{ updatedAt: string; normalized: string }> {
    const updatedAt = updatedAtOverride || new Date().toISOString();
    const range = `${this.tabName}!B${rowNumber}:D${rowNumber}`;

    const normalized = normalizeAnswerForSheet(answer);

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[normalized, status, updatedAt]] },
    });

    return { updatedAt, normalized };
  }
}

/** -------------------------
 *  Gemini UI helpers (used ONLY if AI_PROVIDER=gemini-ui)
 *  ------------------------- */
async function gotoGemini(page: Page) {
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  const editor = page.locator('div.ql-editor[contenteditable="true"][role="textbox"]');
  await expect(editor).toBeVisible({ timeout: 120000 });
}

async function getComposer(page: Page): Promise<Locator> {
  const editor = page.locator('div.ql-editor[contenteditable="true"][role="textbox"]');
  await expect(editor).toBeVisible({ timeout: 120000 });
  return editor;
}

async function getSendButton(page: Page): Promise<Locator> {
  const byRole = page.getByRole('button', { name: /Send message/i });
  if ((await byRole.count().catch(() => 0)) > 0) return byRole.first();

  const aria = page.locator('button[aria-label*="Send" i]');
  if ((await aria.count().catch(() => 0)) > 0) return aria.last();

  const txt = page.locator('button:has-text("Send")');
  return txt.last();
}

async function clearAndType(page: Page, prompt: string) {
  const editor = await getComposer(page);

  await editor.click({ timeout: 60000 });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');

  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(200);
}

async function waitForGenerationFinish(page: Page) {
  const stopBtn = page.locator('button[aria-label*="Stop" i], button:has-text("Stop")').first();

  const appeared = await stopBtn
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (appeared) {
    await stopBtn.waitFor({ state: 'hidden', timeout: 180000 }).catch(() => {});
  }

  await page.waitForTimeout(1200);
}

async function getLastAssistantText(page: Page): Promise<string> {
  const candidates = page.locator(
    [
      'message-content',
      'div[data-test-id="assistant-response"]',
      'div.markdown',
      'div[class*="markdown"]',
      '.model-response',
    ].join(', ')
  );

  const count = await candidates.count().catch(() => 0);
  if (count === 0) return '';
  const last = candidates.nth(count - 1);
  return ((await last.innerText().catch(() => '')) || '').trim();
}

async function waitForNewAnswer(page: Page, before: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const now = (await getLastAssistantText(page)).trim();
    if (now && now !== before) return now;
    await page.waitForTimeout(800);
  }
  return '';
}

async function askGemini(page: Page, prompt: string): Promise<string> {
  const before = await getLastAssistantText(page).catch(() => '');
  await clearAndType(page, prompt);

  const sendBtn = await getSendButton(page);
  await expect(sendBtn).toBeVisible({ timeout: 60000 });
  await sendBtn.click({ timeout: 60000 });

  await waitForGenerationFinish(page);

  return await waitForNewAnswer(page, before);
}

/** =====================================
 *  AI Provider Selection (ENV) ✅ FIXED TYPES (no "never")
 *  ===================================== */
type AIProvider = 'gemini-ui' | 'openai' | 'anthropic' | 'xai' | 'perplexity' | 'groq';
type AITier = 'best' | 'fast' | 'cheap';

interface BaseAIConfig {
  tier: AITier;
}

interface GeminiUIConfig extends BaseAIConfig {
  provider: 'gemini-ui';
}

interface AnthropicConfig extends BaseAIConfig {
  provider: 'anthropic';
  apiKey: string;
  baseUrl: string;
  model: string;
  anthropicVersion: string;
}

interface OpenAICompatConfig extends BaseAIConfig {
  provider: 'openai' | 'xai' | 'perplexity' | 'groq';
  apiKey: string;
  baseUrl: string;
  model: string;
}

type AIConfig = GeminiUIConfig | AnthropicConfig | OpenAICompatConfig;

function readAIProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER || 'gemini-ui').trim().toLowerCase();
  const ok: AIProvider[] = ['gemini-ui', 'openai', 'anthropic', 'xai', 'perplexity', 'groq'];
  if (!ok.includes(raw as AIProvider)) {
    throw new Error(`Invalid AI_PROVIDER="${raw}". Use: ${ok.join(', ')}`);
  }
  return raw as AIProvider;
}

function readAITier(): AITier {
  const raw = (process.env.AI_TIER || 'best').trim().toLowerCase();
  if (raw === 'fast' || raw === 'cheap') return raw as AITier;
  return 'best';
}

function defaultModel(provider: AIProvider, tier: AITier): string {
  // You can override manually with AI_MODEL in ENV.
  if (provider === 'openai') return tier === 'cheap' ? 'gpt-5-nano' : tier === 'fast' ? 'gpt-5-mini' : 'gpt-5.2';
  if (provider === 'anthropic') return tier === 'cheap' || tier === 'fast' ? 'claude-haiku-4-5' : 'claude-sonnet-4-5';
  if (provider === 'xai') return 'grok-4-latest';
  if (provider === 'perplexity') return tier === 'best' ? 'sonar-pro' : 'sonar';
  if (provider === 'groq') return 'llama-3.1-8b-instant';
  return ''; // gemini-ui
}

function mustGetEnv(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function resolveAIConfig(): AIConfig {
  const provider = readAIProvider();
  const tier = readAITier();

  // ✅ Gemini UI: no key/model needed
  if (provider === 'gemini-ui') {
    return { provider: 'gemini-ui', tier };
  }

  // ✅ allow manual override model if user wants
  const model = (process.env.AI_MODEL || '').trim() || defaultModel(provider, tier);

  if (provider === 'anthropic') {
    return {
      provider: 'anthropic',
      tier,
      model,
      baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
      apiKey: mustGetEnv('ANTHROPIC_API_KEY'),
      anthropicVersion: (process.env.ANTHROPIC_VERSION || '2023-06-01').trim(),
    };
  }

  // ✅ OpenAI-compatible providers
  if (provider === 'openai') {
    return {
      provider: 'openai',
      tier,
      model,
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: mustGetEnv('OPENAI_API_KEY'),
    };
  }

  if (provider === 'xai') {
    return {
      provider: 'xai',
      tier,
      model,
      baseUrl: (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, ''),
      apiKey: mustGetEnv('XAI_API_KEY'),
    };
  }

  if (provider === 'perplexity') {
    return {
      provider: 'perplexity',
      tier,
      model,
      baseUrl: (process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai').replace(/\/+$/, ''),
      apiKey: mustGetEnv('PERPLEXITY_API_KEY'),
    };
  }

  // groq
  return {
    provider: 'groq',
    tier,
    model,
    baseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    apiKey: mustGetEnv('GROQ_API_KEY'),
  };
}

/** =====================================
 *  AI API callers
 *  ===================================== */
function summarizeResponseError(status: number, bodyText: string) {
  return `HTTP ${status}: ${(bodyText || '').slice(0, 500)}`;
}

async function askOpenAICompatible(
  request: APIRequestContext,
  cfg: OpenAICompatConfig,
  prompt: string
): Promise<string> {
  const url = `${cfg.baseUrl}/chat/completions`;

  const resp = await request.post(url, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    data: {
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    },
    timeout: 180000,
  });

  if (!resp.ok()) {
    const txt = await resp.text().catch(() => '');
    throw new Error(summarizeResponseError(resp.status(), txt));
  }

  const json: any = await resp.json().catch(() => ({}));
  return (json?.choices?.[0]?.message?.content || '').toString().trim();
}

async function askAnthropic(
  request: APIRequestContext,
  cfg: AnthropicConfig,
  prompt: string
): Promise<string> {
  const url = `${cfg.baseUrl}/v1/messages`;

  const resp = await request.post(url, {
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': cfg.anthropicVersion,
      'content-type': 'application/json',
    },
    data: {
      model: cfg.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    },
    timeout: 180000,
  });

  if (!resp.ok()) {
    const txt = await resp.text().catch(() => '');
    throw new Error(summarizeResponseError(resp.status(), txt));
  }

  const json: any = await resp.json().catch(() => ({}));
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .map((b: any) => (b?.type === 'text' ? b?.text : ''))
    .filter(Boolean)
    .join('\n');

  return (text || '').toString().trim();
}

async function askAI(
  page: Page,
  request: APIRequestContext,
  cfg: AIConfig,
  prompt: string
): Promise<string> {
  if (cfg.provider === 'gemini-ui') {
    return await askGemini(page, prompt);
  }

  if (cfg.provider === 'anthropic') {
    return await askAnthropic(request, cfg, prompt);
  }

  // openai / xai / perplexity / groq
  return await askOpenAICompatible(request, cfg, prompt);
}

/** -------------------------
 *  Report writing (NO DUPLICATE ANSWERS)
 *  ------------------------- */
type ReportEntry = {
  tab: string;
  row: number;
  prompt: string;
  status: 'DONE' | 'ERROR';
  updatedAt: string;
  answer: string; // ✅ single: what was written to sheet (normalized)
};

function buildReportMarkdown(meta: {
  spreadsheetId: string;
  tabs: string[];
  startedAt: string;
  finishedAt: string;
  totalProcessed: number;
  done: number;
  errors: number;
  entries: ReportEntry[];
  aiProvider: string;
  aiTier: string;
  aiModel: string;
}) {
  const lines: string[] = [];

  lines.push(`# AI ⇄ Google Sheets Report`);
  lines.push(`- Started: ${meta.startedAt}`);
  lines.push(`- Finished: ${meta.finishedAt}`);
  lines.push(`- SpreadsheetId: ${meta.spreadsheetId}`);
  lines.push(`- Tabs: ${meta.tabs.join(', ')}`);
  lines.push(`- AI: ${meta.aiProvider} | tier=${meta.aiTier} | model=${meta.aiModel || 'UI default'}`);
  lines.push(`- AnswerMode: ${ANSWER_MODE}${ANSWER_MODE === 'truncate' ? ` (max=${TRUNCATE_MAX})` : ''}`);
  lines.push(`- Processed: ${meta.totalProcessed} | DONE: ${meta.done} | ERROR: ${meta.errors}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const byTab: Record<string, ReportEntry[]> = {};
  for (const e of meta.entries) {
    byTab[e.tab] = byTab[e.tab] || [];
    byTab[e.tab].push(e);
  }

  for (const tab of Object.keys(byTab)) {
    lines.push(`## Tab: ${tab}`);
    lines.push('');

    for (const e of byTab[tab]) {
      lines.push(`### Row ${e.row} — ${e.status}`);
      lines.push(`**UpdatedAt:** ${e.updatedAt}`);
      lines.push('');
      lines.push(`**Prompt:**`);
      lines.push('');
      lines.push('```text');
      lines.push(e.prompt);
      lines.push('```');
      lines.push('');
      lines.push(`**Answer:**`);
      lines.push('');
      lines.push('```text');
      lines.push((e.answer || '').trim());
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** -------------------------
 *  The test
 *  ------------------------- */
test('AI ←→ Google Sheet (Dynamic Prompts)', async ({ page, request }) => {
  const startedAt = new Date().toISOString();

  const ai = resolveAIConfig();
  console.log('==============================');
  console.log(`🤖 AI_PROVIDER: ${ai.provider} | AI_TIER: ${ai.tier} | MODEL: ${'model' in ai ? ai.model : 'UI default'}`);
  console.log('==============================');

  const tabNames = getSheetTabsFromEnv();

  const clients: SheetsClient[] = [];
  for (const tab of tabNames) clients.push(await SheetsClient.createFromServiceAccount(tab));

  const spreadsheetId =
    clients[0]?.getSpreadsheetId() || (process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID || '');

  const work: { client: SheetsClient; rows: SheetRow[] }[] = [];
  let totalPending = 0;

  for (const client of clients) {
    const pending = await client.readPendingRows();
    totalPending += pending.length;

    console.log('==============================');
    console.log(`TAB: ${client.getTabName()} | Pending prompts found: ${pending.length}`);
    console.log(pending.map(p => ({ row: p.rowNumber, prompt: p.prompt })));
    console.log('==============================');

    if (pending.length) work.push({ client, rows: pending });
  }

  if (totalPending === 0) {
    console.log('No pending rows in any tab. Nothing to do.');
    return;
  }

  const reportEntries: ReportEntry[] = [];
  let doneCount = 0;
  let errCount = 0;

  // ✅ Only if using Gemini UI
  if (ai.provider === 'gemini-ui') {
    await gotoGemini(page);
  }

  try {
    for (const item of work) {
      console.log(`\n======= PROCESSING TAB: ${item.client.getTabName()} =======`);

      for (const row of item.rows) {
        console.log(`\n--- Row ${row.rowNumber} ---`);
        console.log(`Prompt: ${row.prompt}`);

        const tab = item.client.getTabName();

        try {
          const answerRaw = await askAI(page, request, ai, row.prompt);
          if (!answerRaw) throw new Error('No answer extracted (empty).');

          const res = await item.client.writeResult(row.rowNumber, answerRaw, 'DONE');
          doneCount++;

          reportEntries.push({
            tab,
            row: row.rowNumber,
            prompt: row.prompt,
            status: 'DONE',
            updatedAt: res.updatedAt,
            answer: res.normalized, // ✅ single answer
          });

          console.log(`✅ DONE: wrote answer to row ${row.rowNumber}`);
        } catch (e: any) {
          const msg = `[ERROR] ${e?.message || e}`;
          const res = await item.client.writeResult(row.rowNumber, msg, 'ERROR');
          errCount++;

          reportEntries.push({
            tab,
            row: row.rowNumber,
            prompt: row.prompt,
            status: 'ERROR',
            updatedAt: res.updatedAt,
            answer: res.normalized,
          });

          console.log(`❌ ERROR: wrote error to row ${row.rowNumber}`);
        }

       await new Promise(r => setTimeout(r, 1200));
      }
    }
  } finally {
    // ✅ Always write report even if something breaks mid-run
    const finishedAt = new Date().toISOString();

    const reportMd = buildReportMarkdown({
      spreadsheetId: (spreadsheetId || '').toString(),
      tabs: tabNames,
      startedAt,
      finishedAt,
      totalProcessed: reportEntries.length,
      done: doneCount,
      errors: errCount,
      entries: reportEntries,
      aiProvider: ai.provider,
      aiTier: ai.tier,
      aiModel: 'model' in ai ? ai.model : '',
    });

    const fileName = `AIReport_${safeTimestampForWindows(new Date())}.md`;
    const outPath = path.join(REPORT_DIR, fileName);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(outPath, reportMd, 'utf8');

    console.log('==============================');
    console.log(`🧾 REPORT saved: ${outPath}`);
    console.log('==============================');
  }
});
