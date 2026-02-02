import { test, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * LINK 4 — Angular list (OldVersion=True)
 * - 10 כרטיסיות נראות בכל עמוד
 * - עיבוד מקבילי לכל העמוד (PAGE_CONCURRENCY)
 * - HTML→Markdown לכל פריט ושמירה כ-.md
 * - CSV + RESUME: ממשיך מדויק מתוך ה-CSV (ללא קובצי מצב חיצוניים)
 */

// ===================== USER CONFIG =====================
const MAIN_URL =
  'https://www.gov.il/he/departments/policies?OldVersion=True&limit=10&OfficeId=e744bba9-d17e-429f-abc3-50f7a8a55667&policyType=30280ed5-306f-4f0b-a11d-cacf05d36648';

const DOWNLOAD_DIR = 'C:/Users/asafn/Desktop/Tests-Playwright/tests/SCAPPER PROJECT/uri/Link 4';
const METADATA_CSV = path.join(DOWNLOAD_DIR, 'metadata_link4.csv');
const PAGE_MD_DIR  = path.join(DOWNLOAD_DIR, 'pages_md');

// דילוג ידני על עמוד (כבוי כברירת מחדל)
const SKIP_THIS_PAGE = false;

// רזום ידני (0=לא לכפות; אחרת יגבור על CSV resume)
const FORCE_START_PAGE  = 0;
const FORCE_START_INDEX = 0;

// פאג'ינציה / קצב
const MAX_PAGES = 9_999_999;
const NAV_TIMEOUT = 45_000;
const PER_ITEM_TIMEOUT_MS = 60_000;

// כמה פריטים לעבד במקביל בכל עמוד (10=כל העמוד יחד)
const PAGE_CONCURRENCY = 10;

// ===================== Playwright =====================
test.use({
  headless: true,
  contextOptions: { acceptDownloads: true },
  navigationTimeout: NAV_TIMEOUT,
});
test.setTimeout(0);

// ===================== Utils =====================
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
async function ensureDir(dir: string) { if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true }); }

function sanitizeFileName(raw: string, fallback = 'document') {
  const base = (raw || fallback).replace(/[\u0000-\u001F<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  const max = 180;
  return (base.length > max ? base.slice(0, max) : base) || fallback;
}

function parseDateLike(s?: string) {
  if (!s) return '';
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    let [, d, mo, y] = m as any;
    d = d.toString().padStart(2, '0');
    mo = mo.toString().padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return s;
}

function isoToDDMMYYYY(iso?: string) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  const [, y, mo, d] = m;
  return `${d}.${mo}.${y}`;
}

async function uniquePath(p: string) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms); }),
    ]) as T;
  } finally { clearTimeout(timer); }
}

async function gotoSafe(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await dismissBanners(page);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
}

// ===================== CSV + Resume (ללא קובץ מצב) =====================
const PROCESSED_URLS = new Set<string>();
let CSV_CHAIN: Promise<any> = Promise.resolve(); // תור כתיבה ל-CSV

function parseCsvLine(line: string): string[] {
  const re = /"((?:[^"]|"")*)"(?:,|$)/g; const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1].replace(/""/g, '"')); return out;
}

async function loadSeenFromCsv(csvPath: string) {
  if (!fs.existsSync(csvPath)) return;
  const lines = (await fsp.readFile(csvPath, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return;
  const header = parseCsvLine(lines[0]);
  const idxParentUrl = header.indexOf('parent_page_url');
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const url = cols[idxParentUrl];
    if (url) PROCESSED_URLS.add(url);
  }
}

async function inferResumeFromCsv(): Promise<{ page: number; nextIndex: number } | null> {
  if (!fs.existsSync(METADATA_CSV)) return null;
  const lines = (await fsp.readFile(METADATA_CSV, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]);
  const idxAbs   = header.indexOf('absolute_path');
  const idxPage  = header.indexOf('list_page_index');
  const idxPos   = header.indexOf('list_position');

  let best: { page: number; pos: number } | null = null;

  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = parseCsvLine(lines[i]);
    const abs = cols[idxAbs] || '';
    if (!abs) continue;
    if (!abs.replace(/\\/g, '/').includes(PAGE_MD_DIR.replace(/\\/g, '/'))) continue;
    const page = parseInt(cols[idxPage] || '', 10) || 1;
    const pos  = parseInt(cols[idxPos]  || '', 10) || 0;
    if (pos === 0) continue;
    best = { page, pos };
    break;
  }
  if (!best) {
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const abs = cols[idxAbs] || '';
      if (!abs.replace(/\\/g, '/').includes(PAGE_MD_DIR.replace(/\\/g, '/'))) continue;
      const page = parseInt(cols[idxPage] || '', 10) || 1;
      const pos  = parseInt(cols[idxPos]  || '', 10) || 0;
      if (!best || page > best.page || (page === best.page && pos > best.pos)) best = { page, pos };
    }
  }
  if (!best) return null;
  return { page: best.page, nextIndex: best.pos + 1 };
}

