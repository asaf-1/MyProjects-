import { test, expect, Page, Locator, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * LINK 2 — gov.il collectors/policies (Planning Administration)
 * - Full crawl with pagination
 * - Detect collection pages and follow internal links to depth=1
 * - Download PDFs with persistent de-dup by URL (CSV)
 * - If same base filename exists but content is different => save as " (2).pdf", "(3).pdf", ...
 * - Save page HTML + TEXT for every visited page
 */

// ===================== USER CONFIG =====================
const MAIN_URL = 'https://www.gov.il/he/collectors/policies?officeId=2574c957-2109-4270-9586-62ca2d37857e';
const DOWNLOAD_DIR = 'C:/Users/Administrator/OneDrive/Desktop/Link 2';
const METADATA_CSV = path.join(DOWNLOAD_DIR, 'metadata_link2.csv');

// Crawl behavior
const MAX_PAGES = 999;          // crawl until no next page
const MAX_DEPTH = 1;            // follow /he/pages/ links to depth 1 from a collection
const MIN_PDFS_FOR_COLLECTION = 3;
const MIN_INTERNAL_LINKS_FOR_COLLECTION = 6;

// Network & pacing
const NAV_TIMEOUT = 45_000;
const REQUEST_TIMEOUT = 120_000;
const SLOW_PAUSE_MS = 350;

// Page content capture
const SAVE_PAGE_HTML = true;
const SAVE_PAGE_TEXT = true;
const PAGE_HTML_DIR = path.join(DOWNLOAD_DIR, 'pages_html');
const PAGE_TEXT_DIR = path.join(DOWNLOAD_DIR, 'pages_text');

// Playwright defaults
test.use({
  headless: true,
  contextOptions: { acceptDownloads: true },
  navigationTimeout: NAV_TIMEOUT,
});
test.setTimeout(90 * 60 * 1000); // עד 90 דק' קובצים כבדים

// ===================== Utils =====================
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
}

function sanitizeFileName(raw: string, fallback = 'document') {
  const base = (raw || fallback)
    .replace(/[\u0000-\u001F<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = 180;
  return (base.length > max ? base.slice(0, max) : base) || fallback;
}

function toAbsUrl(href: string) {
  if (!href) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href, 'https://www.gov.il').toString();
}

function parseDateLike(s?: string) {
  if (!s) return '';
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) {
    const [_, d, mo, y] = m as any;
    return `${y}-${mo}-${d}`;
  }
  return s;
}

async function uniquePath(p: string) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

// ===================== CSV (persisted de-dup by URL) =====================
const SEEN_URLS = new Set<string>();
const SEEN_FILES = new Set<string>();

function parseCsvLine(line: string): string[] {
  const re = /"((?:[^"]|"")*)"(?:,|$)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1].replace(/""/g, '"'));
  return out;
}

