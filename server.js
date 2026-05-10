// ============================================================
// VMW AI Loan Analyzer — Render.com Node.js Server v6
// Professional Case Brief + Email + DSA Buttons
// Updated: May 2026
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
const CHAT_ID       = process.env.CHAT_ID || "1471849538";
const TG            = `https://api.telegram.org/bot${BOT_TOKEN}`;
const AI            = "https://api.anthropic.com/v1/messages";
const ADMIN_EMAIL   = "venkateshmanojp@gmail.com";
const MANOJ_MOBILE  = "9594592020";

// ============================================================
// LOAN TYPES — Telegram Bot
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
// SESSION STORE — Telegram Bot
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
      body   : JSON.stringify({chat_id: chatId, text: text, reply_markup: {inline_keyboard: keyboard}})
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
  } catch(e) {}
}

async function answerCallback(callbackId, text) {
  try {
    await fetch(`${TG}/answerCallbackQuery`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({callback_query_id: callbackId, text: text || "", show_alert: false})
    });
  } catch(e) {}
}

async function removeButtons(chatId, messageId) {
  try {
    await fetch(`${TG}/editMessageReplyMarkup`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard: []}})
    });
  } catch(e) {}
}

async function editMessageText(chatId, messageId, newText) {
  try {
    await fetch(`${TG}/editMessageText`, {
      method : "POST",
      headers: {"Content-Type": "application/json"},
      body   : JSON.stringify({chat_id: chatId, message_id: messageId, text: newText})
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
// BUILD AI PROMPT — Telegram Bot Analysis
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
  if (s.customInstruction) p += `SPECIAL INSTRUCTIONS:\n${s.customInstruction}\n\n`;

  p += `ANALYZE AND PROVIDE:\n`;
  p += `1. Extract client name and DOB/Age from PAN card\n`;
  p += `2. Verify name consistency across documents\n`;
  p += `3. Analyze income from salary slips/ITR/bank credits\n`;
  p += `4. Check bank statement for bounces, EMIs\n`;
  p += `5. Calculate FOIR\n`;
  p += `6. Compare declared CIBIL with banking behavior\n`;
  if (!isPL) p += `7. Check co-applicant documents if present\n`;
  if (isBL || isLAP) p += `8. Verify GST/Udyam name matches bank account\n`;
  if (isSecured) {
    p += `9. PROPERTY: Identify type (MCGM/GP/SRA/MHADA/CHS), assess risk LOW/MEDIUM/HIGH\n`;
  }

  p += `\nFORMAT RESPONSE AS:\n\n`;
  p += `🤖 VMW AI LOAN ANALYSIS\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  p += `Loan: ${s.name} | CIBIL: ${s.cibil} | Docs: ${docCount}\n\n`;
  p += `👤 CLIENT\nName: [from docs] | Age: [from PAN] | Employment: [type]\n\n`;
  p += `💰 INCOME & METRICS\n`;
  p += `Monthly Income: [amount] | Existing EMIs: [amount]\n`;
  p += `FOIR Current: [%] | FOIR Post Loan: [%] | Max EMI: [amount]\n\n`;
  if (isSecured) p += `🏠 PROPERTY\nType: [type] | Risk: [LOW/MED/HIGH]\n\n`;
  p += `🔍 CHECKS\nName: [✅/❌] | Bounces: [None/count] | Fraud: [LOW/MED/HIGH]\n\n`;
  p += `❌ MISSING: [list]\n\n`;
  p += `📊 PROBABILITY: [X]% | ✅ [PROCEED/MORE DOCS/REJECT]\n━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return p;
}

// ============================================================
// BUILD PROFILE PROMPT
// ============================================================
function buildProfilePrompt(s) {
  const isSecured = s.code === "HL" || s.code === "HLBT" || s.code === "HLTU" ||
                    s.code === "LAP" || s.code === "LAPBT";
  const today     = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"});
  let purpose = "Fresh Purchase";
  if (s.code.includes("BT") && s.code.includes("TU")) purpose = "Balance Transfer + Top Up";
  else if (s.code.includes("BT")) purpose = "Balance Transfer";
  else if (s.code.includes("TU")) purpose = "Top Up";

  let p = `You are preparing a professional loan applicant profile for VastMyWealth Advisory.\n\n`;
  p += `ANALYSIS DATA:\n${s.analysis}\n\n`;
  if (s.customInstruction) p += `CORRECTIONS FROM RM:\n${s.customInstruction}\n\n`;
  if (s.additionalStrengths) p += `ADDITIONAL STRENGTHS:\n${s.additionalStrengths}\n\n`;

  p += `EMPLOYER TIER: Tier 1=Govt/PSU/MNC/Listed | Tier 2=Mid-size Private | Tier 3=Small/Startup\n`;
  p += `CITY TIER: Metro=Mumbai/Delhi/Bangalore/Chennai/Hyderabad/Kolkata/Pune/Ahmedabad\n\n`;

  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n🏦 VASTMYWEALTH ADVISORY\n   LOAN APPLICANT PROFILE\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  p += `👤 APPLICANT\nName: [name] | Age: [age] (DOB: [date])\nAge at Loan End: [age+tenure]\n`;
  p += `Employment: [type] | Company: [name] ([Tier])\nExperience: [years] | City: [city]\n\n`;
  p += `💰 FINANCIAL SUMMARY\nSalary Bank: [bank] | Monthly Income: ₹[amount]\n`;
  p += `CIBIL: [score] | Bounces: [None/count]\n\n`;
  p += `📊 OBLIGATIONS\nTotal EMIs: ₹[amount] | FOIR: [%] | Max EMI Capacity: ₹[amount]\n\n`;
  if (isSecured) p += `🏠 PROPERTY\nType: [type] | Risk: [LOW/MED/HIGH] | LTV: [%]\n\n`;
  p += `🏦 LOAN REQUIREMENT\nType: [type] | Purpose: ${purpose}\nAmount: ₹[amount] | Tenure: [years]\n\n`;
  p += `⭐ STRENGTHS\n[List genuine strengths]\n\n`;
  p += `📋 DOCUMENTS VERIFIED\n[List with ✅]\n\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\nPrepared by: VastMyWealth Advisory | ${today}\n━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return p;
}

// ============================================================
// RUN AI ANALYSIS — Telegram Bot
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
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:2000, messages:[{role:"user", content}]})
    });
    const result = await aiRes.json();

    if (result.error && result.error.message && result.error.message.includes("100 PDF pages")) {
      await tg(chatId, "⚠️ Document too many pages!\nPlease send only last 6 months.\nType REMOVE to delete and upload shorter version!");
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
        let chunk = ""; const chunks = [];
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
const ILOVEPDF_PUBLIC  = process.env.ILOVEPDF_PUBLIC;
const CLASSIFY_PENDING = {};

async function classifyDocuments(chatId, s) {
  try {
    if (s.docs.length === 0) { await tg(chatId, "❌ No documents uploaded!\nUpload documents first."); return; }
    await tg(chatId, "🔍 Starting classification...\nTotal: " + s.docs.length + " documents\nPlease wait...");
    CLASSIFY_PENDING[chatId] = {
      ids: s.ids.slice(), names: s.docs.slice(),
      classifications: new Array(s.ids.length).fill(null), currentIndex: 0
    };
    await classifyNext(chatId);
  } catch(err) {
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
      const res = await fetch(AI, {
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
      form.append("caption", "📄 Document " + (idx+1) + " of " + p.ids.length + "\n━━━━━━━━━━━━━━━━━━\n🤖 I think this is: " + docType + "\n\nReply YES if correct\nOr tell me what it is");
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
  } catch(e) { await tg(chatId, "❌ ilovepdf auth failed!"); delete CLASSIFY_PENDING[chatId]; await showMainMenu(chatId); return; }
  if (!token) { await tg(chatId, "❌ Could not authenticate with ilovepdf!"); delete CLASSIFY_PENDING[chatId]; await showMainMenu(chatId); return; }

  let successCount = 0;
  for (const docType in groups) {
    const fileIds = groups[docType];
    try {
      const taskRes  = await fetch("https://api.ilovepdf.com/v1/start/imagepdf", {method:"GET", headers:{"Authorization":"Bearer " + token}});
      const taskData = await taskRes.json();
      const server   = taskData.server; const taskId = taskData.task;
      if (!server || !taskId) continue;
      const serverFiles = [];
      for (let i = 0; i < fileIds.length; i++) {
        const file = await downloadFile(fileIds[i]);
        if (!file) continue;
        const FD = require("form-data"); const form = new FD();
        const ext = file.mimeType === "application/pdf" ? ".pdf" : ".jpg";
        form.append("file", file.buffer, {filename:"doc_"+(i+1)+ext, contentType:file.mimeType});
        const ur = await fetch("https://"+server+"/v1/upload", {method:"POST", headers:{"Authorization":"Bearer "+token,...form.getHeaders()}, body:form});
        const ud = await ur.json();
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
      const TF  = require("form-data"); const tf = new TF();
      tf.append("chat_id", chatId);
      tf.append("caption", "📄 " + docType + " (" + fileIds.length + " page" + (fileIds.length>1?"s":"") + ")");
      tf.append("document", buf, {filename:safeName+".pdf", contentType:"application/pdf"});
      await fetch(TG+"/sendDocument", {method:"POST", headers:tf.getHeaders(), body:tf});
      successCount++;
      await new Promise(r => setTimeout(r, 500));
    } catch(err) { await tg(chatId, "⚠️ Could not create PDF for: " + docType); }
  }
  await tg(chatId, "🎉 DONE!\n━━━━━━━━━━━━━━━━━━\n✅ " + successCount + " PDF(s) created!\n\nForward these to the lender directly!");
  delete CLASSIFY_PENDING[chatId];
  await showMainMenu(chatId);
}

// ============================================================
// GENERATE PROFILE ONE-PAGER
// ============================================================
async function generateProfile(chatId, s) {
  try {
    if (!s.analysis) { await tg(chatId, "❌ Please run ANALYZE first!"); await showMainMenu(chatId); return; }
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
        const lines = profile.split("\n"); let chunk = ""; const chunks = [];
        for (const line of lines) {
          if ((chunk + "\n" + line).length > 3800) { chunks.push(chunk); chunk = line; }
          else { chunk = chunk ? chunk + "\n" + line : line; }
        }
        if (chunk) chunks.push(chunk);
        for (const c of chunks) await tg(chatId, c);
      } else { await tg(chatId, profile); }
      await tg(chatId, "📋 Profile generated!\n\nTo update:\n• Type corrections e.g. 'Income is 95000 not 85000'\n• Then type PROFILE again ✅");
    } else { await tg(chatId, "❌ Profile generation failed!"); }
    await showMainMenu(chatId);
  } catch(err) { await tg(chatId, "❌ Profile error: " + err.message); await showMainMenu(chatId); }
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
        messages:[{role:"user", content:"Based on this loan analysis:\n\n" + s.analysis + "\n\nProvide 5 specific actions to improve approval probability.\nFormat:\n💡 HOW TO IMPROVE\n1. [action] — +[X]%\n..."}]
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
    if (!token) return null;
    const taskRes  = await fetch("https://api.ilovepdf.com/v1/start/unlock", {method:"GET", headers:{"Authorization":"Bearer " + token}});
    const taskData = await taskRes.json();
    const server   = taskData.server; const taskId = taskData.task;
    if (!server || !taskId) return null;
    const rawB64   = b64.startsWith("PDF:") ? b64.replace("PDF:","") : b64;
    const buffer   = Buffer.from(rawB64, "base64");
    const FormData = require("form-data"); const form = new FormData();
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
    return "PDF:" + pdfBuffer.toString("base64");
  } catch(e) { console.error("unlockPDF error:", e.message); return null; }
}

// ============================================================
// SEND EMAIL VIA APPS SCRIPT
// ============================================================
async function sendEmail(to, subject, body, mobile, name) {
  try {
    if (!APPS_SCRIPT) {
      console.error("APPS_SCRIPT not set!");
      return false;
    }
    const url = APPS_SCRIPT +
      "?action=sendCaseEmail" +
      "&to="      + encodeURIComponent(to || ADMIN_EMAIL) +
      "&subject=" + encodeURIComponent(subject || "") +
      "&body="    + encodeURIComponent((body || "").substring(0, 5000)) +
      "&mobile="  + encodeURIComponent(mobile || "") +
      "&name="    + encodeURIComponent(name || "");

    console.log("Sending email via:", url.substring(0, 100));

    const res  = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    console.log("Email response:", text.substring(0, 200));

    // Check if success
    if (text.includes('"success":true')) return true;
    if (text.includes("success")) return true;
    return false;

  } catch(e) {
    console.error("sendEmail error:", e.message);
    return false;
  }
}

// ============================================================
// ============================================================
// CASE SUMMARY ENDPOINT — WhatsApp Bot
// ============================================================
app.post("/case-summary", async (req, res) => {
  res.json({ success: true, message: "Case summary generation started" });

  try {
    const data           = req.body;
    const name           = data.name           || "Unknown";
    const mobile         = data.mobile         || "";
    const loanType       = data.loanType       || "Unknown";
    const loanAmount     = data.loanAmount     || "Not mentioned";
    const city           = data.city           || "Not mentioned";
    const state          = data.state          || "";
    const age            = data.age            || "Not mentioned";
    const employmentType = data.employmentType || "Not mentioned";
    const monthlyIncome  = data.monthlyIncome  || "Not mentioned";
    const cibilScore     = data.cibilScore     || "Not mentioned";
    const existingEMI    = data.existingEMI    || "None";
    const bounces        = data.bounces        || "None";
    const companyName    = data.companyName    || "Not mentioned";
    const workExperience = data.workExperience || "Not mentioned";
    const businessVintage= data.businessVintage|| "Not mentioned";
    const propertyDetails= data.propertyDetails|| "Not applicable";
    const coApplicant    = data.coApplicant    || "None";
    const callbackDate   = data.callbackDate   || "To be confirmed";
    const callbackTime   = data.callbackTime   || "To be confirmed";
    const specialistName = data.specialistName || "Rahul";
    const isPartnerCase  = data.isPartnerCase  || false;
    const partnerCode    = data.partnerCode    || "";
    const conversationSummary = data.conversationSummary || "";
    const cityState      = state ? city + ", " + state : city;

    console.log(`Case summary started: ${name} | ${loanType} | ${mobile}`);

    // Notify Telegram processing started
    await tg(CHAT_ID, `⏳ Preparing case file for ${name}...\nLoan: ${loanType}\nSpecialist: ${specialistName}`);

    // ── GENERATE PROFESSIONAL CASE BRIEF ────────────────
    const today   = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"long", year:"numeric"});
    const lt      = loanType.toUpperCase();
    const isHL    = lt.includes("HOME");
    const isLAP   = lt.includes("PROPERTY") || lt.includes("AGAINST") || lt.includes("LAP");
    const isBL    = lt.includes("BUSINESS");
    const isPL    = lt.includes("PERSONAL");
    const isCF    = lt.includes("CONSTRUCTION");
    const isBT    = lt.includes("BALANCE") || lt.includes("TRANSFER");
    const isSecured = isHL || isLAP;

    // Calculate FOIR
    let foirText = "N/A";
    try {
      const income = parseFloat(String(monthlyIncome).replace(/[^0-9.]/g, ""));
      const emi    = parseFloat(String(existingEMI).replace(/[^0-9.]/g, ""));
      if (income > 0 && emi >= 0) {
        const foir = Math.round((emi / income) * 100);
        foirText   = foir + "% " + (foir <= 40 ? "✅" : foir <= 50 ? "⚠️" : "❌");
      }
    } catch(e) {}

    // Calculate age at loan end (assuming 20yr tenure default)
    let ageAtEnd = "N/A";
    try {
      const ageNum    = parseInt(String(age).replace(/[^0-9]/g, ""));
      if (ageNum > 0) ageAtEnd = (ageNum + 20) + " years (20yr tenure)";
    } catch(e) {}

    const casePrompt = `You are a senior credit manager at VastMyWealth Advisory preparing a professional case note for a banker/lender.

Write a clear banker-friendly case note based on the customer details below.
Write like a human credit manager — NOT a data dump.
Use the style of the sample case note provided.
Be concise but comprehensive. Banker should read in 2 minutes.

CUSTOMER DETAILS COLLECTED BY ${specialistName}:
Name: ${name}
Age: ${age}
Loan Type: ${loanType}${isBT ? " (Balance Transfer)" : ""}
Loan Amount Required: ${loanAmount}
Location: ${cityState}
Employment: ${employmentType}
Company/Business: ${companyName}
Experience/Vintage: ${employmentType.toLowerCase().includes("self") ? businessVintage : workExperience}
Monthly Income: ${monthlyIncome}
CIBIL Score: ${cibilScore}
Existing EMIs: ${existingEMI}
FOIR: ${foirText}
Age at Loan End: ${ageAtEnd}
Cheque/ECS Bounces: ${bounces}
Co-Applicant: ${coApplicant}
Property Details: ${propertyDetails}
${isPartnerCase ? "Partner Code: " + partnerCode : "Direct Lead"}

CONVERSATION SUMMARY:
${conversationSummary}

Write the case note in this exact format:

CASE: ${loanType.toUpperCase()} — ${loanAmount}${isBT ? " (BALANCE TRANSFER)" : ""}

APPLICANT PROFILE:
• ${name}, Age ${age}
• ${employmentType} — ${companyName}
• [Comment on employment stability — e.g. "Stable employment with 8+ years experience"]

${coApplicant && coApplicant !== "None" ? `CO-APPLICANT:
• ${coApplicant}
• [Income and relationship if available]

` : ""}LOCATION:
• ${cityState}

INCOME DETAILS:
• Monthly Income: ${monthlyIncome}
• Existing EMI Obligations: ${existingEMI}
• FOIR: ${foirText}
• [Comment on income stability]

BANKING & CREDIT:
• CIBIL Score: ${cibilScore}
• Cheque/ECS Bounces: ${bounces}
• [Comment on credit behavior]

${isSecured ? `PROPERTY DETAILS:
• ${propertyDetails}
• [Property type and risk comment]

` : ""}LOAN REQUIREMENT:
• Type: ${loanType}${isBT ? " — Balance Transfer" : ""}
• Amount: ${loanAmount}
• Purpose: [Derive from context]
• Tenure: Up to 20 years preferred

CALLBACK SCHEDULED:
• Date: ${callbackDate}
• Time: ${callbackTime}
• RM: Manoj — ${MANOJ_MOBILE}

STRENGTHS:
• [List 3-5 genuine strengths based on profile]

${String(cibilScore).match(/65[0-9]|6[0-4][0-9]/) ? `CONCERNS:
• CIBIL borderline — recommend lenders with flexible criteria
` : ""}NOTE:
[2-3 line summary — why this case should be considered and recommended approach]

━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared by: ${specialistName} — VastMyWealth Advisory
Date: ${today}
━━━━━━━━━━━━━━━━━━━━━━━━━

RULES:
1. Write like a human banker — simple clear professional language
2. No technical jargon
3. If data not available write "To be confirmed"
4. Highlight genuine strengths
5. Keep total length reasonable
6. Do NOT include raw data dump — write analysis`;

    const caseRes = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({
        model     : "claude-haiku-4-5",
        max_tokens: 2000,
        messages  : [{role:"user", content: casePrompt}]
      })
    });

    const caseResult = await caseRes.json();
    if (!caseResult.content || !caseResult.content[0]) {
      await tg(CHAT_ID, `❌ Case summary generation failed for ${name}!\nPlease review manually.`);
      return;
    }

    const caseSummary = caseResult.content[0].text;
    console.log("Case summary generated for: " + name);

    // ── SAVE TO MASTER SHEET ─────────────────────────────
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

    // ── SEND TELEGRAM BRIEF ──────────────────────────────
    const refId = "VMW-" + mobile.replace(/\D/g,"").slice(-4);

    const telegramBrief =
`✅ NEW CASE READY
━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${refId} | ${isPartnerCase ? "Partner: " + partnerCode : "Direct Case"}
👤 ${name} | Age: ${age}
💼 ${loanType} | ${loanAmount}
🏙️ ${cityState}
💼 ${employmentType} | ${companyName}
💰 Income: ${monthlyIncome}
📊 CIBIL: ${cibilScore}
💳 EMIs: ${existingEMI} | FOIR: ${foirText}
🔄 Bounces: ${bounces}
📅 Callback: ${callbackDate} at ${callbackTime}
📱 Call: ${mobile}
━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await tg(CHAT_ID, telegramBrief);

    // ── DSA ALLOCATION BUTTONS ───────────────────────────
    const cleanMob = mobile.replace(/\D/g,"");
    const dsaKeyboard = {
      inline_keyboard: [
        [
          {text:"My Mudra",    callback_data:"case_assign|"+cleanMob+"|My Mudra"},
          {text:"RU Loans",    callback_data:"case_assign|"+cleanMob+"|RU Loans"}
        ],
        [
          {text:"Andromeda",   callback_data:"case_assign|"+cleanMob+"|Andromeda"},
          {text:"Urban Money", callback_data:"case_assign|"+cleanMob+"|Urban Money"}
        ],
        [
          {text:"⚙️ Manual Decision", callback_data:"case_assign|"+cleanMob+"|Manual Decision"}
        ]
      ]
    };

    await fetch(`${TG}/sendMessage`, {
      method :"POST",
      headers:{"Content-Type":"application/json"},
      body   :JSON.stringify({
        chat_id     : CHAT_ID,
        text        : `📋 ${name} | ${loanType} | ${loanAmount}\nAllocate to DSA — email will be sent automatically ↓`,
        reply_markup: dsaKeyboard
      })
    });

    // Save case summary for email when DSA is selected
    if (APPS_SCRIPT && mobile) {
      try {
        const cleanMobile = mobile.replace(/\D/g,"").slice(-10);
        const saveUrl = APPS_SCRIPT +
          "?action=saveCaseSummary" +
          "&mobile="  + encodeURIComponent(cleanMobile) +
          "&summary=" + encodeURIComponent(caseSummary.substring(0, 3000)) +
          "&name="    + encodeURIComponent(name) +
          "&loan="    + encodeURIComponent(loanType) +
          "&amount="  + encodeURIComponent(loanAmount);
        await fetch(saveUrl);
      } catch(e) {}
    }

    console.log(`✅ Case summary complete: ${name}`);

  } catch(err) {
    console.error("case-summary error:", err.message);
    try {
      await tg(CHAT_ID, `❌ Case summary error for ${req.body.name || "Unknown"}!\nError: ${err.message}`);
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
    const chatId   = CHAT_ID;

    console.log(`Portal analysis: ${name} | ${loanType} | ${mobile}`);
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
        if (isPDF) content.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:rawB64}});
        else content.push({type:"image", source:{type:"base64", media_type:mimeType, data:rawB64}});
        docCount++;
        docsReceived.push(docNames[i]);
      } catch(e) {}
    }

    if (docCount === 0) { await tg(chatId, `⚠️ No readable documents found for ${name}!`); return; }

    const lt        = loanType.toUpperCase();
    const isHL      = lt.includes("HOME");
    const isLAP     = lt.includes("PROPERTY") || lt.includes("AGAINST");
    const isSecured = isHL || isLAP;

    let prompt = `You are an expert Indian loan underwriter for VastMyWealth Advisory.\n`;
    prompt += `Analyze ${docCount} documents for: ${name} | ${loanType} | ${empType} | CIBIL: ${cibil}\n\n`;
    prompt += `EXTRACT AND ANALYZE:\n1. Name from PAN\n2. Salaried or Self Employed\n3. Salary/income amount\n4. Existing EMIs\n5. Bounces\n6. Any red flags\n`;
    if (isSecured) prompt += `7. Property type if docs available\n`;
    prompt += `\nFORMAT AS:\nSECTION 1 — TELEGRAM BRIEF:\n`;
    prompt += `👤 [Name] | [Employment]\n💼 ${loanType} | CIBIL: ${cibil}\n`;
    prompt += `💰 ${empType==="Salaried"?"Salary":"Avg Balance"}: ₹[amount]\n`;
    prompt += `💳 EMIs: ₹[amount] | Bounces: [None/count]\n`;
    if (isSecured) prompt += `🏠 Property: [type] | Risk: [LOW/MED/HIGH]\n`;
    prompt += `⚠️ Flags: [None or list]\n📋 Docs: ${docsReceived.join(", ")}\n\n`;
    prompt += `---DSA_PROFILE_START---\n\nSECTION 2 — CASE NOTE:\n[Professional banker-friendly case summary]\n\n---DSA_PROFILE_END---`;

    content.push({type:"text", text:prompt});

    const aiRes = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1500, messages:[{role:"user", content}]})
    });

    let result = await aiRes.json();

    // Handle password protected
    if (result.error && result.error.message && result.error.message.includes("password protected")) {
      const password = data.bankPassword || "";
      if (!password) { await tg(chatId, `⚠️ Bank statement is password protected!\nPlease enter password in portal and retry.`); return; }
      const unlocked = await unlockPDF(data.file_bankSal, password);
      if (!unlocked) { await tg(chatId, `⚠️ Could not unlock!\nPlease check password and retry.`); return; }
      for (let i = 0; i < content.length; i++) {
        if (content[i].type === "document") {
          content[i] = {type:"document", source:{type:"base64", media_type:"application/pdf", data:unlocked.replace("PDF:","")}};
          break;
        }
      }
      const retryRes = await fetch(AI, {method:"POST", headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"}, body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1500, messages:[{role:"user", content}]})});
      result = await retryRes.json();
    }

    if (!result.content || !result.content[0]) {
      await tg(chatId, `❌ AI analysis failed for ${name}!`);
      return;
    }

    const fullText   = result.content[0].text;
    const parts      = fullText.split("---DSA_PROFILE_START---");
    const briefText  = parts[0].trim();
    const dsaProfile = parts.length > 1 ? parts[1].replace("---DSA_PROFILE_END---","").trim() : "";
    const telegramMsg = briefText.length > 20 ? briefText : fullText.substring(0, 3000);

    // Save profile
    if (APPS_SCRIPT && mobile) {
      try {
        const cleanMobile = mobile.replace(/\D/g,"").slice(-10);
        const saveUrl = APPS_SCRIPT + "?action=saveProfile&mobile=" + encodeURIComponent(cleanMobile) + "&profile=" + encodeURIComponent((dsaProfile || fullText).substring(0, 1500));
        await fetch(saveUrl);
      } catch(e) {}
    }

    const refId = "VMW-" + mobile.slice(-4);
    const msgToSend = `✅ AI ANALYSIS COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 ${refId} | ${isAdmin ? "Admin Upload" : "Customer Upload"}\n\n${telegramMsg}\n\n👉 Review in CRM before allocating DSA`;

    if (msgToSend.length > 3800) {
      const chunks = []; let remaining = msgToSend;
      while (remaining.length > 0) { chunks.push(remaining.substring(0, 3800)); remaining = remaining.substring(3800); }
      for (const chunk of chunks) { await tg(chatId, chunk); await new Promise(r => setTimeout(r, 500)); }
    } else {
      await tg(chatId, msgToSend);
    }

    console.log(`✅ Portal analysis complete: ${name}`);

  } catch(err) {
    console.error("analyze-portal error:", err.message);
    try { await tg(CHAT_ID, `❌ Analysis error!\nError: ${err.message}`); } catch(e) {}
  }
});

