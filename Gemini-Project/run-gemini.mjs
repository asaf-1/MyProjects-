import "dotenv/config";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Sheet1";
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

if (!SHEET_ID) throw new Error("Missing SHEET_ID in .env");
if (!KEYFILE) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS in .env");
if (!API_KEY) throw new Error("Missing GEMINI_API_KEY in .env");

const ai = new GoogleGenAI({ apiKey: API_KEY });

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

async function main() {
  // ✅ read only A2 and B2
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:B2`,
  });

  const row = (readRes.data.values && readRes.data.values[0]) || [];
  const prompt = (row[0] || "").trim();
  const existingAnswer = (row[1] || "").trim();

  console.log(`A2 Prompt = "${prompt}"`);
  console.log(`B2 Answer (before) = "${existingAnswer}"`);

  if (!prompt) {
    console.log("❌ A2 is empty. Put your prompt in A2 and run again.");
    return;
  }

  // אם אתה רוצה שלא ידרוס תשובה קיימת:
  if (existingAnswer) {
    console.log("⏭️ B2 already has an answer. Clear B2 if you want to regenerate.");
    return;
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const text = (response.text || "").trim();

  // ✅ write ONLY to B2
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[text]] },
  });

  console.log("✅ Wrote Gemini answer to B2 only.");
}

main().catch((e) => {
  console.error("❌ run-gemini failed:", e?.message || e);
  process.exit(1);
});
