const axios = require('axios');
const pako = require('pako');
const CheckingLog = require('../models/CheckingLog');

/**
 * Compresses data using pako gzip (matching web app logic)
 * @param {string} data - JSON string to compress
 * @returns {string} - Base64 encoded compressed string
 */
const compressData = (data) => {
    try {
        const dataArray = Buffer.from(data, 'utf-8');
        const compressedArray = pako.gzip(dataArray, { level: 9 });
        return Buffer.from(compressedArray).toString("base64");
    } catch (error) {
        console.error("Compression error:", error);
        throw new Error("Failed to compress data");
    }
};

/**
 * Scans a list of emails to determine their status using the Python API.
 * @param {string[]} emails - Array of email addresses
 * @param {boolean} isVIP - Whether the user has VIP status
 * @param {string} userEmail - The email of the person scanning
 * @returns {Promise<Object>} - Object containing results array, total processed, omitted count, and shareId
 */
const scanEmails = async (emails, isVIP, userEmail = "anonymous") => {
    console.log(`--- Starting scan for ${userEmail} (${emails.length} emails, VIP: ${isVIP}) ---`);
    const startTime = Date.now();
    // Limits: Free users can scan up to 10 (like the web app), VIPs up to 50000
    const limit = isVIP ? 50000 : 10;
    const emailsToProcess = emails.slice(0, limit);
    const omittedCount = emails.length - emailsToProcess.length;

    // The API expects a newline-separated string
    const productsText = emailsToProcess.join('\n');
    let resultsArray = [];
    let shareId = null;

    // Status counts for logging
    const statusCounts = {
        Good: 0,
        Disable: 0,
        Unknown: 0,
        Verify: 0,
        NotExist: 0
    };

    try {
        const url = process.env.VIP_GMAIL_CHECK_URL || "http://65.109.63.238:5000/process-emails";
        const payload = {
            emails: productsText,
            useremail: userEmail,
            ip: "telegram_bot"
        };

        const response = await axios.post(url, payload, {
            headers: {
                "Content-Type": "application/json",
            },
            timeout: 120000 // allow 2 minutes for large list
        });

        if (response.status === 200 && response.data) {
            const data = response.data;

            const processCategory = (textBlock, statusLabel, countKey) => {
                if (!textBlock) return;
                const lines = textBlock.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                lines.forEach(line => {
                    resultsArray.push({ email: line, status: statusLabel });
                    statusCounts[countKey]++;
                });
            };

            processCategory(data.LIVE, 'LIVE', 'Good');
            processCategory(data.DISABLED, 'DISABLED', 'Disable');
            processCategory(data.NOTEXISTS, 'NOT_EXISTS', 'NotExist');

            // Map other fields if they exist in the response
            if (data.VERIFYED_COUNT) statusCounts.Verify = data.VERIFYED_COUNT;
            if (data.UNKNOW_COUNT) statusCounts.Unknown = data.UNKNOW_COUNT;

            // Find any that weren't returned in the primary 3 boxes and default to UNKNOWN
            const processedEmailsSet = new Set(resultsArray.map(r => r.email));
            emailsToProcess.forEach(e => {
                if (!processedEmailsSet.has(e)) {
                    resultsArray.push({ email: e, status: 'UNKNOWN' });
                    statusCounts.Unknown++;
                }
            });

            // Log to Database (replicate web app behavior)
            try {
                const finalResult = {
                    ALL: data.ALL || "",
                    LIVE_COUNT: data.LIVE_COUNT || statusCounts.Good,
                    VERIFYED_COUNT: data.VERIFYED_COUNT || statusCounts.Verify,
                    LIVE: data.LIVE || "",
                    VERIFYED: data.VERIFYED || "",
                    DISABLED_COUNT: data.DISABLED_COUNT || statusCounts.Disable,
                    UNKNOW_COUNT: data.UNKNOW_COUNT || statusCounts.Unknown,
                    DISABLED: data.DISABLED || "",
                    UNKNOW: data.UNKNOW || "",
                    NOTEXISTS_COUNT: data.NOTEXISTS_COUNT || statusCounts.NotExist,
                    NOTEXISTS: data.NOTEXISTS || "",
                };

                const compressedResult = compressData(JSON.stringify(finalResult));
                const completionTime = Date.now() - startTime;

                const createdLog = await CheckingLog.create({
                    email: userEmail,
                    compressedresult: compressedResult,
                    status: statusCounts,
                    checkingcount: emailsToProcess.length,
                    ip: "telegram_bot",
                    method: "bot",
                    completionTime: completionTime
                });
                shareId = createdLog.shareId;
                console.log(`Scan logged to DB for ${userEmail}. ShareId: ${shareId}`);
            } catch (logErr) {
                console.error("Failed to save check log to DB:", logErr);
            }

        } else {
            console.error("Non-200 from process-emails:", response.status);
            throw new Error("API returned non-200");
        }
    } catch (error) {
        console.error("Error calling Python process-emails API:", error.message);
        emailsToProcess.forEach(email => {
            resultsArray.push({ email, status: "ERROR" });
            statusCounts.Unknown++;
        });
    }

    return {
        results: resultsArray,
        totalProcessed: emailsToProcess.length,
        omitted: omittedCount,
        shareId: shareId
    };
};