async function appendCsvRow(row: Record<string, any>) {
  const headers = [
    'file_name','absolute_path','pdf_url','title','type','number','topic','audience',
    'published_at','updated_at','published_raw','updated_raw',
    'parent_page_url','decision_line','source','list_page_index','list_position','processed_at'
  ];
  const exists = fs.existsSync(METADATA_CSV);
  const line = headers.map(h => {
    let val = row[h]; if (Array.isArray(val)) val = val.join('; ');
    const str = (val ?? '').toString().replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
    return `"${str}"`;
  }).join(',') + '\n';
  if (!exists) await fsp.writeFile(METADATA_CSV, headers.join(',') + '\n' + line, 'utf8');
  else await fsp.appendFile(METADATA_CSV, line, 'utf8');
}

// כתיבה סדרתית ל-CSV כדי למנוע התנגשות מקבילה
function appendCsvRowQueued(row: Record<string, any>) {
  CSV_CHAIN = CSV_CHAIN.then(() => appendCsvRow(row)).catch(() => {});
  return CSV_CHAIN;
}

// ===================== Page helpers =====================
async function dismissBanners(page: Page) {
  const candidates = [
    'button:has-text("סגור")','button:has-text("קבל")','button:has-text("אני מסכים")',
    'button[aria-label="סגור"]','text=קבל הכל',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    if (await loc.first().isVisible().catch(() => false)) { try { await loc.first().click({ timeout: 1500 }); } catch {} }
  }
}

async function waitForResults(page: Page) {
  await page.waitForFunction(() => {
    const lis = Array.from(document.querySelectorAll('#content .results ul > li'))
      .filter(el => (el as HTMLElement).offsetParent !== null);
    return lis.length > 0;
  }, { timeout: NAV_TIMEOUT });
}

type ListItemSeed = { href: string; title: string; decisionText: string };

async function collectVisibleListItems(page: Page): Promise<ListItemSeed[]> {
  const items = await page.locator('#content .results ul > li').evaluateAll((nodes) => {
    return (nodes as HTMLElement[])
      .filter(li => li.offsetParent !== null)
      .map(li => {
        const a = li.querySelector('h2 a') as HTMLAnchorElement | null;
        const href = a?.getAttribute('href') || '';
        const title = (a?.textContent || '').trim();
        const decisionText = ((li.querySelector('div.txt.dark-gray-txt') as HTMLElement | null)?.innerText || '').trim();
        return { href, title, decisionText };
      })
      .filter(x => x.href);
  });
  const seen = new Set<string>(); const uniq: ListItemSeed[] = [];
  for (const it of items) if (!seen.has(it.href)) { seen.add(it.href); uniq.push(it); }
  return uniq;
}

function parseDecisionFromText(decisionText: string) {
  let number = ''; let published_raw = '';
  const m = decisionText.match(/החלטה\s+מספר\s+(\d+).*?מיום\s+(\d{1,2}\.\d{1,2}\.\d{4})/);
  if (m) { number = m[1]; published_raw = m[2]; }
  return { number, published_raw };
}

async function getLabelValueByText(page: Page, labelText: string): Promise<string> {
  const xpathExact = `xpath=//*[normalize-space(text())='${labelText}']/following-sibling::*[1]`;
  const exactEl = page.locator(xpathExact).first();
  if (await exactEl.count()) { const t = (await exactEl.innerText().catch(() => '')).trim(); if (t) return t; }
  const xpathContains = `xpath=//*[contains(normalize-space(.), '${labelText}')]/following-sibling::*[1]`;
  const containsEl = page.locator(xpathContains).first();
  if (await containsEl.count()) { const t = (await containsEl.innerText().catch(() => '')).trim(); if (t) return t; }
  return '';
}