// ============================================================
// TELEGRAM BOT WEBHOOK
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    // ── CALLBACK QUERY ───────────────────────────────────
    if (body.callback_query) {
      const cb     = body.callback_query;
      const chatId = cb.message.chat.id;
      const msgId  = cb.message.message_id;
      const data   = cb.data;
      const origText = cb.message.text || "";

      await answerCallback(cb.id);

      // ── CASE ASSIGN (from WhatsApp case summary) ──────
      if (data.startsWith("case_assign|")) {
        const parts = data.split("|");
        const mob   = parts[1];
        const dsa   = parts[2];

        await removeButtons(chatId, msgId);

        // Get saved case summary and send email
        let emailSent = false;
        try {
          if (APPS_SCRIPT) {
            // Fetch case summary
            const fetchUrl = APPS_SCRIPT +
              "?action=getCaseSummary&mobile=" + encodeURIComponent(mob);
            const fetchRes  = await fetch(fetchUrl, {redirect:"follow"});
            const fetchText = await fetchRes.text();
            let caseSummary = origText;
            try {
              const fetchData = JSON.parse(fetchText);
              if (fetchData.summary) caseSummary = fetchData.summary;
            } catch(e) {}

            // Send email
            const subject = "New Case — " + mob + " | " + dsa + " | VastMyWealth";
            const emailBody = "CASE ALLOCATED TO: " + dsa + "\n\n" + caseSummary + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\nRM: Manoj — " + MANOJ_MOBILE + "\nVastMyWealth Advisory";

            emailSent = await sendEmail(ADMIN_EMAIL, subject, emailBody, mob, dsa);

            // Update WA Leads status
            const updateUrl = APPS_SCRIPT +
              "?action=updateWALeadStatus" +
              "&mobile=" + encodeURIComponent(mob) +
              "&status=" + encodeURIComponent("Allocated — " + dsa);
            await fetch(updateUrl, {redirect:"follow"});
          }
        } catch(e) {
          console.error("case_assign error:", e.message);
        }

        const stamp = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"});
        await editMessageText(chatId, msgId,
          origText + "\n\n✅ Allocated to: " + dsa +
          "\n📧 Email: " + (emailSent ? "Sent ✅" : "Failed ❌ — check manually") +
          "\n🕐 " + stamp
        );

        console.log("✅ Case allocated: " + mob + " → " + dsa + " | Email: " + emailSent);
        return;
      }

      // ── LOAN TYPE SELECTION ───────────────────────────
      if (data.startsWith("loan_")) {
        const code = data.replace("loan_", "");
        const name = LOANS[code];
        if (!name) { await tg(chatId, "❌ Invalid loan type!"); return; }
        saveSession(chatId, {code, name, docs:[], ids:[], cibil:"", status:"uploading"});
        await tg(chatId, `✅ ${name} selected!\n\n📁 Forward all documents now:\n• PAN Card\n• Aadhar Card\n• Bank Statement(s)\n• Salary Slips / ITR\n• GST (if applicable)\n\nType ANALYZE when all uploaded!`);
        await showMainMenu(chatId);
        return;
      }

      // ── CIBIL SELECTION ───────────────────────────────
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

      // ── PARTNER APPROVE/REJECT ────────────────────────
      if (data.startsWith("partner_approve") || data.startsWith("partner_reject")) {
        const parts = data.split("|");
        const action = parts[0];
        const mob  = parts[2] || "";
        const pName= parts[3] || "Partner";
        await answerCallback(cb.id, action === "partner_approve" ? "✅ Approving..." : "❌ Rejecting...");
        await removeButtons(chatId, msgId);
        if (action === "partner_approve") {
          await editMessageText(chatId, msgId, origText + "\n\n✅ APPROVED — " + pName + "\n📱 " + mob);
        } else {
          await editMessageText(chatId, msgId, origText + "\n\n❌ REJECTED — " + pName);
        }
        return;
      }

      // ── DSA ASSIGN (old flow) ─────────────────────────
      if (data.startsWith("assign|")) {
        const parts = data.split("|");
        const rowNumber = parseInt(parts[1]);
        const dsa = parts[2];
        await answerCallback(cb.id, "✅ Assigning to " + dsa + "...");
        await removeButtons(chatId, msgId);
        const stamp = new Date().toLocaleDateString("en-IN", {day:"2-digit", month:"short"});
        await editMessageText(chatId, msgId, origText + "\n\n✅ ALLOCATED TO: " + dsa + "\n🕐 " + stamp);
        console.log("✅ Old flow allocated row " + rowNumber + " → " + dsa);
        return;
      }

      return;
    }

    // ── MESSAGE ──────────────────────────────────────────
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
      if (count === 1) await tg(chatId, "📁 First document received!\nKeep sending more.\nType ANALYZE when all uploaded.");
      else if (count === 5) await tg(chatId, `📁 ${count} documents received.\nSend more or type ANALYZE.`);
      else if (count % 10 === 0) await tg(chatId, `📁 ${count} documents received.\nType ANALYZE when done.`);
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

    if (cmd === "MISSING")  { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!"); return; } await showMissing(chatId, s); return; }
    if (cmd === "IMPROVE")  { const s = getSession(chatId); if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; } await showImprove(chatId, s); return; }
    if (cmd === "PROFILE")  { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!"); return; } await generateProfile(chatId, s); return; }
    if (cmd === "CLASSIFY") { const s = getSession(chatId); if (!s) { await tg(chatId, "❌ No active session!"); return; } if (s.docs.length === 0) { await tg(chatId, "❌ No documents!"); return; } await classifyDocuments(chatId, s); return; }
    if (cmd === "SUBMIT")   { const s = getSession(chatId); if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; } await submitReport(chatId, s); return; }

    if (cmd === "RESET") {
      clearSession(chatId);
      delete CLASSIFY_PENDING[chatId];
      await tg(chatId, "🔄 Session cleared!\nType HELP to start new analysis.");
      await showMainMenu(chatId);
      return;
    }

    if (CLASSIFY_PENDING[chatId]) {
      const p = CLASSIFY_PENDING[chatId];
      const idx = p.currentIndex;
      if (cmd === "YES" || cmd === "Y") { p.currentIndex++; await classifyNext(chatId); }
      else { p.classifications[idx] = text.trim(); await tg(chatId, "✅ Updated to: " + text.trim()); p.currentIndex++; await classifyNext(chatId); }
      return;
    }

    if (cmd === "REMOVE") {
      const s = getSession(chatId);
      if (!s || s.docs.length === 0) { await tg(chatId, "❌ No documents to remove!"); return; }
      const removed = s.docs.pop(); s.ids.pop();
      saveSession(chatId, s);
      await tg(chatId, `🗑️ Removed: ${removed}\nRemaining: ${s.docs.length} docs\n\nUpload correct document and type ANALYZE!`);
      await showMainMenu(chatId);
      return;
    }

    const s = getSession(chatId);
    if (s && text && !cmd.match(/^(HELP|START|ANALYZE|MISSING|IMPROVE|PROFILE|CLASSIFY|SUBMIT|RESET|REMOVE|STATUS|NEW)$/)) {
      if (text.toLowerCase().includes("additional strength") || text.toLowerCase().includes("strength:")) {
        s.additionalStrengths = text; saveSession(chatId, s);
        await tg(chatId, "✅ Strengths saved!\nType PROFILE to regenerate.");
      } else {
        s.customInstruction = text; saveSession(chatId, s);
        await tg(chatId, "✅ Instruction saved!\nType ANALYZE to analyze with this\nOr PROFILE to regenerate profile!");
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
    status : "✅ VMW AI Analyzer v6 Running",
    version: "v6",
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
  console.log(`🚀 VMW AI Analyzer v6 running on port ${PORT}`);
});

