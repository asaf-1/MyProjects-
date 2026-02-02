import "dotenv/config";
import { google } from "googleapis";
import Groq from "groq-sdk";

/* ================= CONFIG ================= */

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Sheet1";
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS;

const GROQ_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

if (!SHEET_ID) throw new Error("Missing SHEET_ID in .env");
if (!KEYFILE) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS in .env");
if (!GROQ_KEY) throw new Error("Missing GROQ_API_KEY in .env");

/* ================= CLIENTS ================= */

const groq = new Groq({ apiKey: GROQ_KEY });

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/* ================= MAIN ================= */

async function main() {
  console.log(`MODEL="${MODEL}"`);
  console.log("Reading sheet from row 2...");

  // ✅ קורא רק מ-Row 2 ומטה (שורה 1 נשארת כותרות)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:B`,
  });

  const rows = res.data.values || [];
  const updates = [];

  let processed = 0;
  let skippedAnswered = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // ✅ מתחילים משורה 2

    const prompt = (rows[i][0] || "").trim();
    const answer = (rows[i][1] || "").trim();

    if (!prompt) continue;

    // אם כבר יש תשובה — לא נוגעים
    if (answer) {
      skippedAnswered++;
      continue;
    }

    console.log(`→ Row ${rowNumber}: ${prompt}`);

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices?.[0]?.message?.content?.trim() || "";

    updates.push({
      range: `${TAB}!B${rowNumber}`, // ✅ כותב רק ל-B באותה שורה
      values: [[text]],
    });

    processed++;
  }

  if (!updates.length) {
    console.log(
      `Nothing to update (processed=${processed}, skippedAnswered=${skippedAnswered}).`
    );
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates,
    },
  });

  console.log(`✅ DONE → Updated ${processed} row(s).`);
}

main().catch((e) => {
  console.error("❌ run-groq failed:", e?.message || e);
  process.exit(1);
});
