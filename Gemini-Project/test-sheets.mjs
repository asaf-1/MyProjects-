import "dotenv/config";
import { google } from "googleapis";

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Sheet1";
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!SHEET_ID) throw new Error("Missing SHEET_ID in .env");
if (!KEYFILE) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS in .env");

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function main() {
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2`,
  });

  const prompt = readRes.data.values?.[0]?.[0] || "";
  console.log("A2 Prompt =", JSON.stringify(prompt));

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["TEST"]] },
  });

  console.log("✅ Wrote TEST to B2 successfully");
}

main().catch((e) => {
  console.error("❌ Sheets test failed:", e?.message || e);
  process.exit(1);
});