/**
 * Handles the complete flow of processing a Telegram document (download, parse, scan, reply)
 * Now includes a shareable link in the results message.
 * @param {Object} ctx - Telegraf context
 * @param {Object} user - User document from DB
 */
const handleTelegramDocument = async (ctx, user) => {
    try {
        const document = ctx.message.document;
        const WEBSITE_URL = process.env.FRONTEND_URL || "https://emailscan.in";

        // Security: VIP Check
        if (!user.vip) {
            return ctx.reply("⭐ *VIP Feature Requested*\n\nEmail checking is currently exclusive to VIP members. Please visit the website to upgrade your plan!\n\n🌐 https://emailscan.in", { parse_mode: 'Markdown' });
        }

        if (!document.file_name.endsWith('.txt')) {
            return ctx.reply("❌ Invalid format. Please upload a `.txt` file.");
        }

        // File size limit for security (e.g. 10MB)
        if (document.file_size > 10 * 1024 * 1024) {
            return ctx.reply("❌ File too large. Max limit is 10MB.");
        }

        await ctx.reply(`Reading file: ${document.file_name}... 📄`);

        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await axios.get(fileLink.href, {
            timeout: 30000, // 30s max for download
            responseType: 'arraybuffer' // Download as buffer to handle any encoding
        });
        
        const fileContent = Buffer.from(response.data).toString('utf-8');

        // Basic validation for text files
        if (fileContent.includes('\u0000')) {
          return ctx.reply("❌ The uploaded file looks like binary data. Please upload a plain text (.txt) file.");
        }

        const rawLines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        const emails = [...new Set(rawLines)];

        if (emails.length === 0) {
            return ctx.reply("❌ The uploaded file is empty or contains no valid lines.");
        }

        await ctx.reply(`Processing ${emails.length} emails... This might take a moment. ⏳`);

        const scanResult = await scanEmails(emails, user.vip, user.email || "telegram_bot_user");

        let resultContent = "--- Email Scan Results ---\n\n";
        let good = 0, disabled = 0, notExist = 0;

        scanResult.results.forEach(res => {
            resultContent += `${res.email} - ${res.status}\n`;
            if (res.status === "Good" || res.status === "LIVE") good++;
            else if (res.status === "Disabled" || res.status === "DISABLED") disabled++;
            else if (res.status === "NOT_EXISTS" || res.status === "NOT_EXIST") notExist++;
        });

        if (scanResult.omitted > 0) {
            resultContent += `\n... omitted ${scanResult.omitted} emails due to plan limits.`;
        }

        const resultBuffer = Buffer.from(resultContent, 'utf-8');

        // Build caption with share link
        let caption = `✅ Scan completed!\n\n📊 *Summary:*\nTotal Processed: ${scanResult.totalProcessed}\n✅ Good: ${good}\n❌ Disabled: ${disabled}\n⚠️ Not Exist: ${notExist}\n`;
        
        if (scanResult.omitted > 0) {
            caption += `\n⚠️ Omitted: ${scanResult.omitted} (Limit reached)\n`;
        }

        if (scanResult.shareId) {
            caption += `\n🔗 *Share Link:*\n${WEBSITE_URL}/?share=${scanResult.shareId}\n`;
            caption += `_Use this link to view full results on the website or share with others!_`;
        }

        await ctx.replyWithDocument({
            source: resultBuffer,
            filename: `scan_results.txt`
        }, {
            caption: caption,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error("Error in handleTelegramDocument:", error);
        await ctx.reply("An error occurred while processing your file. Please try again later.");
    }
};

module.exports = { scanEmails, handleTelegramDocument };