async function getAudienceList(page: Page): Promise<string[]> {
  const label = ['קהל יעד:', 'קהל יעד'];
  for (const l of label) {
    const parent = page.locator('xpath=//*[normalize-space(text())="' + l + '"]/..');
    if (await parent.count()) {
      const links = parent.locator('a'); const out: string[] = []; const n = await links.count();
      for (let i = 0; i < n; i++) { const t = (await links.nth(i).innerText().catch(() => '')).trim(); if (t) out.push(t); }
      if (out.length) return out;
      const spans = parent.locator('span'); const m = await spans.count();
      for (let i = 0; i < m; i++) { const t = (await spans.nth(i).innerText().catch(() => '')).trim(); if (t && !/קהל יעד/.test(t)) out.push(t); }
      if (out.length) return out;
    }
  }
  return [];
}

async function extractMetaFromDetailPage(page: Page, fallback: any) {
  const title = (await page.locator('main h1, #content h1, h1').first().innerText().catch(() => fallback?.title || '')).trim();
  const type = (await getLabelValueByText(page, 'סוג:')) || fallback?.type || 'החלטות ממשלה';
  let number = (await getLabelValueByText(page, 'מספר:')) || fallback?.number || '';
  if (!number) { const m = title.match(/מספר\s+(\d{2,6})/); if (m) number = m[1]; }
  const topic = (await getLabelValueByText(page, 'נושא:')) || fallback?.topic || '';
  let audience = await getAudienceList(page); if (!audience?.length && fallback?.audience?.length) audience = fallback.audience;

  const published_raw = (await getLabelValueByText(page, 'תאריך פרסום:')) || fallback?.published_raw || '';
  const updated_raw   = (await getLabelValueByText(page, 'תאריך עדכון:')) || fallback?.updated_raw || '';
  const published_at  = parseDateLike(published_raw || fallback?.published_at || '');
  const updated_at    = parseDateLike(updated_raw || fallback?.updated_at || '');
  return { title, type, number, topic, audience, published_at, updated_at, published_raw, updated_raw };
}

function buildDecisionLine(meta: any): string {
  const num = (meta?.number || '').toString().trim();
  const raw = (meta?.published_raw || '').toString().trim();
  const iso = (meta?.published_at || '').toString().trim();
  const dateForLine = raw || isoToDDMMYYYY(iso);
  if (num && dateForLine) return `החלטה מספר ${num} של הממשלה מיום ${dateForLine}`;
  if (num) return `החלטה מספר ${num} של הממשלה`;
  return '';
}

async function extractCoreHtml(page: Page): Promise<string> {
  const selectors = [
    '#content article', 'main article', '#content .article-body', '#content .content-area',
    'main #content', 'main', '#content', 'body'
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      const html = (await loc.innerHTML().catch(() => '')).trim();
      if (html) return html;
    }
  }
  return '';
}

async function savePageAsMarkdown(page: Page, meta: any, pageUrl: string): Promise<{ mdPath: string; decision_line: string }> {
  await ensureDir(PAGE_MD_DIR);
  const base = sanitizeFileName([meta?.number, meta?.title].filter(Boolean).join(' __ ') || 'page');
  const mdPath0 = path.join(PAGE_MD_DIR, base + '.md');
  const mdPath = fs.existsSync(mdPath0) ? await uniquePath(mdPath0) : mdPath0;

  const coreHtml = await extractCoreHtml(page);
  const converted = NodeHtmlMarkdown.translate(coreHtml);

  const decision_line = buildDecisionLine(meta);
  const header = `# ${meta?.title || base}

${decision_line ? `> ${decision_line}\n\n` : ''}**נושא ההחלטה:** ${meta?.topic || ''}

---

**סוג:** ${meta?.type || ''}  
**מספר:** ${meta?.number || ''}  
**קהל יעד:** ${(meta?.audience || []).join(', ')}  
**תאריך פרסום:** ${meta?.published_raw || isoToDDMMYYYY(meta?.published_at) || ''}  
**תאריך עדכון:** ${meta?.updated_raw || isoToDDMMYYYY(meta?.updated_at) || ''}  
**עמוד מקור:** ${pageUrl}

---

`;

  await fsp.writeFile(mdPath, header + converted + '\n', 'utf8');
  console.log(`Saved MD: ${path.basename(mdPath)}`);
  return { mdPath, decision_line };
}

