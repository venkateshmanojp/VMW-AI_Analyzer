// ============================================================
// VMW AI Loan Analyzer — Render.com Node.js Server v5
// Added: /case-summary endpoint for Rahul WhatsApp bot
// ============================================================

const express  = require("express");
const fetch    = require("node-fetch");
const app      = express();

app.use(express.json({limit: "50mb"}));
app.use(express.urlencoded({limit: "50mb", extended: true}));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ============================================================
// CONFIG
// ============================================================
const BOT_TOKEN     = process.env.BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const APPS_SCRIPT   = process.env.APPS_SCRIPT;
const TG            = `https://api.telegram.org/bot${BOT_TOKEN}`;
const AI            = "https://api.anthropic.com/v1/messages";

// ============================================================
// LOAN TYPES
// ============================================================
const LOANS = {
  "PL"    : "Personal Loan — Fresh",
  "PLBT"  : "Personal Loan — Balance Transfer",
  "HL"    : "Home Loan — Fresh",
  "HLBT"  : "Home Loan — Balance Transfer",
  "HLTU"  : "Home Loan — Top Up",
  "BL"    : "Business Loan — Fresh",
  "LAP"   : "Loan Against Property — Fresh",
  "LAPBT" : "Loan Against Property — Balance Transfer"
};

const CIBIL_MAP = {
  "1": "Above 750",
  "2": "700 - 750",
  "3": "650 - 700",
  "4": "Below 650",
  "5": "Not Checked"
};

// ============================================================
// SESSION STORE
// ============================================================
const sessions = {};
function getSession(chatId)      { return sessions[chatId] || null; }
function saveSession(chatId, s)  { sessions[chatId] = s; }
function clearSession(chatId)    { delete sessions[chatId]; }

// ============================================================
// TELEGRAM HELPERS
// ============================================================
async function tg(chatId, text) {
  try {
    await fetch(`${TG}/sendMessage`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({chat_id: chatId, text: text})
    });
  } catch(e) { console.error("tg error:", e.message); }
}

async function sendButtons(chatId, text, keyboard) {
  try {
    await fetch(`${TG}/sendMessage`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({
        chat_id     : chatId,
        text        : text,
        reply_markup: {inline_keyboard: keyboard}
      })
    });
  } catch(e) { console.error("sendButtons error:", e.message); }
}

async function showMainMenu(chatId) {
  try {
    await fetch(`${TG}/sendMessage`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({
        chat_id     : chatId,
        text        : "Choose action:",
        reply_markup: {
          keyboard: [
            ["📊 ANALYZE",  "📋 MISSING"],
            ["💡 IMPROVE",  "📤 SUBMIT"],
            ["🔍 CLASSIFY", "📄 PROFILE"],
            ["🔄 RESET",    "🏠 NEW LOAN"]
          ],
          resize_keyboard  : true,
          one_time_keyboard: false
        }
      })
    });
  } catch(e) { console.error("showMainMenu error:", e.message); }
}

async function answerCallback(callbackId) {
  try {
    await fetch(`${TG}/answerCallbackQuery`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({callback_query_id: callbackId})
    });
  } catch(e) {}
}

async function removeButtons(chatId, messageId) {
  try {
    await fetch(`${TG}/editMessageReplyMarkup`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({
        chat_id     : chatId,
        message_id  : messageId,
        reply_markup: {inline_keyboard: []}
      })
    });
  } catch(e) {}
}

// ============================================================
// LOAN TYPE MENU
// ============================================================
async function showLoanMenu(chatId) {
  await sendButtons(chatId, "🤖 VMW LOAN ANALYZER\nSelect loan type:", [
    [{text:"🏠 Personal Loan",        callback_data:"loan_PL"},
     {text:"🔄 PL Balance Transfer",  callback_data:"loan_PLBT"}],
    [{text:"🏡 Home Loan",            callback_data:"loan_HL"},
     {text:"🔄 HL Balance Transfer",  callback_data:"loan_HLBT"}],
    [{text:"⬆️ HL Top Up",            callback_data:"loan_HLTU"},
     {text:"💼 Business Loan",        callback_data:"loan_BL"}],
    [{text:"🏢 LAP Fresh",            callback_data:"loan_LAP"},
     {text:"🔄 LAP Balance Transfer", callback_data:"loan_LAPBT"}]
  ]);
}

// ============================================================
// CIBIL MENU
// ============================================================
async function showCibilMenu(chatId) {
  await sendButtons(chatId, "📊 Client's self-declared CIBIL score?", [
    [{text:"🟢 Above 750",   callback_data:"cibil_1"}],
    [{text:"🟡 700 - 750",   callback_data:"cibil_2"}],
    [{text:"🟠 650 - 700",   callback_data:"cibil_3"}],
    [{text:"🔴 Below 650",   callback_data:"cibil_4"}],
    [{text:"❓ Not Checked", callback_data:"cibil_5"}]
  ]);
}

// ============================================================
// DOWNLOAD FILE FROM TELEGRAM
// ============================================================
async function downloadFile(fileId) {
  try {
    const infoRes  = await fetch(`${TG}/getFile?file_id=${fileId}`);
    const info     = await infoRes.json();
    if (!info.ok)  return null;
    const filePath = info.result.file_path;
    const fileUrl  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const fileRes  = await fetch(fileUrl);
    const buffer   = await fileRes.buffer();
    const mimeType = filePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    return {buffer, mimeType, name: filePath.split("/").pop()};
  } catch(e) {
    console.error("downloadFile error:", e.message);
    return null;
  }
}

// ============================================================
// BUILD AI PROMPT
// ============================================================
function buildPrompt(s, docCount) {
  const isBT  = s.code.includes("BT");
  const isPL  = s.code === "PL"  || s.code === "PLBT";
  const isHL  = s.code === "HL"  || s.code === "HLBT" || s.code === "HLTU";
  const isBL  = s.code === "BL";
  const isLAP = s.code === "LAP" || s.code === "LAPBT";
  const isSecured = isHL || isLAP;

  let p = `You are an expert Indian loan underwriter for VastMyWealth Advisory.\n\n`;
  p += `Analyze these ${docCount} financial documents for a ${s.name} application.\n`;
  p += `Client self-declared CIBIL: ${s.cibil}\n\n`;

  if (s.customInstruction) {
    p += `SPECIAL INSTRUCTIONS FROM RELATIONSHIP MANAGER:\n${s.customInstruction}\n\n`;
  }

  p += `ANALYZE AND PROVIDE:\n`;
  p += `1. Extract client name and DOB/Age from PAN card\n`;
  p += `2. Extract co-applicant name and DOB/Age from co-app PAN if present\n`;
  p += `3. Verify name consistency across all documents\n`;
  p += `4. Check document validity dates\n`;
  p += `5. Analyze income from salary slips/ITR/bank credits\n`;
  p += `6. Check bank statement for bounces, EMIs, suspicious transactions\n`;
  p += `7. Calculate FOIR (Fixed Obligation to Income Ratio) — current and post loan\n`;
  p += `8. Calculate max EMI paying capacity (based on 50% FOIR)\n`;
  p += `9. Compare declared CIBIL (${s.cibil}) with banking behavior\n`;
  if (!isPL) p += `10. Check co-applicant documents if present — extract age, income\n`;
  if (isBT)  p += `11. Analyze existing loan repayment history\n`;
  if (isBL || isLAP) p += `12. Verify GST/Udyam name matches bank account name\n`;
  if (isSecured) {
    p += `13. PROPERTY ANALYSIS (if property docs present):\n`;
    p += `    - Identify property type: MCGM/Corporation/Gram Panchayat/SRA/MHADA/CHS/Other\n`;
    p += `    - Extract property address and CTS/Survey number if available\n`;
    p += `    - Check Index II for ownership and authority details\n`;
    p += `    - Check Property Tax Receipt for municipal authority\n`;
    p += `    - Assess property risk: LOW/MEDIUM/HIGH\n`;
    p += `    - Calculate LTV ratio if property value mentioned\n`;
    p += `    - Flag if Gram Panchayat/SRA/Unauthorized — limited lenders\n`;
  }

  p += `\nMINIMUM DOCUMENTS REQUIRED for ${s.name}:\n`;
  if (isPL)  p += `PAN, Aadhar, 3 salary slips OR 2yr ITR, 6m bank statement${isBT ? ", 12m loan statement, sanction letter" : ""}\n`;
  if (isHL)  p += `PAN, Aadhar, income proof, 6m bank statement, property docs (Index II + Property Tax Receipt), co-applicant docs${isBT ? ", 12m loan statement, NOC" : ""}\n`;
  if (isBL)  p += `PAN, Aadhar, GST/Udyam, 12m bank statement, 2yr ITR, co-applicant docs\n`;
  if (isLAP) p += `PAN, Aadhar, income proof, 12m bank statement, property title docs (Index II + Property Tax Receipt), co-applicant docs${isBT ? ", 12m loan statement, NOC" : ""}\n`;

  p += `\nFORMAT RESPONSE CONCISELY AS:\n\n`;
  p += `🤖 VMW AI LOAN ANALYSIS\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  p += `Loan: ${s.name}\n`;
  p += `CIBIL Declared: ${s.cibil}\n`;
  p += `Documents: ${docCount} analyzed\n\n`;
  p += `👤 CLIENT\n`;
  p += `Name: [from docs]\n`;
  p += `Age: [from PAN]\n`;
  p += `Employment: [Salaried/Self-Employed]\n\n`;
  if (!isPL) {
    p += `👥 CO-APPLICANT\n`;
    p += `Name: [if present] | Age: [from PAN] | Income: [amount]\n\n`;
  }
  p += `💰 INCOME & METRICS\n`;
  p += `Monthly Income: [amount] | Co-App Income: [if any]\n`;
  p += `Total Income: [combined]\n`;
  p += `Existing EMIs: [amount] | Bank Balance Avg: [amount]\n`;
  p += `FOIR Current: [%] | FOIR Post Loan: [%]\n`;
  p += `Max EMI Capacity: [amount]\n\n`;
  if (isSecured) {
    p += `🏠 PROPERTY\n`;
    p += `Type: [MCGM/GP/SRA/MHADA/CHS/Other]\n`;
    p += `Authority: [from docs]\n`;
    p += `LTV: [% if value available]\n`;
    p += `Property Risk: [LOW/MEDIUM/HIGH]\n\n`;
  }
  p += `🔍 CHECKS\n`;
  p += `Name: [✅/❌] | Docs Valid: [✅/❌] | Bounces: [None/count] | Fraud: [LOW/MED/HIGH]\n\n`;
  p += `❌ MISSING: [list briefly]\n\n`;
  p += `📊 PROBABILITY: [X]% | Risk: [LOW/MED/HIGH]\n\n`;
  p += `✅ [PROCEED/MORE DOCS/REJECT] — [one line reason]\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return p;
}

