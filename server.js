// ============================================================
// VMW AI Loan Analyzer — Render.com Node.js Server v4
// ============================================================

const express  = require("express");
const fetch    = require("node-fetch");
const app      = express();

app.use(express.json({limit: "50mb"}));
app.use(express.urlencoded({limit: "50mb", extended: true}));
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});


// ============================================================
// CONFIG — All from environment variables
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
            ["🔄 RESET",    "📊 STATUS"],
            ["🏠 NEW LOAN"]
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

  let p = `You are an expert Indian loan underwriter for VastMyWealth Advisory.\n\n`;
  p += `Analyze these ${docCount} financial documents for a ${s.name} application.\n`;
  p += `Client self-declared CIBIL: ${s.cibil}\n\n`;
  p += `ANALYZE AND PROVIDE:\n`;
  p += `1. Extract client name from documents\n`;
  p += `2. Verify name consistency across all documents\n`;
  p += `3. Check document validity dates\n`;
  p += `4. Analyze income from salary slips/ITR/bank credits\n`;
  p += `5. Check bank statement for bounces, EMIs, suspicious transactions\n`;
  p += `6. Compare declared CIBIL (${s.cibil}) with banking behavior\n`;
  if (!isPL) p += `7. Check co-applicant documents if present\n`;
  if (isBT)  p += `8. Analyze existing loan repayment history\n`;
  if (isBL || isLAP) p += `9. Verify GST/Udyam name matches bank account name\n`;

  p += `\nMINIMUM DOCUMENTS REQUIRED for ${s.name}:\n`;
  if (isPL)  p += `PAN, Aadhar, 3 salary slips OR 2yr ITR, 6m bank statement${isBT ? ", 12m loan statement, sanction letter" : ""}\n`;
  if (isHL)  p += `PAN, Aadhar, income proof, 6m bank statement, property docs, co-applicant docs${isBT ? ", 12m loan statement, NOC" : ""}\n`;
  if (isBL)  p += `PAN, Aadhar, GST/Udyam, 12m bank statement, 2yr ITR, co-applicant docs\n`;
  if (isLAP) p += `PAN, Aadhar, income proof, 12m bank statement, property title docs, co-applicant docs${isBT ? ", 12m loan statement, NOC" : ""}\n`;

  p += `\nFORMAT RESPONSE CONCISELY AS:\n\n`;
  p += `🤖 VMW AI LOAN ANALYSIS\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  p += `Loan: ${s.name}\n`;
  p += `CIBIL Declared: ${s.cibil}\n`;
  p += `Documents: ${docCount} analyzed\n\n`;
  p += `👤 CLIENT\n`;
  p += `Name: [from docs]\n`;
  p += `Employment: [Salaried/Self-Employed]\n\n`;
  p += `💰 INCOME\n`;
  p += `Monthly: [amount] | Balance: [avg] | EMI: [amount]\n\n`;
  p += `🔍 CHECKS\n`;
  p += `Name: [✅/❌] | Docs Valid: [✅/❌] | Bounces: [None/count] | Fraud: [LOW/MED/HIGH]\n\n`;
  p += `❌ MISSING: [list briefly]\n\n`;
  p += `📊 PROBABILITY: [X]% | Risk: [LOW/MED/HIGH]\n\n`;
  p += `✅ [PROCEED/MORE DOCS/REJECT] — [one line reason]\n`;
  p += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
      headers: {
        "Content-Type"     : "application/json",
        "x-api-key"        : ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model     : "claude-haiku-4-5",
        max_tokens: 2000,
        messages  : [{role:"user", content}]
      })
    });

    const result = await aiRes.json();
    console.log("AI status:", aiRes.status);

    if (result.error && result.error.message && result.error.message.includes("100 PDF pages")) {
      await tg(chatId,
        "⚠️ One document has too many pages!\n\n" +
        "Please split the bank statement:\n" +
        "• Send only last 6 months\n" +
        "• Or compress the PDF\n\n" +
        "Type REMOVE to delete last doc\nThen upload shorter version!"
      );
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
        const lines  = analysis.split("\n");
        let chunk    = "";
        const chunks = [];
        for (const line of lines) {
          if ((chunk + "\n" + line).length > 3800) {
            chunks.push(chunk);
            chunk = line;
          } else {
            chunk = chunk ? chunk + "\n" + line : line;
          }
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
      await tg(chatId,
        "✅ REPORT SAVED!\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "Sheet: Saved ✅\n" +
        "Email: Sent ✅\n\n" +
        "Type RESET to start new analysis."
      );
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
  const missing = required.filter(r =>
    !names.some(n => n.includes(r.toLowerCase().split(" ")[0]))
  );

  await tg(chatId,
    "📋 DOCUMENTS CHECK\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "Received: " + s.docs.length + "\n\n" +
    (missing.length > 0 ?
      "❌ Still needed:\n" + missing.map(m => "• " + m).join("\n") :
      "✅ Minimum documents present!\nType ANALYZE to proceed."
    )
  );
  await showMainMenu(chatId);
}

// ============================================================
// SHOW IMPROVEMENTS
// ============================================================
async function showImprove(chatId, s) {
  await tg(chatId, "⏳ Generating improvement suggestions...");
  try {
    const res = await fetch(AI, {
      method : "POST",
      headers: {
        "Content-Type"     : "application/json",
        "x-api-key"        : ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model     : "claude-haiku-4-5",
        max_tokens: 800,
        messages  : [{role:"user", content:
          "Based on this loan analysis:\n\n" + s.analysis +
          "\n\nProvide 5 specific actions to improve approval probability.\n" +
          "Format:\n💡 HOW TO IMPROVE\n1. [action] — +[X]%\n2. [action] — +[X]%\n..."
        }]
      })
    });
    const result = await res.json();
    if (result.content && result.content[0]) await tg(chatId, result.content[0].text);
  } catch(e) {
    await tg(chatId, "❌ Error: " + e.message);
  }
  await showMainMenu(chatId);
}

// ============================================================
// WEBHOOK HANDLER
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    // ── CALLBACK QUERY ──────────────────────────────────
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

        await tg(chatId,
          `✅ ${name} selected!\n\n` +
          `📁 Forward all documents now:\n` +
          `• PAN Card\n• Aadhar Card\n• Bank Statement(s)\n` +
          `• Salary Slips / ITR\n• GST (if applicable)\n` +
          `• Loan statement (if BT)\n\n` +
          `Type ANALYZE when all uploaded!`
        );
        await showMainMenu(chatId);
        return;
      }

      if (data.startsWith("cibil_")) {
        const s = getSession(chatId);
        if (!s) {
          await tg(chatId, "❌ Session expired! Type HELP to restart.");
          await showMainMenu(chatId);
          return;
        }
        s.cibil  = CIBIL_MAP[data.replace("cibil_", "")] || "Not Checked";
        s.status = "analyzing";
        saveSession(chatId, s);
        await tg(chatId, `⏳ Analyzing ${s.docs.length} documents...\nPlease wait 30-60 seconds!`);
        await runAnalysis(chatId, s);
        return;
      }

      return;
    }

    // ── MESSAGE ─────────────────────────────────────────
    const msg = body.message;
    if (!msg) return;

    const chatId = msg.chat.id;

    // Document or photo
    if (msg.document || msg.photo) {
      const s = getSession(chatId);
      if (!s) {
        await tg(chatId, "❌ No active session!\nType HELP to start first.");
        return;
      }
      if (s.status === "analyzing" || s.status === "analyzed") return;

      let fileId   = "";
      let fileName = `Doc_${s.docs.length + 1}`;

      if (msg.document) {
        fileId   = msg.document.file_id;
        fileName = msg.document.file_name || fileName;
      } else if (msg.photo) {
        fileId   = msg.photo[msg.photo.length - 1].file_id;
        fileName = `Photo_${s.docs.length + 1}.jpg`;
      }

      s.docs.push(fileName);
      s.ids.push(fileId);
      saveSession(chatId, s);

      const count = s.docs.length;
      if (count === 1) {
        await tg(chatId, "📁 First document received!\nKeep sending more.\nType ANALYZE when all uploaded.");
      } else if (count === 5) {
        await tg(chatId, `📁 ${count} documents received.\nSend more or type ANALYZE.`);
      } else if (count % 10 === 0) {
        await tg(chatId, `📁 ${count} documents received.\nType ANALYZE when done.`);
      }
      return;
    }

    // Text commands
    const text = (msg.text || "").trim();
    if (!text) return;

    const cmd = text.toUpperCase()
      .replace("📊 ", "").replace("📋 ", "")
      .replace("💡 ", "").replace("📤 ", "")
      .replace("🔄 ", "").replace("📊 ", "")
      .replace("🏠 NEW LOAN", "HELP")
      .replace(/^\//, "").split("@")[0].trim();

    console.log(`📩 Chat ${chatId}: "${cmd}"`);

    if (cmd === "HELP" || cmd === "START") {
      await showLoanMenu(chatId);
      return;
    }

    if (cmd.startsWith("NEW ")) {
      const code = cmd.replace("NEW ", "").trim();
      const name = LOANS[code];
      if (!name) {
        await tg(chatId, "❌ Invalid!\nUse: NEW PL / NEW HL / NEW BL / NEW LAP\nor type HELP for buttons!");
        return;
      }
      saveSession(chatId, {code, name, docs:[], ids:[], cibil:"", status:"uploading"});
      await tg(chatId, `✅ ${name} started!\n\nUpload all documents now.\nType ANALYZE when done!`);
      await showMainMenu(chatId);
      return;
    }

    if (cmd === "ANALYZE") {
      const s = getSession(chatId);
      if (!s)                  { await tg(chatId, "❌ No active session!\nType HELP to start."); return; }
      if (s.docs.length === 0) { await tg(chatId, "❌ No documents uploaded yet!"); return; }
      s.status = "waiting_cibil";
      saveSession(chatId, s);
      await showCibilMenu(chatId);
      return;
    }

    if (cmd === "STATUS") {
      const s = getSession(chatId);
      if (!s) { await tg(chatId, "❌ No active session!"); return; }
      await tg(chatId,
        `📊 CURRENT SESSION\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Loan : ${s.name}\n` +
        `Docs : ${s.docs.length} uploaded\n\n` +
        s.docs.map((d,i) => `${i+1}. ${d}`).join("\n") +
        `\n\nType ANALYZE when ready!`
      );
      await showMainMenu(chatId);
      return;
    }

    if (cmd === "MISSING") {
      const s = getSession(chatId);
      if (!s) { await tg(chatId, "❌ No active session!"); return; }
      await showMissing(chatId, s);
      return;
    }

    if (cmd === "IMPROVE") {
      const s = getSession(chatId);
      if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; }
      await showImprove(chatId, s);
      return;
    }

    if (cmd === "SUBMIT") {
      const s = getSession(chatId);
      if (!s || !s.analysis) { await tg(chatId, "❌ Run ANALYZE first!"); return; }
      await submitReport(chatId, s);
      return;
    }

    if (cmd === "RESET") {
      clearSession(chatId);
      await tg(chatId, "🔄 Session cleared!\nType HELP to start new analysis.");
      await showMainMenu(chatId);
      return;
    }

    if (cmd === "REMOVE") {
      const s = getSession(chatId);
      if (!s || s.docs.length === 0) {
        await tg(chatId, "❌ No documents to remove!");
        return;
      }
      const removed = s.docs.pop();
      s.ids.pop();
      saveSession(chatId, s);
      await tg(chatId,
        `🗑️ Removed: ${removed}\n` +
        `Remaining: ${s.docs.length} docs\n\n` +
        `Upload correct document and type ANALYZE!`
      );
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
// ANALYZE PORTAL ENDPOINT
// ============================================================
app.post("/analyze-portal", async (req, res) => {
  res.json({success: true, message: "Analysis started"});
  try {
    const data    = req.body;
    const name    = data.name     || "Unknown";
    const mobile  = data.mobile   || "";
    const loanType= data.loanType || "Personal Loan";
    const empType = data.empType  || "Salaried";
    const cibil   = data.cibil    || "Not Checked";
    const chatId  = "1471849538";

    console.log(`Portal analysis: ${name} | ${loanType} | ${mobile}`);
    await tg(chatId, `⏳ AI analyzing documents for ${name}...\nLoan: ${loanType}\nPlease wait 30-60 seconds!`);

    const content  = [];
    const docKeys  = ["file_pan","file_aadhar","file_salary1","file_bankSal","file_itr1","file_extra1","file_extra2","file_extra3"];
    const docNames = ["PAN Card","Aadhar Card","Salary Slip","Bank Statement","ITR","Doc 1","Doc 2","Doc 3"];
    let   docCount = 0;
    const docsReceived = [];

    for (let i = 0; i < docKeys.length; i++) {
      const b64 = data[docKeys[i]];
      if (!b64 || b64.length < 10) continue;
      try {
        const isPDF  = b64.startsWith("PDF:");
        const rawB64 = isPDF ? b64.replace("PDF:","") : b64;
        const mime   = isPDF ? "application/pdf" : "image/jpeg";
        if (isPDF) {
          content.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:rawB64}});
        } else {
          content.push({type:"image", source:{type:"base64", media_type:mime, data:rawB64}});
        }
        docCount++;
        docsReceived.push(docNames[i]);
      } catch(e) { console.error(`Doc error ${docNames[i]}: ${e.message}`); }
    }

    if (docCount === 0) {
      await tg(chatId, `⚠️ No readable documents for ${name}!\nPlease check uploads and retry.`);
      return;
    }

    const lt        = loanType.toUpperCase();
    const isSecured = lt.includes("HOME") || lt.includes("PROPERTY") || lt.includes("AGAINST");

    let prompt = `You are an expert Indian loan underwriter for VastMyWealth Advisory.\n\n`;
    prompt += `Analyze ${docCount} documents for: ${name}\n`;
    prompt += `Loan: ${loanType} | Employment: ${empType} | CIBIL: ${cibil}\n\n`;
    prompt += `EXTRACT:\n`;
    prompt += `1. Name and Age from PAN\n`;
    prompt += `2. Income from salary slips or bank credits\n`;
    prompt += `3. Bank statement — bounces, EMIs, average balance\n`;
    prompt += `4. FOIR current and post loan\n`;
    prompt += `5. Salary bank name\n`;
    prompt += `6. Employer name and Tier (1/2/3)\n`;
    prompt += `7. City from address\n`;
    prompt += `8. Red flags\n`;
    if (isSecured) prompt += `9. Property type (MCGM/GP/SRA/MHADA/CHS) and LTV\n`;
    prompt += `\nFORMAT:\n\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `✅ PORTAL SUBMISSION ANALYSIS\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `👤 Name: [from PAN] | Age: [from PAN]\n`;
    prompt += `🏢 Employer: [name] ([Tier 1/2/3])\n`;
    prompt += `🏦 Salary Bank: [bank name]\n`;
    prompt += `💰 Monthly Income: ₹[amount]\n`;
    prompt += `📊 CIBIL: ${cibil}\n`;
    prompt += `💳 Existing EMIs: ₹[amount]\n`;
    prompt += `📐 FOIR Current: [%] | Post Loan: [%]\n`;
    prompt += `🏠 Loan: ${loanType}\n`;
    if (isSecured) prompt += `🏠 Property: [type] | Risk: [LOW/MED/HIGH]\n`;
    prompt += `⚠️ Red Flags: [None or list]\n`;
    prompt += `📋 Docs: ${docsReceived.join(", ")}\n`;
    prompt += `📊 Probability: [X]%\n`;
    prompt += `✅ Recommendation: [PROCEED/MORE DOCS/REJECT]\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `If field not readable write N/A.`;

    content.push({type:"text", text:prompt});

    const aiRes = await fetch(AI, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5", max_tokens:1000, messages:[{role:"user", content}]})
    });

    const result = await aiRes.json();
    if (!result.content || !result.content[0]) {
      await tg(chatId, `❌ AI analysis failed for ${name}!\nPlease review manually in CRM.`);
      return;
    }

    await tg(chatId, result.content[0].text);
    console.log(`✅ Portal analysis complete: ${name}`);

  } catch(err) {
    console.error("analyze-portal error:", err.message);
    try {
      await tg("1471849538", `❌ Analysis error!\n${err.message}\nReview manually in CRM.`);
    } catch(e) {}
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/", (req, res) => {
  res.json({
    status : "✅ VMW AI Analyzer v4 Running",
    version: "v4",
    time   : new Date().toISOString()
  });
});

// ============================================================
// SETUP WEBHOOK
// ============================================================
app.get("/setup", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({error: "Provide ?url=YOUR_RENDER_URL/webhook"});
  const response = await fetch(
    `${TG}/setWebhook?url=${encodeURIComponent(url)}&drop_pending_updates=true`
  );
  const data = await response.json();
  res.json(data);
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 VMW AI Analyzer v4 running on port ${PORT}`);
});