// ---------- pagination ----------
async function currentPageNumber(page: Page): Promise<number> {
  const txt = (await page.locator('.paging-numbers .pages.currPage span').first().textContent().catch(() => ''))?.trim() || '1';
  return parseInt(txt, 10) || 1;
}
async function getVisibleItemHrefs(page: Page): Promise<string[]> {
  return await page.locator('#content .results ul > li h2 a').evaluateAll((els) =>
    (els as HTMLAnchorElement[]).filter(a => (a as HTMLElement).offsetParent !== null)
      .map(a => a.getAttribute('href') || '').filter(Boolean));
}

async function jumpToPageIfVisible(page: Page, target: number): Promise<boolean> {
  const link = page.locator(`.paging-numbers a[ng-click^="gotoPage("]:has-text("${target}")`).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    await waitForResults(page);
    return true;
  }
  return false;
}

async function goToNextPage(page: Page): Promise<boolean> {
  const prevHrefs = await getVisibleItemHrefs(page);
  const nextArrow = page.locator('a[ng-click*="gotoPage(DataItems.current_page + 1)"]');
  if (await nextArrow.isVisible().catch(() => false)) {
    await nextArrow.click();
  } else {
    const nextNum = (await currentPageNumber(page)) + 1;
    const link = page.locator(`.paging-numbers a[ng-click^="gotoPage("]:has-text("${nextNum}")`).first();
    if (await link.isVisible().catch(() => false)) await link.click();
    else return false;
  }
  await page.waitForFunction((before: string[]) => {
    const now = Array.from(document.querySelectorAll('#content .results ul > li h2 a'))
      .filter(a => (a as HTMLElement).offsetParent !== null)
      .map(a => (a as HTMLAnchorElement).getAttribute('href') || '')
      .filter(Boolean);
    return now.length > 0 && (now[0] !== before[0] || now[now.length - 1] !== before[before.length - 1] || now.length !== before.length);
  }, prevHrefs, { timeout: NAV_TIMEOUT }).catch(() => {});
  await waitForResults(page);
  return true;
}

async function goToPageNumber(page: Page, target: number) {
  if (target <= 1) return;
  const tryJump = await jumpToPageIfVisible(page, target);
  if (tryJump) return;
  let curr = await currentPageNumber(page);
  while (curr < target) {
    const jumped = await jumpToPageIfVisible(page, target);
    if (jumped) break;
    const moved = await goToNextPage(page);
    if (!moved) break;
    curr = await currentPageNumber(page);
  }
}