// ============================================================
// BUILD PROFILE PROMPT
// ============================================================
function buildProfilePrompt(s) {
  const isSecured = s.code === "HL" || s.code === "HLBT" || s.code === "HLTU" ||
                    s.code === "LAP" || s.code === "LAPBT";
  const isBT      = s.code.includes("BT");
  const today     = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"});

  let purpose = "Fresh Purchase";
  if (s.code.includes("BT") && s.code.includes("TU")) purpose = "Balance Transfer + Top Up";
  else if (s.code.includes("BT")) purpose = "Balance Transfer";
  else if (s.code.includes("TU")) purpose = "Top Up";

  let p = `You are preparing a professional loan applicant profile one-pager for VastMyWealth Advisory.\n\n`;
  p += `Based on the analysis below, create a clean presentable profile.\n\n`;
  p += `ANALYSIS DATA:\n${s.analysis}\n\n`;

  if (s.customInstruction) {
    p += `CORRECTIONS/ADDITIONAL INFO FROM RELATIONSHIP MANAGER:\n${s.customInstruction}\n\n`;
  }

  if (s.additionalStrengths) {
    p += `ADDITIONAL STRENGTHS TO INCLUDE:\n${s.additionalStrengths}\n\n`;
  }

  p += `EMPLOYER TIER CLASSIFICATION:\n`;
  p += `Tier 1: Government, PSU, MNC, Listed Companies (TCS, Infosys, Wipro, HUL, etc)\n`;
  p += `Tier 2: Mid-size companies, Private Ltd, well-known brands\n`;
  p += `Tier 3: Small firms, startups, proprietorship\n\n`;

  p += `CITY CLASSIFICATION:\n`;
  p += `Metro: Mumbai, Delhi, Bangalore, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad\n`;
  p += `Tier 1: Surat, Jaipur, Lucknow, Kochi, Chandigarh, Indore, Nagpur\n`;
  p += `Tier 2: All other cities\n\n`;

  p += `FORMAT THE PROFILE EXACTLY AS BELOW.\n`;
  p += `Extract all figures from analysis. If not available write N/A.\n`;
  p += `Calculate Age at Loan End = Current Age + Tenure.\n\n`;

  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  p += `🏦 VASTMYWEALTH ADVISORY\n`;
  p += `   LOAN APPLICANT PROFILE\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  p += `👤 APPLICANT DETAILS\n`;
  p += `Name: [full name from docs]\n`;
  p += `Age: [age] years (DOB: [date] — PAN verified)\n`;
  p += `Age at Loan End: [age + tenure] years\n`;
  p += `Employment: [Salaried/Self-Employed] — [sector]\n`;
  p += `Company: [name] ([Tier 1/2/3] — [Govt/MNC/Private etc])\n`;
  p += `Experience: [years]\n`;
  p += `City: [city] ([Metro/Tier 1/Tier 2])\n\n`;
  p += `👥 CO-APPLICANT\n`;
  p += `[If present include below, else write: Not Applicable]\n`;
  p += `Name: [name]\n`;
  p += `Age: [age] years (DOB: [date] — PAN verified)\n`;
  p += `Age at Loan End: [age + tenure] years\n`;
  p += `Employment: [type]\n`;
  p += `Income: ₹[amount]/month\n\n`;
  p += `💰 FINANCIAL SUMMARY\n`;
  p += `Salary Bank: [bank name from bank statement]\n`;
  p += `Monthly Income: ₹[amount]\n`;
  p += `Co-App Income: ₹[amount or Not Applicable]\n`;
  p += `Total Income: ₹[combined]\n`;
  p += `CIBIL Score: [score] ([Excellent/Good/Fair/Poor])\n`;
  p += `Cheque Bounces: [None/count]\n\n`;
  p += `📊 OBLIGATION BREAKUP\n`;
  p += `Personal Loan EMI: ₹[amount or Nil]\n`;
  p += `Home Loan EMI: ₹[amount or Nil]\n`;
  p += `Credit Card Outstanding: ₹[amount or Nil]\n`;
  p += `Other EMIs: ₹[amount or Nil]\n`;
  p += `Total Fixed Obligations: ₹[total]\n\n`;
  p += `📐 UNDERWRITING METRICS\n`;
  p += `FOIR Current: [%] [✅ if below 30% / ⚠️ if 30-50% / ❌ if above 50%]\n`;
  p += `FOIR Post Loan: [%] [✅ if below 50% / ⚠️ if 50-60% / ❌ if above 60%]\n`;
  p += `Max EMI Capacity: ₹[amount]/month (based on 50% FOIR)\n`;
  if (isSecured) p += `LTV Ratio: [% or N/A] [✅ if below 75% / ⚠️ if 75-80% / ❌ if above 80%]\n`;
  p += `\n`;
  if (isSecured) {
    p += `🏠 PROPERTY DETAILS\n`;
    p += `Type: [MCGM/Gram Panchayat/SRA/MHADA/CHS/Other]\n`;
    p += `Authority: [name]\n`;
    p += `Bank Approved: [YES/NO/Not Checked]\n`;
    p += `Society Registered: [YES/NO/N/A]\n`;
    p += `Deviation: [None/describe if any]\n`;
    p += `Property Risk: [LOW/MEDIUM/HIGH]\n\n`;
  }
  p += `🏦 LOAN REQUIREMENT\n`;
  p += `Type: [loan type]\n`;
  p += `Purpose: ${purpose}\n`;
  p += `Amount: ₹[amount]\n`;
  p += `Tenure Requested: [years]\n`;
  p += `Expected Interest Rate: [if mentioned, else: As per best available rate]\n\n`;
  p += `📊 PROFILE STRENGTH\n`;
  p += `Overall Score: [X]/100\n`;
  p += `Income Stability: [✅/⚠️/❌] [brief note]\n`;
  p += `Employer Category: [✅/⚠️/❌] [Tier + type]\n`;
  p += `CIBIL: [✅/⚠️/❌] [brief note]\n`;
  p += `Documents: [✅/⚠️/❌] [brief note]\n`;
  p += `Debt Ratio: [✅/⚠️/❌] [brief note]\n`;
  p += `Repayment History: [✅/⚠️/❌] [brief note]\n`;
  if (isSecured) p += `Property: [✅/⚠️/❌] [brief note]\n`;
  p += `\n`;
  p += `⭐ ADDITIONAL STRENGTHS\n`;
  p += `[List strengths from analysis + any provided by RM]\n`;
  p += `[If none available write: None mentioned]\n\n`;
  p += `📋 DOCUMENTS VERIFIED\n`;
  p += `[List each document uploaded with ✅]\n\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  p += `Prepared by: VastMyWealth Advisory\n`;
  p += `Date: ${today}\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  p += `IMPORTANT RULES:\n`;
  p += `1. Extract ALL figures directly from analysis — do not invent\n`;
  p += `2. If field not available — write N/A\n`;
  p += `3. Calculate Age at Loan End accurately\n`;
  p += `4. Classify employer tier based on company name\n`;
  p += `5. Identify salary bank from bank statement header\n`;
  p += `6. Break down obligations from bank statement debits\n`;
  p += `7. Classify city correctly as Metro/Tier 1/Tier 2`;

  return p;
}

// ============================================================
// RUN AI ANALYSIS
// ============================================================
async function runAnalysis(chatId, s) {
  try {
    const content = [];
    let downloaded = 0;
    for (let i = 0; i < s.ids.length; i++) {
      const file = await downloadFile(s.ids[i]);
      if (!file) continue;
      const b64 = file.buffer.toString("base64");
      if (file.mimeType === "application/pdf") {
        content.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:b64}});
      } else {
        content.push({type:"image", source:{type:"base64", media_type:file.mimeType, data:b64}});
      }
      downloaded++;
    }
    content.push({type:"text", text: buildPrompt(s, downloaded)});

    const aiRes = await fetch(AI, {
      method : "POST",
      headers: {"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body: JSON.stringify({model:"claude-haiku-4-5", max_tokens:2000, messages:[{role:"user", content}]})
    });

    const result = await aiRes.json();

    if (result.error && result.error.message && result.error.message.includes("100 PDF pages")) {
      await tg(chatId, "⚠️ One document has too many pages!\n\nPlease split the bank statement:\n• Send only last 6 months\n• Or compress the PDF\n\nType REMOVE to delete last doc\nThen upload shorter version!");
      s.status = "uploading";
      saveSession(chatId, s);
      await showMainMenu(chatId);
      return;
    }

    if (result.content && result.content[0]) {
      const analysis = result.content[0].text;
      s.analysis     = analysis;
      s.status       = "analyzed";
      const probMatch = analysis.match(/PROBABILITY[:\s]+(\d+)%/i);
      if (probMatch) s.probability = probMatch[1] + "%";
      const nameMatch = analysis.match(/Name[:\s]+([A-Za-z\s]+)\n/i);
      if (nameMatch) s.clientName = nameMatch[1].trim();
      saveSession(chatId, s);

      if (analysis.length > 3800) {
        const lines = analysis.split("\n");
        let chunk = "";
        const chunks = [];
        for (const line of lines) {
          if ((chunk + "\n" + line).length > 3800) { chunks.push(chunk); chunk = line; }
          else { chunk = chunk ? chunk + "\n" + line : line; }
        }
        if (chunk) chunks.push(chunk);
        for (const c of chunks) await tg(chatId, c);
      } else {
        await tg(chatId, analysis);
      }
      await showMainMenu(chatId);
    } else {
      await tg(chatId, "❌ AI analysis failed!\n" + JSON.stringify(result).substring(0,200));
      await showMainMenu(chatId);
    }
  } catch(err) {
    console.error("runAnalysis error:", err);
    await tg(chatId, "❌ Analysis error: " + err.message);
  }
}

// ============================================================
// SUBMIT REPORT
// ============================================================
async function submitReport(chatId, s) {
  try {
    await tg(chatId, "⏳ Saving report...");
    const url = APPS_SCRIPT +
      "?action=saveAnalysis" +
      "&loan="     + encodeURIComponent(s.name        || "") +
      "&name="     + encodeURIComponent(s.clientName  || "Unknown") +
      "&cibil="    + encodeURIComponent(s.cibil       || "") +
      "&docs="     + encodeURIComponent(s.docs.length || 0) +
      "&prob="     + encodeURIComponent(s.probability || "N/A") +
      "&analysis=" + encodeURIComponent(s.analysis    || "");
    const res  = await fetch(url);
    const data = await res.json();
    if (data.success) {
      await tg(chatId, "✅ REPORT SAVED!\n━━━━━━━━━━━━━━━━━━\nSheet: Saved ✅\nEmail: Sent ✅\n\nType RESET to start new analysis.");
    } else {
      await tg(chatId, "❌ Save failed: " + (data.error || "Unknown error"));
    }
    await showMainMenu(chatId);
  } catch(err) {
    console.error("submitReport error:", err);
    await tg(chatId, "❌ Submit error: " + err.message);
    await showMainMenu(chatId);
  }
}

// ============================================================
// SHOW MISSING DOCUMENTS
// ============================================================
async function showMissing(chatId, s) {
  const isBT  = s.code.includes("BT");
  const isPL  = s.code === "PL"  || s.code === "PLBT";
  const isHL  = s.code === "HL"  || s.code === "HLBT" || s.code === "HLTU";
  const isBL  = s.code === "BL";
  const isLAP = s.code === "LAP" || s.code === "LAPBT";

  let required = ["PAN Card", "Aadhar Card", "Bank Statement"];
  if (isPL)  { required.push("Salary Slips or ITR"); if (isBT) required.push("Loan Account Statement", "Sanction Letter"); }
  if (isHL)  { required.push("Income Proof", "Property Documents", "Co-Applicant Docs"); if (isBT) required.push("Loan Account Statement", "NOC"); }
  if (isBL)  { required.push("GST/Udyam Certificate", "ITR", "Co-Applicant Docs"); }
  if (isLAP) { required.push("Income Proof", "Property Title Documents", "Co-Applicant Docs"); if (isBT) required.push("Loan Account Statement", "NOC"); }

  const names   = s.docs.map(d => d.toLowerCase());
  const missing = required.filter(r => !names.some(n => n.includes(r.toLowerCase().split(" ")[0])));

  await tg(chatId,
    "📋 DOCUMENTS CHECK\n━━━━━━━━━━━━━━━━━━\nReceived: " + s.docs.length + "\n\n" +
    (missing.length > 0 ? "❌ Still needed:\n" + missing.map(m => "• " + m).join("\n") : "✅ Minimum documents present!\nType ANALYZE to proceed.")
  );
  await showMainMenu(chatId);
}

// ============================================================
// CLASSIFY DOCUMENTS
// ============================================================
const ILOVEPDF_PUBLIC = process.env.ILOVEPDF_PUBLIC;
const CLASSIFY_PENDING = {};

async function classifyDocuments(chatId, s) {
  try {
    if (s.docs.length === 0) { await tg(chatId, "❌ No documents uploaded!\nUpload documents first then type CLASSIFY."); return; }
    await tg(chatId, "🔍 Starting classification...\nTotal: " + s.docs.length + " documents\n\nI will show each document and ask you to confirm.\nPlease wait...");
    CLASSIFY_PENDING[chatId] = {
      ids: s.ids.slice(), names: s.docs.slice(),
      classifications: new Array(s.ids.length).fill(null), currentIndex: 0
    };
    await classifyNext(chatId);
  } catch(err) {
    console.error("classifyDocuments error:", err);
    await tg(chatId, "❌ Error: " + err.message);
    await showMainMenu(chatId);
  }
}

async function classifyNext(chatId) {
  const p = CLASSIFY_PENDING[chatId];
  if (!p) return;
  const idx = p.currentIndex;
  if (idx >= p.ids.length) { await createClassifiedPDFs(chatId); return; }
  try {
    await tg(chatId, "🔍 Classifying " + (idx+1) + " of " + p.ids.length + "...");
    const file = await downloadFile(p.ids[idx]);
    if (!file) { p.classifications[idx] = "Other Document"; p.currentIndex++; await classifyNext(chatId); return; }
    const isPDF = file.mimeType === "application/pdf";
    let docType = "Other Document";
    if (!isPDF) {
      const b64 = file.buffer.toString("base64");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
        body:JSON.stringify({
          model:"claude-haiku-4-5", max_tokens:50,
          messages:[{role:"user", content:[
            {type:"image", source:{type:"base64", media_type:file.mimeType, data:b64}},
            {type:"text", text:"Identify this document. Reply with ONLY one label:\nPAN Card\nAadhar Card\nBank Statement\nSalary Slip\nITR\nGST Certificate\nProperty Document\nForm 16\nOffer Letter\nLoan Statement\nOther Document\n\nOne label only."}
          ]}]
        })
      });
      const data = await res.json();
      if (data.content && data.content[0]) docType = data.content[0].text.trim();
    } else { docType = "PDF Document"; }
    p.classifications[idx] = docType;
    if (!isPDF) {
      const FormData = require("form-data");
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", "📄 Document " + (idx+1) + " of " + p.ids.length + "\n━━━━━━━━━━━━━━━━━━\n🤖 I think this is: " + docType + "\n\nReply YES if correct\nOr tell me what it is (e.g. Salary Slip)");
      form.append("photo", file.buffer, {filename:"doc.jpg", contentType:file.mimeType});
      await fetch(TG + "/sendPhoto", {method:"POST", headers:form.getHeaders(), body:form});
    } else {
      await tg(chatId, "📄 Document " + (idx+1) + " of " + p.ids.length + " (PDF)\n━━━━━━━━━━━━━━━━━━\n🤖 I think this is: " + docType + "\n\nReply YES if correct\nOr tell me what it is");
    }
  } catch(err) { p.classifications[idx] = "Other Document"; p.currentIndex++; await classifyNext(chatId); }
}

async function createClassifiedPDFs(chatId) {
  const p = CLASSIFY_PENDING[chatId];
  if (!p) return;
  await tg(chatId, "✅ All classified!\n\n📋 SUMMARY\n━━━━━━━━━━━━━━━━━━\n" + p.classifications.map((c,i) => (i+1) + ". " + c).join("\n") + "\n\n⏳ Creating separate PDFs...");
  const groups = {};
  p.classifications.forEach((type, i) => { if (!groups[type]) groups[type] = []; groups[type].push(p.ids[i]); });
  let token = null;
  try {
    const ar = await fetch("https://api.ilovepdf.com/v1/auth", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({public_key: ILOVEPDF_PUBLIC})});
    const ad = await ar.json();
    token = ad.token;
  } catch(e) { await tg(chatId, "❌ ilovepdf auth failed: " + e.message); delete CLASSIFY_PENDING[chatId]; await showMainMenu(chatId); return; }
  if (!token) { await tg(chatId, "❌ Could not authenticate with ilovepdf!"); delete CLASSIFY_PENDING[chatId]; await showMainMenu(chatId); return; }
  let successCount = 0;
  for (const docType in groups) {
    const fileIds = groups[docType];
    try {
      const taskRes  = await fetch("https://api.ilovepdf.com/v1/start/imagepdf", {method:"GET", headers:{"Authorization":"Bearer " + token}});
      const taskData = await taskRes.json();
      const server   = taskData.server;
      const taskId   = taskData.task;
      if (!server || !taskId) continue;
      const serverFiles = [];
      for (let i = 0; i < fileIds.length; i++) {
        const file = await downloadFile(fileIds[i]);
        if (!file) continue;
        const FD   = require("form-data");
        const form = new FD();
        const ext  = file.mimeType === "application/pdf" ? ".pdf" : ".jpg";
        form.append("file", file.buffer, {filename:"doc_"+(i+1)+ext, contentType:file.mimeType});
        const ur   = await fetch("https://"+server+"/v1/upload", {method:"POST", headers:{"Authorization":"Bearer "+token,...form.getHeaders()}, body:form});
        const ud   = await ur.json();
        if (ud.server_filename) serverFiles.push({server_filename:ud.server_filename, filename:"doc_"+(i+1)+ext, task:taskId});
      }
      if (serverFiles.length === 0) continue;
      const safeName = docType.replace(/[^a-zA-Z0-9]/g, "_");
      const pr = await fetch("https://"+server+"/v1/process", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({task:taskId, tool:"imagepdf", files:serverFiles, output_filename:safeName})
      });
      const pd = await pr.json();
      if (!pd.download_filename) continue;
      const dr  = await fetch("https://"+server+"/v1/download/"+taskId, {headers:{"Authorization":"Bearer "+token}});
      const buf = await dr.buffer();
      const TF  = require("form-data");
      const tf  = new TF();
      tf.append("chat_id",  chatId);
      tf.append("caption",  "📄 " + docType + " (" + fileIds.length + " page" + (fileIds.length>1?"s":"") + ")");
      tf.append("document", buf, {filename:safeName+".pdf", contentType:"application/pdf"});
      await fetch(TG+"/sendDocument", {method:"POST", headers:tf.getHeaders(), body:tf});
      successCount++;
      await new Promise(r => setTimeout(r, 500));
    } catch(err) { console.error("PDF error for " + docType + ":", err.message); await tg(chatId, "⚠️ Could not create PDF for: " + docType); }
  }
  await tg(chatId, "🎉 DONE!\n━━━━━━━━━━━━━━━━━━\n✅ " + successCount + " PDF(s) created!\n\nForward these PDFs to the lender directly from Telegram!");
  delete CLASSIFY_PENDING[chatId];
  await showMainMenu(chatId);
}

// ============================================================
// GENERATE PROFILE ONE-PAGER
// ============================================================
async function generateProfile(chatId, s) {
  try {
    if (!s.analysis) { await tg(chatId, "❌ Please run ANALYZE first!\nI need the analysis to generate the profile."); await showMainMenu(chatId); return; }
    await tg(chatId, "⏳ Generating applicant profile...\nPlease wait 20-30 seconds!");
    const res = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514", max_tokens:2000, messages:[{role:"user", content:buildProfilePrompt(s)}]})
    });
    const result = await res.json();
    if (result.content && result.content[0]) {
      const profile = result.content[0].text;
      s.lastProfile = profile;
      saveSession(chatId, s);
      if (profile.length > 3800) {
        const lines = profile.split("\n");
        let chunk = "";
        const chunks = [];
        for (const line of lines) {
          if ((chunk + "\n" + line).length > 3800) { chunks.push(chunk); chunk = line; }
          else { chunk = chunk ? chunk + "\n" + line : line; }
        }
        if (chunk) chunks.push(chunk);
        for (const c of chunks) await tg(chatId, c);
      } else { await tg(chatId, profile); }
      await tg(chatId, "📋 Profile generated!\n\nTo update:\n• Type any corrections e.g. 'Income is 95000 not 85000'\n• Or add strengths e.g. 'Additional strength: Government employee'\n• Then type PROFILE again for fresh report ✅");
    } else { await tg(chatId, "❌ Profile generation failed!\n" + JSON.stringify(result).substring(0,200)); }
    await showMainMenu(chatId);
  } catch(err) { console.error("generateProfile error:", err); await tg(chatId, "❌ Profile error: " + err.message); await showMainMenu(chatId); }
}

// ============================================================
// SHOW IMPROVEMENTS
// ============================================================
async function showImprove(chatId, s) {
  await tg(chatId, "⏳ Generating improvement suggestions...");
  try {
    const res = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({
        model:"claude-haiku-4-5", max_tokens:800,
        messages:[{role:"user", content:"Based on this loan analysis:\n\n" + s.analysis + "\n\nProvide 5 specific actions to improve approval probability.\nFormat:\n💡 HOW TO IMPROVE\n1. [action] — +[X]%\n2. [action] — +[X]%\n..."}]
      })
    });
    const result = await res.json();
    if (result.content && result.content[0]) await tg(chatId, result.content[0].text);
  } catch(e) { await tg(chatId, "❌ Error: " + e.message); }
  await showMainMenu(chatId);
}

// ============================================================
// UNLOCK PDF VIA ILOVEPDF
// ============================================================
async function unlockPDF(b64, password) {
  try {
    const authRes  = await fetch("https://api.ilovepdf.com/v1/auth", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({public_key: ILOVEPDF_PUBLIC})});
    const authData = await authRes.json();
    const token    = authData.token;
    if (!token) { console.log("ilovepdf auth failed"); return null; }
    const taskRes  = await fetch("https://api.ilovepdf.com/v1/start/unlock", {method:"GET", headers:{"Authorization":"Bearer " + token}});
    const taskData = await taskRes.json();
    const server   = taskData.server;
    const taskId   = taskData.task;
    if (!server || !taskId) return null;
    const rawB64   = b64.startsWith("PDF:") ? b64.replace("PDF:","") : b64;
    const buffer   = Buffer.from(rawB64, "base64");
    const FormData = require("form-data");
    const form     = new FormData();
    form.append("task", taskId);
    form.append("file", buffer, {filename:"bank.pdf", contentType:"application/pdf"});
    const uploadRes  = await fetch("https://" + server + "/v1/upload", {method:"POST", headers:{"Authorization":"Bearer " + token, ...form.getHeaders()}, body:form});
    const uploadData = await uploadRes.json();
    if (!uploadData.server_filename) return null;
    const processRes = await fetch("https://" + server + "/v1/process", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer " + token},
      body:JSON.stringify({task:taskId, tool:"unlock", files:[{server_filename:uploadData.server_filename, filename:"bank.pdf", task:taskId, password:password}]})
    });
    const processData = await processRes.json();
    if (!processData.download_filename) return null;
    const downloadRes = await fetch("https://" + server + "/v1/download/" + taskId, {headers:{"Authorization":"Bearer " + token}});
    const pdfBuffer = await downloadRes.buffer();
    console.log("✅ PDF unlocked successfully!");
    return "PDF:" + pdfBuffer.toString("base64");
  } catch(e) { console.error("unlockPDF error:", e.message); return null; }
}

// ============================================================
// SEARCH LENDERS BY CITY (fuzzy match)
// ============================================================
async function getLendersByCity(city) {
  try {
    if (!APPS_SCRIPT || !city) return null;
    const url = APPS_SCRIPT +
      "?action=getLendersByCity&city=" + encodeURIComponent(city.trim());
    const res  = await fetch(url);
    const data = await res.json();
    if (data.success && data.lenders && data.lenders.length > 0) {
      return data.lenders;
    }
    return null;
  } catch(e) {
    console.error("getLendersByCity error:", e.message);
    return null;
  }
}

// ============================================================
// SEND EMAIL VIA APPS SCRIPT
// ============================================================
async function sendCaseEmail(caseData) {
  try {
    if (!APPS_SCRIPT) return false;
    const url = APPS_SCRIPT +
      "?action=saveAnalysis" +
      "&loan="     + encodeURIComponent(caseData.loanType || "") +
      "&name="     + encodeURIComponent(caseData.name     || "") +
      "&cibil="    + encodeURIComponent(caseData.cibil    || "") +
      "&docs="     + encodeURIComponent("WhatsApp Upload") +
      "&prob="     + encodeURIComponent("N/A") +
      "&analysis=" + encodeURIComponent((caseData.body    || "").substring(0, 2000));
    const res  = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    console.log("Email response:", text.substring(0, 100));
    return text.indexOf("success") !== -1;
  } catch(e) {
    console.error("sendCaseEmail error:", e.message);
    return false;
  }
}



// ============================================================
// ============================================================
// CASE SUMMARY — NEW ENDPOINT
// Receives case data from Rahul WhatsApp bot
// Generates professional case note + sends email + Telegram
// ============================================================
app.post("/case-summary", async (req, res) => {
  res.json({ success: true, message: "Case summary generation started" });

  try {
    const data = req.body;
    const name           = data.name           || "Unknown";
    const mobile         = data.mobile         || "";
    const loanType       = data.loanType       || "Unknown";
    const loanAmount     = data.loanAmount     || "Not mentioned";
    const city           = data.city           || "Not mentioned";
    const age            = data.age            || "Not mentioned";
    const employmentType = data.employmentType || "Not mentioned";
    const monthlyIncome  = data.monthlyIncome  || "Not mentioned";
    const cibilScore     = data.cibilScore     || "Not mentioned";
    const existingEMI    = data.existingEMI    || "None";
    const bounces        = data.bounces        || "None";
    const companyName    = data.companyName    || "Not mentioned";
    const workExperience = data.workExperience || "Not mentioned";
    const businessVintage= data.businessVintage|| "Not mentioned";
    const propertyDetails= data.propertyDetails|| "Not mentioned";
    const coApplicant    = data.coApplicant    || "None";
    const partnerCode    = data.partnerCode    || "";
    const isPartnerCase  = data.isPartnerCase  || false;
    const documents      = data.documents      || {};
    const conversationSummary = data.conversationSummary || "";
    const chatId         = process.env.CHAT_ID || "1471849538";

    console.log(`Case summary started: ${name} | ${loanType} | ${mobile}`);

    // Notify processing started
    await tg(chatId, `⏳ Generating case summary for ${name}...\nLoan: ${loanType}\nPlease wait!`);

    // ── STEP 1: ANALYZE DOCUMENTS IF ANY ────────────────────
    let documentAnalysis = "";
    const docsReceived   = [];
    const docContent     = [];

    const docKeys  = ["pan", "aadhar", "salary", "bank", "itr", "udyam", "other"];
    const docNames = ["PAN Card", "Aadhar Card", "Salary Slip", "Bank Statement", "ITR", "Udyam", "Other Document"];

    for (let i = 0; i < docKeys.length; i++) {
      const b64 = documents[docKeys[i]];
      if (!b64 || b64.length < 10) continue;
      try {
        const isPDF  = b64.startsWith("PDF:");
        const rawB64 = isPDF ? b64.replace("PDF:", "") : b64;
        let mimeType = "image/jpeg";
        if (isPDF) mimeType = "application/pdf";
        else if (rawB64.startsWith("iVBOR")) mimeType = "image/png";

        if (isPDF) {
          docContent.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:rawB64}});
        } else {
          docContent.push({type:"image", source:{type:"base64", media_type:mimeType, data:rawB64}});
        }
        docsReceived.push(docNames[i]);
        console.log(`Loaded for case: ${docNames[i]}`);
      } catch(e) {
        console.error(`Doc error ${docNames[i]}: ${e.message}`);
      }
    }

    // Analyze documents if any received
    if (docContent.length > 0) {
      const docPrompt = `You are verifying documents for a loan application at VastMyWealth Advisory.

Customer: ${name} | Loan: ${loanType} | Employment: ${employmentType}

Please verify these ${docContent.length} documents and extract:
1. Name on PAN Card
2. Name on Aadhar Card  
3. Bank statement period (from month-year to month-year) and number of months
4. Bank account holder name
5. Average monthly balance or salary credits
6. Number of bounces/returns
7. Existing EMI debits
8. Salary slip details (company, amount, month)
9. ITR assessment year and income
10. Udyam business name and registration date
11. Any name mismatches across documents
12. Any concerns or red flags

Respond in simple clear points. No technical jargon.`;

      docContent.push({type:"text", text:docPrompt});

      try {
        const docRes = await fetch(AI, {
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
          body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1000, messages:[{role:"user", content:docContent}]})
        });
        const docResult = await docRes.json();
        if (docResult.content && docResult.content[0]) {
          documentAnalysis = docResult.content[0].text;
          console.log("Document analysis complete");
        }
      } catch(e) {
        console.error("Document analysis error:", e.message);
      }
    }

    // ── STEP 2: GENERATE CASE SUMMARY ───────────────────────
    const lt        = loanType.toUpperCase();
    const isHL      = lt.includes("HOME");
    const isLAP     = lt.includes("PROPERTY") || lt.includes("AGAINST") || lt.includes("LAP");
    const isBL      = lt.includes("BUSINESS");
    const isPL      = lt.includes("PERSONAL");
    const isCF      = lt.includes("CONSTRUCTION");
    const isBT      = lt.includes("BALANCE") || lt.includes("TRANSFER");
    const isSecured = isHL || isLAP;
    const today     = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"});

    const casePrompt = `You are a senior loan advisor at VastMyWealth Advisory preparing a professional case note for a banker/lender.

Write a clear, professional case note that a banker can read and immediately understand.
Use simple language — no technical jargon.
Write in the style of the sample case note below.

CUSTOMER DETAILS FROM CONVERSATION:
Name: ${name}
Mobile: ${mobile}
Age: ${age}
Loan Type: ${loanType}
Loan Amount: ${loanAmount}
City: ${city}
Employment: ${employmentType}
Company/Business: ${companyName}
Work Experience/Vintage: ${employmentType.toLowerCase().includes("self") ? businessVintage : workExperience}
Monthly Income: ${monthlyIncome}
CIBIL Score: ${cibilScore}
Existing EMIs: ${existingEMI}
Bounces: ${bounces}
Co-Applicant: ${coApplicant}
Property Details: ${propertyDetails}
${isPartnerCase ? "Partner Code: " + partnerCode : ""}

DOCUMENT VERIFICATION RESULTS:
${documentAnalysis || "Documents pending — to be collected"}

DOCUMENTS RECEIVED:
${docsReceived.length > 0 ? docsReceived.map(d => "✅ " + d).join("\n") : "Documents pending"}

CONVERSATION CONTEXT:
${conversationSummary}
IMPORTANT — Write like a professional credit manager:
- Analyze employment stability based on company and experience
- Comment on income vs loan amount feasibility  
- Calculate FOIR based on income and existing EMIs
- Mention loan eligibility amount
- Comment on CIBIL strength
- For self employed — comment on business vintage strength
- Highlight genuine strengths
- Note any concerns
- Write in banker friendly language
- Make it sound like a human wrote it — not a data dump

FORMAT THE CASE NOTE EXACTLY LIKE THIS SAMPLE:

CASE: ${loanType.toUpperCase()} — ${loanAmount}
${isBT ? "(BALANCE TRANSFER + TOP UP)" : ""}

APPLICANT PROFILE:
• ${name}, Age ${age}
• ${employmentType} — ${companyName}
• [Brief note about employment stability]

${coApplicant && coApplicant !== "None" ? `CO-APPLICANT:
• ${coApplicant}
• [Income and relationship details]

` : ""}LOCATION:
• ${city}

INCOME DETAILS:
• Monthly Income: ${monthlyIncome}
• [Additional income details if any]

BANKING & CREDIT:
• CIBIL: ${cibilScore}
• Bounces: ${bounces}
• Existing EMIs: ${existingEMI}
• [Banking behavior notes from documents]

${isSecured ? `PROPERTY DETAILS:
• ${propertyDetails}
• [Property type and risk assessment]

` : ""}LOAN REQUIREMENT:
• Type: ${loanType}
• Amount: ${loanAmount}
• ${isBT ? "Purpose: Balance Transfer — consolidation and better rate" : "Purpose: [from conversation]"}

DOCUMENTS AVAILABLE:
${docsReceived.length > 0 ? docsReceived.map(d => "• " + d + " ✅").join("\n") : "• To be collected"}
${docsReceived.length < (isPL ? 4 : 3) ? "\nDOCUMENTS PENDING:\n• [List pending documents]" : ""}

STRENGTHS:
• [List 3-5 genuine strengths based on profile]

${documentAnalysis && documentAnalysis.includes("concern") ? `CONCERNS:
• [List any concerns noted]

` : ""}NOTE:
[2-3 line summary of the case for banker — why this case should be considered]

━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared by: VastMyWealth Advisory | Rahul
Date: ${today}
Contact: venkateshmanojp@gmail.com
━━━━━━━━━━━━━━━━━━━━━━━━━

RULES:
1. Write like a human banker — simple clear language
2. Extract actual figures from documents if available
3. If data not available write "To be confirmed"
4. Highlight genuine strengths
5. Note any concerns honestly
6. Keep total length reasonable — banker should read in 2 minutes`;

    const caseRes = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:2000, messages:[{role:"user", content:casePrompt}]})
    });

    const caseResult = await caseRes.json();
    if (!caseResult.content || !caseResult.content[0]) {
      await tg(chatId, `❌ Case summary generation failed for ${name}!\nPlease review manually.`);
      return;
    }

    const caseSummary = caseResult.content[0].text;
    console.log("Case summary generated for: " + name);

    // ── STEP 3: GET LENDERS FOR CITY ────────────────────────
    let lenderText = "";
    if (city && city !== "Not mentioned") {
      const lenders = await getLendersByCity(city);
      if (lenders && lenders.length > 0) {
        lenderText = `\n\n🏦 AVAILABLE LENDERS IN ${city.toUpperCase()}:\n`;
        lenders.forEach(l => {
          lenderText += `\n${l.bank}\n`;
          if (l.smName)   lenderText += `SM: ${l.smName} — 📞 ${l.smMobile}\n`;
          if (l.product)  lenderText += `Products: ${l.product}\n`;
        });
      }
    }

    // ── STEP 4: SAVE TO MASTER SHEET ────────────────────────
    if (APPS_SCRIPT && mobile) {
      try {
        const cleanMobile = mobile.replace(/\D/g,"").slice(-10);
        const saveUrl = APPS_SCRIPT +
          "?action=saveProfile" +
          "&mobile="  + encodeURIComponent(cleanMobile) +
          "&profile=" + encodeURIComponent(caseSummary.substring(0, 1500));
        await fetch(saveUrl);
        console.log("Case saved to Master Sheet");
      } catch(e) {
        console.error("Save to sheet error:", e.message);
      }
    }

    // ── STEP 5: SEND EMAIL ───────────────────────────────────
    const emailData = {
      to          : "venkateshmanojp@gmail.com",
      subject     : `New Case — ${name} | ${loanType} | ${loanAmount}${isPartnerCase ? " | Partner: " + partnerCode : ""}`,
      body        : caseSummary,
      mobile      : mobile,
      name        : name,
      loanType    : loanType,
      isPartner   : isPartnerCase,
      partnerCode : partnerCode
    };

    const emailSent = await sendCaseEmail(emailData);
    console.log("Email sent: " + emailSent);

    // ── STEP 6: SEND TELEGRAM BRIEF ─────────────────────────
    const refId = "VMW-" + mobile.replace(/\D/g,"").slice(-4);

    // Brief summary for Telegram
    const telegramBrief = `✅ NEW CASE READY
━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${refId} | ${isPartnerCase ? "Partner Case" : "Direct Case"}

👤 ${name} | Age: ${age}
💼 ${loanType} | ${loanAmount}
🏙️ 🏙️ ${city}${data.state ? ", " + data.state : ""}
💰 Income: ${monthlyIncome}
📊 CIBIL: ${cibilScore}
💳 EMIs: ${existingEMI}
🔄 Bounces: ${bounces}
📱 Call: ${mobile}

📋 Docs: ${docsReceived.length > 0 ? docsReceived.join(", ") : "Pending"}
📧 Case email sent${emailSent ? " ✅" : " ❌"}
${lenderText}
👉 Review and call customer immediately!`;

    // Send Telegram in chunks if needed
    if (telegramBrief.length > 3800) {
      const chunks = [];
      let remaining = telegramBrief;
      while (remaining.length > 0) {
        chunks.push(remaining.substring(0, 3800));
        remaining = remaining.substring(3800);
      }
      for (const chunk of chunks) {
        await tg(chatId, chunk);
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      await tg(chatId, telegramBrief);
    }
// ── DSA ALLOCATION BUTTONS ───────────────────────────
    var dsaKeyboard = {
      inline_keyboard: [
        [
          {text:"My Mudra",    callback_data:"case_assign|"+mobile.replace(/\D/g,"")+"|My Mudra"},
          {text:"RU Loans",    callback_data:"case_assign|"+mobile.replace(/\D/g,"")+"|RU Loans"}
        ],
        [
          {text:"Andromeda",   callback_data:"case_assign|"+mobile.replace(/\D/g,"")+"|Andromeda"},
          {text:"Urban Money", callback_data:"case_assign|"+mobile.replace(/\D/g,"")+"|Urban Money"}
        ],
        [
          {text:"⚙️ Manual Decision", callback_data:"case_assign|"+mobile.replace(/\D/g,"")+"|Manual Decision"}
        ]
      ]
    };
    await fetch(`${TG}/sendMessage`, {
      method :"POST",
      headers:{"Content-Type":"application/json"},
      body   :JSON.stringify({
        chat_id     : chatId,
        text        : "📋 " + name + " | " + loanType + " | " + loanAmount + "\nSelect DSA to allocate ↓",
        reply_markup: dsaKeyboard
      })
    });

    console.log(`✅ Case summary complete: ${name}`);

  } catch(err) {
    console.error("case-summary error:", err.message);
    try {
      const chatId = process.env.CHAT_ID || "1471849538";
      await tg(chatId, `❌ Case summary error for ${req.body.name || "Unknown"}!\nError: ${err.message}\nPlease review manually.`);
    } catch(e) {}
  }
});

// ============================================================
// ANALYZE PORTAL — Banking Portal submissions
// ============================================================
app.post("/analyze-portal", async (req, res) => {
  res.json({success: true, message: "Analysis started"});

  try {
    const data     = req.body;
    const name     = data.name     || "Unknown";
    const mobile   = data.mobile   || "";
    const loanType = data.loanType || "Personal Loan";
    const empType  = data.empType  || "Salaried";
    const cibil    = data.cibil    || "Not Checked";
    const income   = data.income   || "";
    const isAdmin  = data.isAdmin  || false;
    const chatId   = process.env.CHAT_ID || "1471849538";

    console.log(`Portal analysis started: ${name} | ${loanType} | ${mobile}`);
    console.log(`Bank password: "${data.bankPassword || "NOT RECEIVED"}"`);

    await tg(chatId, `⏳ AI analyzing documents for ${name}...\nLoan: ${loanType}\nPlease wait 30-60 seconds!`);

    const content      = [];
    const docKeys      = ["file_pan","file_aadhar","file_salary1","file_bankSal","file_itr1","file_extra1","file_extra2","file_extra3"];
    const docNames     = ["PAN Card","Aadhar Card","Salary Slip","Bank Statement","ITR","Document 1","Document 2","Document 3"];
    let   docCount     = 0;
    const docsReceived = [];

    for (let i = 0; i < docKeys.length; i++) {
      const b64 = data[docKeys[i]];
      if (!b64 || b64.length < 10) continue;
      try {
        const isPDF  = b64.startsWith("PDF:");
        const rawB64 = isPDF ? b64.replace("PDF:", "") : b64;
        let mimeType = "image/jpeg";
        if (isPDF) mimeType = "application/pdf";
        else if (rawB64.startsWith("iVBOR")) mimeType = "image/png";
        else if (rawB64.startsWith("/9j/")) mimeType = "image/jpeg";

        if (isPDF) {
          content.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:rawB64}});
        } else {
          content.push({type:"image", source:{type:"base64", media_type:mimeType, data:rawB64}});
        }
        docCount++;
        docsReceived.push(docNames[i]);
        console.log(`Loaded: ${docNames[i]} | mime: ${mimeType} | size: ${rawB64.length}`);
      } catch(e) { console.error(`Doc error ${docNames[i]}: ${e.message}`); }
    }

    console.log(`Total docs loaded: ${docCount} | ${docsReceived.join(", ")}`);

    if (docCount === 0) {
      await tg(chatId, `⚠️ No readable documents found for ${name}!\nPlease check uploads and retry.`);
      return;
    }

    const lt        = loanType.toUpperCase();
    const isHL      = lt.includes("HOME");
    const isLAP     = lt.includes("PROPERTY") || lt.includes("AGAINST");
    const isSecured = isHL || isLAP;

    let prompt = `You are an expert Indian loan underwriter for VastMyWealth Advisory.\n\n`;
    prompt += `Analyze ${docCount} documents for: ${name}\n`;
    prompt += `Loan Type: ${loanType}\n`;
    prompt += `Employment: ${empType}\n`;
    prompt += `CIBIL Declared: ${cibil}\n`;
    if (income) prompt += `Declared Income: ${income}\n`;
    prompt += `\nEXTRACT AND ANALYZE:\n`;
    prompt += `1. Name from PAN card\n`;
    prompt += `2. Customer type — Salaried or Self Employed\n`;
    prompt += `3. Loan amount if mentioned\n`;
    prompt += `4. Salary credit amount (if salaried) OR average bank balance (if self employed)\n`;
    prompt += `5. Existing EMIs from bank statement\n`;
    prompt += `6. List of documents uploaded\n`;
    prompt += `7. Any red flags\n`;
    if (isSecured) prompt += `8. Property type (MCGM/GP/SRA/MHADA/CHS) if docs available\n`;
    prompt += `\nFORMAT AS TWO SECTIONS:\n\n`;
    prompt += `SECTION 1 — TELEGRAM BRIEF:\n`;
    prompt += `👤 [Name] | [Salaried/Self Employed]\n`;
    prompt += `🏠 Loan: ${loanType} | Amount: ₹[amount or N/A]\n`;
    prompt += `📊 CIBIL: ${cibil}\n`;
    prompt += `💰 ${empType === "Salaried" ? "Salary Credit" : "Avg Bank Balance"}: ₹[amount]\n`;
    prompt += `💳 Existing EMIs: ₹[amount or None]\n`;
    if (isSecured) prompt += `🏠 Property: [type] | Risk: [LOW/MED/HIGH]\n`;
    prompt += `⚠️ Red Flags: [None or list]\n`;
    prompt += `📋 Docs: ${docsReceived.join(", ")}\n\n`;
    prompt += `---DSA_PROFILE_START---\n\n`;
    prompt += `SECTION 2 — DSA EMAIL BODY:\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `🏦 VASTMYWEALTH ADVISORY\n   LOAN APPLICATION\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    prompt += `👤 APPLICANT\nName: [from PAN]\nCustomer Type: ${empType}\n\n`;
    prompt += `🏦 LOAN REQUIREMENT\nType: ${loanType}\nAmount: ₹[if mentioned, else N/A]\n\n`;
    prompt += `💰 FINANCIAL SUMMARY\nCredit Score (Self Declared): ${cibil}\n`;
    prompt += `${empType === "Salaried" ? "Monthly Salary Credit" : "Average Bank Balance"}: ₹[amount]\n`;
    prompt += `Existing EMIs: ₹[amount or None]\n\n`;
    prompt += `📋 DOCUMENTS AVAILABLE\n`;
    docsReceived.forEach(d => { prompt += `✅ ${d}\n`; });
    prompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\nVastMyWealth Advisory | Manoj: 9594592020\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    prompt += `---DSA_PROFILE_END---\n\nIMPORTANT: Extract figures from documents only. Write N/A if not available.`;

    content.push({type:"text", text:prompt});

    console.log(`Calling Claude with ${content.length} content items...`);
    const aiRes = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1500, messages:[{role:"user", content}]})
    });

    let result = await aiRes.json();
    console.log("Claude API status:", aiRes.status);
    console.log("Claude response:", JSON.stringify(result).substring(0,300));

    // Handle password protected PDF
    if (result.error && result.error.message && result.error.message.includes("password protected")) {
      const password = data.bankPassword || "";
      if (!password) {
        await tg(chatId, `⚠️ Bank statement is password protected!\nPlease enter password in portal and retry.`);
        return;
      }
      console.log("Attempting ilovepdf unlock...");
      const unlocked = await unlockPDF(data.file_bankSal, password);
      if (!unlocked) {
        await tg(chatId, `⚠️ Could not unlock!\nPlease check password and retry.`);
        return;
      }
      console.log("PDF unlocked! Retrying Claude...");
      for (let i = 0; i < content.length; i++) {
        if (content[i].type === "document") {
          content[i] = {type:"document", source:{type:"base64", media_type:"application/pdf", data:unlocked.replace("PDF:","")}};
          break;
        }
      }
      const retryRes = await fetch(AI, {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
        body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1500, messages:[{role:"user", content}]})
      });
      result = await retryRes.json();
      console.log("Retry status:", retryRes.status);
    }

    if (result.error && result.error.message && result.error.message.includes("100 PDF pages")) {
      await tg(chatId, `⚠️ Bank statement has too many pages!\nPlease upload last 6 months only (max 100 pages).\nUse ilovepdf.com to split the PDF.`);
      return;
    }

    if (!result.content || !result.content[0]) {
      await tg(chatId, `❌ AI analysis failed for ${name}!\nError: ${JSON.stringify(result).substring(0,200)}\nPlease retry or review manually.`);
      return;
    }

    const fullText   = result.content[0].text;
    const parts      = fullText.split("---DSA_PROFILE_START---");
    const briefText  = parts[0].trim();
    const dsaProfile = parts.length > 1 ? parts[1].replace("---DSA_PROFILE_END---","").trim() : "";
    const telegramMsg = briefText.length > 20 ? briefText : fullText.substring(0, 3000);

    // Save profile to Master Sheet
    if (APPS_SCRIPT && mobile) {
      try {
        const cleanMobile = mobile.replace(/\D/g,"").slice(-10);
        const profileText = (dsaProfile || fullText).substring(0, 1500);
        const saveUrl = APPS_SCRIPT + "?action=saveProfile&mobile=" + encodeURIComponent(cleanMobile) + "&profile=" + encodeURIComponent(profileText);
        const saveRes    = await fetch(saveUrl);
        const saveResult = await saveRes.json();
        console.log("saveProfile response:", JSON.stringify(saveResult));
      } catch(e) { console.error("Save profile error:", e.message); }
    }

    const refId = "VMW-" + mobile.slice(-4);
    const msgToSend = `✅ AI ANALYSIS COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 ${refId} | ${isAdmin ? "Admin Upload" : "Customer Upload"}\n\n${telegramMsg}\n\n👉 Review in CRM before allocating DSA`;

    if (msgToSend.length > 3800) {
      const chunks = [];
      let remaining = msgToSend;
      while (remaining.length > 0) { chunks.push(remaining.substring(0, 3800)); remaining = remaining.substring(3800); }
      for (const chunk of chunks) { await tg(chatId, chunk); await new Promise(r => setTimeout(r, 500)); }
    } else {
      await tg(chatId, msgToSend);
    }

    console.log(`✅ Portal analysis complete: ${name}`);

  } catch(err) {
    console.error("analyze-portal error:", err.message);
    try {
      await tg(process.env.CHAT_ID || "1471849538", `❌ Analysis error for portal submission!\nError: ${err.message}\nPlease review manually in CRM.`);
    } catch(e) {}
  }
});

// ============================================================
// TELEGRAM BOT WEBHOOK
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.callback_query) {
      const cb     = body.callback_query;
      const chatId = cb.message.chat.id;
      const msgId  = cb.message.message_id;
      const data   = cb.data;

      await answerCallback(cb.id);
      await removeButtons(chatId, msgId);

      if (data.startsWith("loan_")) {
        const code = data.replace("loan_", "");
        const name = LOANS[code];
        if (!name) { await tg(chatId, "❌ Invalid loan type!"); return; }
        saveSession(chatId, {code, name, docs:[], ids:[], cibil:"", status:"uploading"});
        await tg(chatId, `✅ ${name} selected!\n\n📁 Forward all documents now:\n• PAN Card\n• Aadhar Card\n• Bank Statement(s)\n• Salary Slips / ITR\n• GST (if applicable)\n• Loan statement (if BT)\n\nType ANALYZE when all uploaded!`);
        await showMainMenu(chatId);
        return;
      }

      if (data.startsWith("cibil_")) {
        const s = getSession(chatId);
        if (!s) { await tg(chatId, "❌ Session expired! Type HELP to restart."); await showMainMenu(chatId); return; }
        s.cibil  = CIBIL_MAP[data.replace("cibil_", "")] || "Not Checked";
        s.status = "analyzing";
        saveSession(chatId, s);
        await tg(chatId, `⏳ Analyzing ${s.docs.length} documents...\nPlease wait 30-60 seconds!`);
        await runAnalysis(chatId, s);
        return;
      }
      return;
    }

    const msg = body.message;
    if (!msg) return;
    const chatId = msg.chat.id;

    if (msg.document || msg.photo) {
      const s = getSession(chatId);
      if (!s) { await tg(chatId, "❌ No active session!\nType HELP to start first."); return; }
      if (s.status === "analyzing" || s.status === "analyzed") return;

      let fileId   = "";
      let fileName = `Doc_${s.docs.length + 1}`;

      if (msg.document) { fileId = msg.document.file_id; fileName = msg.document.file_name || fileName; }
      else if (msg.photo) { fileId = msg.photo[msg.photo.length - 1].file_id; fileName = `Photo_${s.docs.length + 1}.jpg`; }

      s.docs.push(fileName);
      s.ids.push(fileId);
      saveSession(chatId, s);

      const count = s.docs.length;
      if (count === 1) { await tg(chatId, "📁 First document received!\nKeep sending more.\nType ANALYZE when all uploaded."); }
      else if (count === 5) { await tg(chatId, `📁 ${count} documents received.\nSend more or type ANALYZE.`); }
      else if (count % 10 === 0) { await tg(chatId, `📁 ${count} documents received.\nType ANALYZE when done.`); }
      return;
    }

    const text = (msg.text || "").trim();
    if (!text) return;

    const cmd = text.toUpperCase()
      .replace("📊 ", "").replace("📋 ", "").replace("💡 ", "").replace("📤 ", "")
      .replace("🔍 ", "").replace("📄 ", "").replace("🔄 ", "").replace("🏠 NEW LOAN", "HELP")
      .replace(/^\//, "").split("@")[0].trim();

    console.log(`📩 Chat ${chatId}: "${cmd}"`);

    if (cmd === "HELP" || cmd === "START") { await showLoanMenu(chatId); return; }

    if (cmd.startsWith("NEW ")) {
      const code = cmd.replace("NEW ", "").trim();
      const name = LOANS[code];
      if (!name) { await tg(chatId, "❌ Invalid!\nUse: NEW PL / NEW HL / NEW BL / NEW LAP\nor type HELP for buttons!"); return; }
      saveSession(chatId, {code, name, docs:[], ids:[], cibil:"", status:"uploading"});
      await tg(chatId, `✅ ${name} started!\n\nUpload all documents now.\nType ANALYZE when done!`);
      await showMainMenu(chatId);
      return;
    }

    if (cmd === "ANALYZE") {
      const s = getSession(chatId);
      if (!s) { await tg(chatId, "❌ No active session!\nType HELP to start."); return; }
      if (s.docs.length === 0) { await tg(chatId, "❌ No documents uploaded yet!"); return; }
      s.status = "waiting_cibil";
      saveSession(chatId, s);
      await showCibilMenu(chatId);
      return;
    }

    if (cmd === "STATUS") {
      const s = getSession(chatId);
      if (!s) { await tg(chatId, "❌ No active session!"); return; }
      await tg(chatId, `📊 CURRENT SESSION\n━━━━━━━━━━━━━━━━━━\nLoan : ${s.name}\nDocs : ${s.docs.length} uploaded\n\n` + s.docs.map((d,i) => `${i+1}. ${d}`).join("\n") + `\n\nType ANALYZE when ready!`);
      await showMainMenu(chatId);
      return;
    }

    if (cmd === "MISSING") { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!"); return; } await showMissing(chatId, s); return; }
    if (cmd === "IMPROVE") { const s = getSession(chatId); if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; } await showImprove(chatId, s); return; }
    if (cmd === "PROFILE") { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!\nType HELP to start."); return; } await generateProfile(chatId, s); return; }
    if (cmd === "CLASSIFY") { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!\nType HELP to start."); return; } if (s.docs.length === 0) { await tg(chatId, "❌ No documents uploaded!\nUpload documents first."); return; } await classifyDocuments(chatId, s); return; }
    if (cmd === "SUBMIT") { const s = getSession(chatId); if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; } await submitReport(chatId, s); return; }

    if (cmd === "RESET") {
      clearSession(chatId);
      delete CLASSIFY_PENDING[chatId];
      await tg(chatId, "🔄 Session cleared!\nType HELP to start new analysis.");
      await showMainMenu(chatId);
      return;
    }

    if (CLASSIFY_PENDING[chatId]) {
      const p   = CLASSIFY_PENDING[chatId];
      const idx = p.currentIndex;
      if (cmd === "YES" || cmd === "Y") { p.currentIndex++; await classifyNext(chatId); }
      else { p.classifications[idx] = text.trim(); await tg(chatId, "✅ Updated to: " + text.trim()); p.currentIndex++; await classifyNext(chatId); }
      return;
    }

    if (cmd === "REMOVE") {
      const s = getSession(chatId);
      if (!s || s.docs.length === 0) { await tg(chatId, "❌ No documents to remove!"); return; }
      const removed = s.docs.pop();
      s.ids.pop();
      saveSession(chatId, s);
      await tg(chatId, `🗑️ Removed: ${removed}\nRemaining: ${s.docs.length} docs\n\nUpload correct document and type ANALYZE!`);
      await showMainMenu(chatId);
      return;
    }

    const s = getSession(chatId);
    if (s && text && !cmd.match(/^(HELP|START|ANALYZE|MISSING|IMPROVE|PROFILE|CLASSIFY|SUBMIT|RESET|REMOVE|STATUS|NEW)$/)) {
      if (text.toLowerCase().includes("additional strength") || text.toLowerCase().includes("strength:") || text.toLowerCase().includes("strong point")) {
        s.additionalStrengths = text;
        saveSession(chatId, s);
        await tg(chatId, "✅ Additional strengths saved!\nType PROFILE to generate updated report.");
      } else {
        s.customInstruction = text;
        saveSession(chatId, s);
        await tg(chatId, "✅ Instruction saved: " + text.substring(0,100) + "\n\nType ANALYZE to analyze with this instruction\nOr PROFILE to regenerate profile with corrections!");
      }
      await showMainMenu(chatId);
      return;
    }

    await tg(chatId, "❓ Unknown command!\nType HELP to see options.");
    await showMainMenu(chatId);

  } catch(err) {
    console.error("Webhook error:", err.message);
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/", (req, res) => {
  res.json({
    status : "✅ VMW AI Analyzer v5 Running",
    version: "v5",
    time   : new Date().toISOString()
  });
});

// ============================================================
// SETUP WEBHOOK
// ============================================================
app.get("/setup", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({error: "Provide ?url=YOUR_RENDER_URL/webhook"});
  const response = await fetch(`${TG}/setWebhook?url=${encodeURIComponent(url)}&drop_pending_updates=true`);
  const data = await response.json();
  res.json(data);
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 VMW AI Analyzer v5 running on port ${PORT}`);
});