async function loadSeenFromCsv(csvPath: string) {
  if (!fs.existsSync(csvPath)) return;
  const lines = (await fsp.readFile(csvPath, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return;
  const header = parseCsvLine(lines[0]);
  const idxUrl = header.indexOf('pdf_url');
  const idxName = header.indexOf('file_name');
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const url = cols[idxUrl];
    if (url) SEEN_URLS.add(url);
    if (idxName !== -1 && cols[idxName]) SEEN_FILES.add(cols[idxName]);
  }
}

async function appendCsvRow(row: Record<string, any>) {
  const headers = [
    'file_name','absolute_path','pdf_url','title','type','number','topic','audience','published_at','updated_at','parent_page_url','source'
  ];
  const exists = fs.existsSync(METADATA_CSV);
  const line = headers.map(h => {
    let val = row[h];
    if (Array.isArray(val)) val = val.join('; ');
    const str = (val ?? '').toString().replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
    return `"${str}"`;
  }).join(',') + '\n';
  if (!exists) {
    await fsp.writeFile(METADATA_CSV, headers.join(',') + '\n' + line, 'utf8');
  } else {
    await fsp.appendFile(METADATA_CSV, line, 'utf8');
  }
}

// ===================== Page helpers =====================
async function dismissBanners(page: Page) {
  const candidates = [
    'button:has-text("סגור")',
    'button:has-text("קבל")',
    'button:has-text("אני מסכים")',
    'button[aria-label="סגור"]',
    'text=קבל הכל',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    if (await loc.first().isVisible().catch(() => false)) {
      try { await loc.first().click({ timeout: 1500 }); } catch { /* ignore */ }
    }
  }
}

async function getLabelValueByText(page: Page, labelText: string): Promise<string> {
  const xpathExact = `xpath=//*[normalize-space(text())='${labelText}']/following-sibling::*[1]`;
  const exactEl = page.locator(xpathExact).first();
  if (await exactEl.count()) {
    const t = (await exactEl.innerText().catch(() => '')).trim();
    if (t) return t;
  }
  const xpathContains = `xpath=//*[contains(normalize-space(.), '${labelText}')]/following-sibling::*[1]`;
  const containsEl = page.locator(xpathContains).first();
  if (await containsEl.count()) {
    const t = (await containsEl.innerText().catch(() => '')).trim();
    if (t) return t;
  }
  const metaBlock = page.locator('[id*="metaData"], .headMetaData_md_kv_pair__yd2To')
    .filter({ hasText: labelText })
    .locator('xpath=.//*[self::span or self::div][last()]');
  if (await metaBlock.count()) {
    const t = (await metaBlock.first().innerText().catch(() => '')).trim();
    if (t) return t;
  }
  return '';
}

async function getAudienceList(page: Page): Promise<string[]> {
  const label = ['קהל יעד:', 'קהל יעד'];
  for (const l of label) {
    const parent = page.locator('xpath=//*[normalize-space(text())="' + l + '"]/..');
    if (await parent.count()) {
      const links = parent.locator('a');
      const out: string[] = [];
      const n = await links.count();
      for (let i = 0; i < n; i++) {
        const t = (await links.nth(i).innerText().catch(() => '')).trim();
        if (t) out.push(t);
      }
      if (out.length) return out;
      const spans = parent.locator('span');
      const m = await spans.count();
      for (let i = 0; i < m; i++) {
        const t = (await spans.nth(i).innerText().catch(() => '')).trim();
        if (t && !/קהל יעד/.test(t)) out.push(t);
      }
      if (out.length) return out;
    }
  }
  return [];
}

async function extractMetaFromCard(card: Locator) {
  async function byIdPart(part: string) {
    const valNode = card.locator(`[id*="${part}_val"]`).first();
    if (await valNode.count()) return (await valNode.innerText()).trim();
    return '';
  }
  async function listByIdPart(part: string) {
    const nodes = card.locator(`[id*="${part}_val"]`);
    const out: string[] = [];
    const n = await nodes.count();
    for (let i = 0; i < n; i++) out.push((await nodes.nth(i).innerText()).trim());
    return out.filter(Boolean);
  }

  const title = (await card.locator('h3').first().innerText().catch(() => '')).trim();
  const hrefRel = await card.locator('a[href^="/he/pages/"]').first().getAttribute('href');
  const href = hrefRel ? toAbsUrl(hrefRel) : '';
  const type = await byIdPart('promotedData_0');
  const number = await byIdPart('promotedData_2');
  const topics = await listByIdPart('topics');
  const audience = await listByIdPart('targetAudiences');
  const published = parseDateLike(await byIdPart('publishDate'));
  const updated = parseDateLike(await byIdPart('updateDate'));

  return { title, href, type, number, topic: topics.join('; '), audience, published_at: published, updated_at: updated };
}

async function extractMetaFromDetailPage(page: Page, fallback: any) {
  const title = (await page.locator('main h1, #content h1, h1').first().innerText().catch(() => fallback?.title || '')).trim();
  const type = (await getLabelValueByText(page, 'סוג:')) || fallback?.type || '';
  const number = (await getLabelValueByText(page, 'מספר:')) || fallback?.number || '';
  const topic = (await getLabelValueByText(page, 'נושא:')) || fallback?.topic || '';
  let audience = await getAudienceList(page);
  if (!audience?.length && fallback?.audience?.length) audience = fallback.audience;
  const published_at = parseDateLike((await getLabelValueByText(page, 'תאריך פרסום:')) || fallback?.published_at || '');
  const updated_at = parseDateLike((await getLabelValueByText(page, 'תאריך עדכון:')) || fallback?.updated_at || '');
  return { title, type, number, topic, audience, published_at, updated_at };
}

async function isCollectionPage(page: Page): Promise<boolean> {
  const hasDownloadSection = await page.locator('text=קבצים להורדה').first().isVisible().catch(() => false);
  const pdfLinksCount = await page.locator('main a[href$=".pdf"], main a[href*=".pdf?"], #content a[href$=".pdf"], #content a[href*=".pdf?"]').count();
  const internalLinksCount = await page.locator('main a[href^="/he/pages/"], #content a[href^="/he/pages/"]').count();

  if (!hasDownloadSection && pdfLinksCount >= MIN_PDFS_FOR_COLLECTION) return true;
  if (!hasDownloadSection && pdfLinksCount === 0 && internalLinksCount >= MIN_INTERNAL_LINKS_FOR_COLLECTION) return true;

  const headline = (await page.locator('main h1, #content h1').first().innerText().catch(() => '')).trim();
  if (/נהלים|הנחיות|רשימת|אוסף/.test(headline) && (pdfLinksCount + internalLinksCount) >= 5) return true;
  return false;
}

async function collectPdfLinksOnPage(page: Page): Promise<{ url: string, text: string }[]> {
  const anchors = page.locator('main a, #content a');
  const n = await anchors.count();
  const out: { url: string, text: string }[] = [];
  for (let i = 0; i < n; i++) {
    const a = anchors.nth(i);
    const href = await a.getAttribute('href').catch(() => null);
    if (!href) continue;
    const abs = toAbsUrl(href);
    if (!/\.pdf(\?|$)/i.test(abs)) continue;
    const text = (await a.innerText().catch(() => '')).trim();
    out.push({ url: abs, text });
  }
  const seen = new Set<string>();
  return out.filter(x => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

async function collectInternalLinks(page: Page): Promise<string[]> {
  const anchors = page.locator('main a[href^="/he/pages/"], #content a[href^="/he/pages/"]');
  const n = await anchors.count();
  const urls: string[] = [];
  for (let i = 0; i < n; i++) {
    const href = await anchors.nth(i).getAttribute('href').catch(() => null);
    if (!href) continue;
    urls.push(toAbsUrl(href));
  }
  return Array.from(new Set(urls));
}

// ===================== Save page HTML/TEXT =====================
function slugFromUrl(u: string) {
  try {
    const url = new URL(u);
    const last = url.pathname.split('/').filter(Boolean).pop() || 'page';
    return decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '');
  } catch {
    return 'page';
  }
}

function stableBaseFromMeta(meta: any, pageUrl: string) {
  const parts = [meta?.number, meta?.title].filter(Boolean);
  const base = parts.length ? parts.join(' __ ') : slugFromUrl(pageUrl);
  return sanitizeFileName(base, 'page');
}

async function savePageContent(page: Page, meta: any, pageUrl: string) {
  await ensureDir(PAGE_HTML_DIR);
  await ensureDir(PAGE_TEXT_DIR);

  const base = stableBaseFromMeta(meta, pageUrl);
  const htmlPath = path.join(PAGE_HTML_DIR, base + '.html');
  const txtPath  = path.join(PAGE_TEXT_DIR,  base + '.txt');

  const htmlExists = fs.existsSync(htmlPath);
  const txtExists  = fs.existsSync(txtPath);
  if (htmlExists && txtExists) {
    console.log(`SKIP (content exists): ${path.basename(htmlPath)} / ${path.basename(txtPath)}`);
    return;
  }

  let hasContainer = true;
  try {
    await page.waitForSelector('main, #content', { timeout: 5_000 });
  } catch {
    hasContainer = false;
  }
  const container = hasContainer ? page.locator('main, #content').first() : page.locator('body');

  if (SAVE_PAGE_HTML && !htmlExists) {
    const innerHtml = await container.innerHTML().catch(() => '');
    const doc = `<!doctype html>
<html lang="he">
<head>
<meta charset="utf-8">
<base href="${pageUrl}">
<meta name="source-url" content="${pageUrl}">
<title>${(meta?.title || base).toString().replace(/</g,'&lt;')}</title>
</head>
<body dir="rtl">
${innerHtml}
</body>
</html>`;
    await fsp.writeFile(htmlPath, doc, 'utf8');
    console.log(`Saved HTML: ${path.basename(htmlPath)}`);
  }

  if (SAVE_PAGE_TEXT && !txtExists) {
    const text = (await container.evaluate(el => (el as HTMLElement).innerText || '')).trim()
      .replace(/\r?\n{3,}/g, '\n\n');
    await fsp.writeFile(txtPath, text, 'utf8');
    console.log(`Saved TEXT: ${path.basename(txtPath)}`);
  }
}

// ===================== Download core =====================
async function savePdfFromUrl(request: APIRequestContext, pdfUrl: string, destFileAbs: string) {
  const resp = await request.get(pdfUrl, { timeout: REQUEST_TIMEOUT });
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()} for ${pdfUrl}`);
  const buffer = await resp.body();
  await fsp.writeFile(destFileAbs, buffer);
}

async function downloadOnePdf(request: APIRequestContext, pdfUrl: string, baseFileName: string, meta: any, parentUrl: string) {
  if (SEEN_URLS.has(pdfUrl)) {
    console.log(`SKIP (by url in CSV): ${pdfUrl}`);
    return; // לא מוסיפים עוד שורה ל-CSV
  }

  await ensureDir(DOWNLOAD_DIR);
  let fileName = sanitizeFileName(baseFileName || path.basename(new URL(pdfUrl).pathname) || 'document');
  if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
  let destAbs = path.join(DOWNLOAD_DIR, fileName);

  if (fs.existsSync(destAbs)) destAbs = await uniquePath(destAbs);

  console.log(`↓ Downloading: ${path.basename(destAbs)}`);
  try {
    await savePdfFromUrl(request, pdfUrl, destAbs);
  } catch (e) {
    console.warn('! PDF download error:', pdfUrl, String(e));
    return;
  }
  await sleep(SLOW_PAUSE_MS);

  SEEN_URLS.add(pdfUrl);
  SEEN_FILES.add(path.basename(destAbs));

  await appendCsvRow({
    file_name: path.basename(destAbs),
    absolute_path: destAbs,
    pdf_url: pdfUrl,
    title: meta.title || '',
    type: meta.type || '',
    number: meta.number || '',
    topic: meta.topic || '',
    audience: meta.audience || [],
    published_at: meta.published_at || '',
    updated_at: meta.updated_at || '',
    parent_page_url: parentUrl,
    source: 'detail-or-collection',
  });
}

// ===================== Crawl logic =====================
async function processDetailOrCollection(page: Page, request: APIRequestContext, href: string, metaSeed: any, depth: number, visited: Set<string>) {
  if (visited.has(href)) return;
  visited.add(href);

  console.log(`\n→ Opening: ${href}`);
  await page.goto(href, { waitUntil: 'networkidle' });
  await dismissBanners(page);

  const meta = await extractMetaFromDetailPage(page, metaSeed);

  // Save page content (HTML + TEXT)
  try {
    await savePageContent(page, meta, page.url());
  } catch (err) {
    console.warn('! Failed saving page content for', page.url(), String(err));
  }

  // Collect direct PDFs
  const pdfsHere = await collectPdfLinksOnPage(page);
  for (const pdf of pdfsHere) {
    const baseNameParts = [meta.number, meta.topic, meta.title].filter(Boolean).join(' __ ');
    const base = baseNameParts || (pdf.text || 'מסמך');
    try {
      await downloadOnePdf(request, pdf.url, base, meta, href);
    } catch (err) {
      console.warn('! Failed PDF download:', pdf.url, String(err));
    }
  }

  // Collection fan-out
  const collection = await isCollectionPage(page);
  if (collection && depth < MAX_DEPTH) {
    console.log('→ Detected COLLECTION page. Exploring internal links (depth ' + (depth + 1) + ').');
    const internal = await collectInternalLinks(page);
    for (const u of internal) {
      try {
        await processDetailOrCollection(page, request, u, meta, depth + 1, visited);
      } catch (err) {
        console.warn('! Failed inner link:', u, String(err));
      }
    }
  } else if (!pdfsHere.length) {
    // Adobe viewer style ?file=...
    const url = page.url();
    const m = url.match(/[?&](file|url|document|doc|pdf|uri)=([^&#]+)/i);
    if (m) {
      const fileParam = decodeURIComponent(m[2]);
      if (/\.pdf(\?|$)/i.test(fileParam)) {
        const base = [meta.number, meta.topic, meta.title].filter(Boolean).join(' __ ') || 'מסמך';
        try {
          await downloadOnePdf(request, fileParam, base, meta, href);
        } catch (err) {
          console.warn('! Failed viewer pdf:', fileParam, String(err));
        }
      }
    }
  }
}

async function processResultsPage(page: Page, request: APIRequestContext, pageIndex: number): Promise<boolean> {
  console.log(`\n===== Results Page ${pageIndex} =====`);
  try {
    await page.waitForSelector('#Results .result-item', { timeout: NAV_TIMEOUT });
  } catch {
    console.log('No results on this page. Skipping.');
    return false;
  }

  const cards = page.locator('#Results .result-item');
  const count = await cards.count();
  if (!count) {
    console.log('No results found on page ' + pageIndex + '.');
    return false;
  }
  console.log(`Found ${count} cards on page ${pageIndex}`);

  const items: Array<{ title: string; href: string; type: string; number: string; topic: string; audience: string[]; published_at: string; updated_at: string; }> = [];
  for (let i = 0; i < count; i++) {
    try {
      const metaFromList = await extractMetaFromCard(cards.nth(i));
      if (metaFromList?.href) items.push(metaFromList);
    } catch (err) {
      console.warn('! Failed extracting card meta at index', i, String(err));
    }
  }
  console.log(`Snapshot ${items.length} items from list page ${pageIndex}`);

  const worker = await page.context().newPage();
  const visited = new Set<string>();

  for (const item of items) {
    try {
      await processDetailOrCollection(worker, request, item.href, item, 0, visited);
    } catch (err) {
      console.warn('! Failed processing item:', item.href, String(err));
    }
    await sleep(SLOW_PAUSE_MS);
  }

  await worker.close();
  return true;
}

async function goToNextPageIfAny(page: Page, currentPage: number): Promise<boolean> {
  const nextBtn = page.locator('#GovilPaging button[title*="עבור לעמוד הבא"]').first();
  const canClick = await nextBtn.isVisible().catch(() => false);
  const disabled = canClick ? await nextBtn.isDisabled().catch(() => true) : true;
  if (canClick && !disabled) {
    console.log('→ Clicking next page…');
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    return true;
  }
  const targetTitle = `עבור לעמוד מספר ${currentPage + 1}`;
  const pageBtn = page.locator(`#GovilPaging button[title="${targetTitle}"]`).first();
  if (await pageBtn.isVisible().catch(() => false)) {
    await pageBtn.click();
    await page.waitForLoadState('networkidle');
    return true;
  }
  return false;
}

// ===================== TEST =====================
test('LINK 2 — full crawl + collections + HTML/TXT capture', async ({ page, request }) => {
  await ensureDir(DOWNLOAD_DIR);
  await ensureDir(PAGE_HTML_DIR);
  await ensureDir(PAGE_TEXT_DIR);
  await loadSeenFromCsv(METADATA_CSV); // דה־דופ לפי URL מהרץ הקודם

  console.log('Downloading to:', DOWNLOAD_DIR);
  console.log('Opening main URL…');
  await page.goto(MAIN_URL, { waitUntil: 'networkidle' });
  await dismissBanners(page);

  let current = 1;
  await processResultsPage(page, request, current);

  while (current < MAX_PAGES) {
    const moved = await goToNextPageIfAny(page, current);
    if (!moved) break;         // אין עוד עמודים — מסיים
    current += 1;
    await processResultsPage(page, request, current);
  }

  console.log('\nDone. Metadata written to:', METADATA_CSV);
});