// ===================== Concurrency helper =====================
async function runPool<T>(factories: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  const runners = new Array(Math.min(concurrency, factories.length)).fill(0).map(async () => {
    while (i < factories.length) {
      const myIdx = i++;
      try {
        results[myIdx] = await factories[myIdx]();
      } catch (e) {
        // נרשום undefined/void — הכשל כבר הודפס מלמטה
        results[myIdx] = undefined as unknown as T;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ===================== Item processing =====================
async function processOneItem(
  context: BrowserContext,
  hrefAbs: string,
  listSeed: ListItemSeed,
  pageIndex: number,
  position: number
) {
  const basicFromList = (() => {
    const { number, published_raw } = parseDecisionFromText(listSeed.decisionText || '');
    return {
      title: listSeed.title || '',
      type: 'החלטות ממשלה',
      number,
      topic: '',
      audience: [] as string[],
      published_at: parseDateLike(published_raw),
      updated_at: '',
      published_raw,
      updated_raw: '',
    };
  })();

  await withTimeout((async () => {
    const p = await context.newPage();
    try {
      await gotoSafe(p, hrefAbs);
      const meta = await extractMetaFromDetailPage(p, basicFromList);
      const saved = await savePageAsMarkdown(p, meta, p.url());

      await appendCsvRowQueued({
        file_name: path.basename(saved.mdPath),
        absolute_path: saved.mdPath,
        pdf_url: '',
        title: meta.title || '',
        type: meta.type || '',
        number: meta.number || '',
        topic: meta.topic || '',
        audience: meta.audience || [],
        published_at: meta.published_at || '',
        updated_at: meta.updated_at || '',
        published_raw: meta.published_raw || '',
        updated_raw: meta.updated_raw || '',
        parent_page_url: hrefAbs,
        decision_line: saved.decision_line || '',
        source: 'detail-page',
        list_page_index: pageIndex,
        list_position: position,
        processed_at: new Date().toISOString(),
      });

      PROCESSED_URLS.add(hrefAbs);
    } finally { await p.close().catch(() => {}); }
  })(), PER_ITEM_TIMEOUT_MS, `detail ${hrefAbs}`);
}

// ===================== Results page =====================
async function processResultsPage(
  page: Page,
  context: BrowserContext,
  pageIndex: number,
  startFromIndex: number
): Promise<{ ok: boolean; processedAny: boolean; lastIndex: number }> {

  console.log(`\n===== Results Page ${pageIndex} =====`);
  await waitForResults(page);
  if (SKIP_THIS_PAGE) {
    console.log('SKIP_THIS_PAGE=true → דילוג על עיבוד הרשומות בעמוד זה.');
    return { ok: true, processedAny: false, lastIndex: 0 };
  }

  const list = await collectVisibleListItems(page);
  const count = list.length;
  if (!count) { console.log('0 visible results on page ' + pageIndex); return { ok: false, processedAny: false, lastIndex: 0 }; }
  console.log(`Found ${count} visible results on page ${pageIndex}`);

  const start = Math.min(Math.max(startFromIndex, 1), count);
  let processedAny = false;

  // נכין מפעלים למשימות הפריטים (כדי לרוץ במקביל)
  const factories: Array<() => Promise<void>> = [];
  for (let i = start - 1; i < count; i++) {
    const seed = list[i];
    const pos = i + 1;
    const hrefAbs = new URL(seed.href, 'https://www.gov.il').toString();

    // דילוג אם כבר קיים ב-CSV (רזום)
    if (PROCESSED_URLS.has(hrefAbs)) {
      console.log(`[${pos}/${count}] SKIP (CSV resume): ${hrefAbs}`);
      continue;
    }

    console.log(`[${pos}/${count}] → ${hrefAbs}`);
    factories.push(async () => {
      try {
        await processOneItem(context, hrefAbs, seed, pageIndex, pos);
        processedAny ||= true;
      } catch (err) {
        console.warn('! Item failed:', hrefAbs, String(err));
      }
    });
  }

  // הרצה במקביל לכל העמוד
  await runPool(factories, PAGE_CONCURRENCY);
  // נוודא שכל כתיבות ה-CSV הסתיימו לפני מעבר עמוד
  await CSV_CHAIN;

  return { ok: true, processedAny, lastIndex: count };
}

// ===================== TEST =====================
test('LINK 4 — Angular crawl: HTML→MD + CSV RESUME + PAGE BULK (10 במקביל)', async ({ page, context }) => {
  await ensureDir(DOWNLOAD_DIR);
  await ensureDir(PAGE_MD_DIR);
  await loadSeenFromCsv(METADATA_CSV);

  let resume = (FORCE_START_PAGE > 0 && FORCE_START_INDEX > 0)
    ? { page: FORCE_START_PAGE, nextIndex: FORCE_START_INDEX }
    : await inferResumeFromCsv();

  const targetPage = resume?.page ?? 1;
  const startIndex = resume?.nextIndex ?? 1;

  console.log('Saving to:', DOWNLOAD_DIR);
  console.log('Opening main URL…');
  await gotoSafe(page, MAIN_URL);
  await waitForResults(page);

  if (targetPage > 1 || startIndex > 1) {
    console.log(`CSV resume → going to page ${targetPage}, starting index ${startIndex}`);
    await goToPageNumber(page, targetPage);
  }

  let current = await currentPageNumber(page);
  while (true) {
    const startForThisPage = (current === targetPage) ? startIndex : 1;

    const { ok } = await processResultsPage(page, context, current, startForThisPage);
    if (!ok) break;

    const moved = await goToNextPage(page);
    if (!moved) break;

    current += 1;
    if (current > MAX_PAGES) break;
  }

  console.log('\nDone. Metadata written to:', METADATA_CSV);
});


//active commands
//npx playwright test "link4\.scrape\.spec\.ts$"
//npx playwright test "link1\.scrape\.spec\.ts$"