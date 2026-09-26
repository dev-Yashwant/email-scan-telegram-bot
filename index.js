require("dotenv").config();
const express = require("express");
const path = require("path");
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const connectDB = require("./config/db");
const User = require("./models/User");
const CheckingLog = require("./models/CheckingLog");
const crypto = require("crypto");
const { loginWizard, signupWizard, uploadWizard } = require("./bot/scenes");

// Connect to MongoDB
connectDB().catch(err => {
    console.error("Critical DB Connection Error:", err);
    process.exit(1);
});

// --- Express App for Dashboard ---
const app = express();
const PORT = process.env.DASHBOARD_PORT || 4000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", async (req, res) => {
    try {
        const stats = {
            totalUsers: await User.countDocuments(),
            vipUsers: await User.countDocuments({ vip: true }),
            linkedUsers: await User.countDocuments({ telegramId: { $exists: true } }),
        };
        const users = await User.find({ telegramId: { $exists: true } })
            .sort({ updatedAt: -1 })
            .limit(10);
        res.render("index", { stats, users });
    } catch (error) {
        console.error("Dashboard error:", error);
        res.status(500).send("Dashboard error occurred.");
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Front-end monitoring dashboard is running on port ${PORT}`);
});

// --- Telegram Bot Setup ---
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("❌ Missing TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Bot error handling to prevent crashes
bot.catch((err, ctx) => {
    console.error(`❌ Bot encountered error for update ${ctx.updateType}:`, err);
    try {
        ctx.reply("⚠️ An unexpected error occurred. Please try /start to reset.");
    } catch (e) {
        console.error("Failed to send error reply:", e);
    }
});

// Setup scenes
const stage = new Scenes.Stage([loginWizard, signupWizard, uploadWizard]);
bot.use(session());
bot.use(stage.middleware());

const WEBSITE_URL = process.env.FRONTEND_URL || "https://emailscan.in";

const unlinkedKeyboard = Markup.keyboard([
    ["🔑 Login", "📝 Sign Up"],
    ["🌐 Visit Website"]
], {
    input_field_placeholder: "Authenticate to get started...",
    is_persistent: true
}).resize();

const linkedKeyboard = Markup.keyboard([
    ["👤 Profile", "📧 Check Accounts"],
    ["📜 Check History", "🔗 API Key"],
    ["📄 API Docs", "🌐 Visit Website"],
    ["🚪 Logout"]
], {
    input_field_placeholder: "Choose an action or send a file...",
    is_persistent: true
}).resize();

// Main Start Command (handles both deep-link tokens from website AND normal start)
bot.start(async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const telegramChatId = ctx.chat.id.toString();
        const connectToken = ctx.startPayload; // Deep-link payload from website

        // --- Deep-link auto-linking from website ---
        if (connectToken) {
            try {
                const user = await User.findOne({
                    telegramLinkToken: connectToken,
                    telegramLinkTokenExpires: { $gt: new Date() }
                });

                if (!user) {
                    return ctx.reply(
                        "❌ Invalid or expired linking link. Please log into the website and generate a new connection link.",
                        unlinkedKeyboard
                    );
                }

                // Unlink any old account currently associated with this telegramId
                const existingUser = await User.findOne({ telegramId });
                if (existingUser && existingUser._id.toString() !== user._id.toString()) {
                    existingUser.telegramId = undefined;
                    existingUser.telegramChatId = undefined;
                    existingUser.telegramUsername = undefined;
                    await existingUser.save();
                }

                // Bind new telegram info and clear the single-use token
                user.telegramId = telegramId;
                user.telegramChatId = telegramChatId;
                user.telegramUsername = ctx.from.username || undefined;
                user.socialUsername = `(${ctx.from.id})[@${ctx.from.username || 'N/A'}]`;
                user.telegramLinkToken = undefined;
                user.telegramLinkTokenExpires = undefined;
                await user.save();

                const vipStatus = user.vip ? "✅ Active" : "❌ Inactive";
                const expiryText = user.activationExpiryDate
                    ? new Date(user.activationExpiryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                    : "N/A";

                let message = `🎉 *Account linked successfully!*\n\n`;
                message += `Welcome back, *${user.username}*!\n`;
                message += `Your Telegram is now linked to your Email Scan account.\n\n`;
                message += `📧 *Email:* ${user.email}\n`;
                message += `⭐ *VIP Status:* ${vipStatus}\n`;
                message += `📅 *Plan Expiry:* ${expiryText}\n\n`;
                message += `Use the menu below to explore features!`;

                return ctx.replyWithMarkdown(message, linkedKeyboard);
            } catch (err) {
                console.error("Error during Telegram deep link autolink:", err);
                return ctx.reply("❌ An error occurred during auto-linking. Please try again.", unlinkedKeyboard);
            }
        }

        // --- Normal start (no deep-link) ---
        const user = await User.findOne({ telegramId });

        if (user) {
            // Update social info if it has changed or is missing
            const currentSocial = `(${ctx.from.id})[@${ctx.from.username || 'N/A'}]`;
            if (user.socialUsername !== currentSocial) {
                user.socialUsername = currentSocial;
                await user.save();
            }

            let message = `Welcome back, ${user.username || user.email}! 👋\n\n`;
            message += `*Your Account Status:*\n`;
            message += `- Plan: ${user.vip ? "VIP 💎✨" : "Free Player"}\n`;
            message += `- API Access: ${user.apiaccess ? "Enabled 🚀" : "Disabled ❌"}\n\n`;
            message += `Use the menu below to navigate:`;

            return ctx.replyWithMarkdown(message, linkedKeyboard);
        } else {
            let message = `Hello! 👋 Welcome to Email Scan Bot.\n\n`;
            message += `Your Telegram account is not linked to any Email Scan account yet.\n`;
            message += `Please choose an option from the menu below to get started:`;

            return ctx.replyWithMarkdown(message, unlinkedKeyboard);
        }
    } catch (error) {
        console.error("Error in /start command:", error);
        ctx.reply("An error occurred. Please try again later.");
    }
});

// Action Handlers for Inline Buttons (Keep for compatibility)
bot.action("LOGIN", (ctx) => {
    ctx.answerCbQuery().catch(() => { });
    ctx.scene.enter("LOGIN_SCENE").catch(err => console.error("Scene enter error (LOGIN):", err));
});

bot.action("SIGNUP", (ctx) => {
    ctx.answerCbQuery().catch(() => { });
    ctx.scene.enter("SIGNUP_SCENE").catch(err => console.error("Scene enter error (SIGNUP):", err));
});

// Reply Keyboard Handlers for Unlinked
bot.hears("🔑 Login", (ctx) => {
    ctx.scene.enter("LOGIN_SCENE").catch(err => console.error("Scene enter error (Login Button):", err));
});

bot.hears("📝 Sign Up", (ctx) => {
    ctx.scene.enter("SIGNUP_SCENE").catch(err => console.error("Scene enter error (Signup Button):", err));
});

// Reply Keyboard Handlers
bot.hears("👤 Profile", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user) {
            return ctx.reply("Account not found. Please link your account first via /start.");
        }

        let message = `*👤 User Profile*\n\n`;
        message += `*Username:* \`${user.username || "N/A"}\` \n`;
        message += `*Email:* \`${user.email}\` \n`;
        message += `*Plan Status:* ${user.vip ? "VIP 💎✨" : "Free Player"}\n`;
        if (user.vip && user.activationExpiryDate) {
            message += `*VIP Expiry:* ${new Date(user.activationExpiryDate).toLocaleDateString()}\n`;
        }
        message += `*API Access:* ${user.apiaccess ? "Enabled 🚀" : "Disabled ❌"}\n`;
        if (user.apiKey) {
            message += `*API Key:* \`${user.apiKey.slice(0, 6)}...\` (use 🔗 API Key to view full)\n`;
        }

        ctx.replyWithMarkdown(message, linkedKeyboard);
    } catch (err) {
        console.error("Error showing profile:", err);
        ctx.reply("Unable to fetch profile.");
    }
});

bot.hears("📧 Check Accounts", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });
        if (!user) return ctx.reply("Please link your account first via /start.");

        if (!user.vip) {
            return ctx.reply(`💎 *VIP Feature*\n\nEmail checking is currently exclusive to VIP members. Please visit the website to upgrade your plan!\n\n🌐 ${WEBSITE_URL}`, { parse_mode: 'Markdown' });
        }

        ctx.scene.enter("UPLOAD_SCENE").catch(err => console.error("Scene enter error (Check Accounts):", err));
    } catch (err) {
        console.error("Error in check accounts:", err);
    }
});

// ======================================================================
// 📜 CHECK HISTORY — View previous scan results (last 7 days)
// ======================================================================
bot.hears("📜 Check History", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user) {
            return ctx.reply("Please link your account first via /start.", unlinkedKeyboard);
        }

        if (!user.vip) {
            return ctx.replyWithMarkdown(
                `🔒 *Premium Feature*\n\nChecking history is available for VIP members only.\n\n💎 Upgrade your plan to access your scan history!\n\n🌐 [Upgrade Now](${WEBSITE_URL}/plans)`,
                linkedKeyboard
            );
        }

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const logs = await CheckingLog.find({
            email: user.email,
            createdAt: { $gte: sevenDaysAgo }
        })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        if (!logs || logs.length === 0) {
            return ctx.replyWithMarkdown(
                `📜 *Check History*\n\n_No scan history found in the last 7 days._\n\nUse *📧 Check Accounts* to start scanning!`,
                linkedKeyboard
            );
        }

        let message = `📜 *Your Recent Check History*\n_(Last 7 days, showing latest 10)_\n\n`;

        logs.forEach((log, index) => {
            const date = new Date(log.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const status = log.status || {};
            const good = status.Good || 0;
            const disabled = status.Disable || 0;
            const notExist = status.NotExist || 0;
            const unknown = status.Unknown || 0;
            const verify = status.Verify || 0;
            const total = log.checkingcount || 0;
            const shareLink = `${WEBSITE_URL}/?share=${log.shareId}`;
            const timeTaken = log.completionTime
                ? `${(log.completionTime / 1000).toFixed(1)}s`
                : "N/A";
            const method = log.method === "bot" ? "🤖 Bot" : "🌐 Web";

            message += `*${index + 1}.* 📅 ${date}\n`;
            message += `   📊 Total: *${total}* | ✅ ${good} | ❌ ${disabled} | ⚠️ ${notExist}`;
            if (unknown > 0) message += ` | ❓ ${unknown}`;
            if (verify > 0) message += ` | 🔍 ${verify}`;
            message += `\n`;
            message += `   ⏱ ${timeTaken} | ${method}\n`;
            message += `   🔗 ${shareLink}\n\n`;
        });

        message += `_ℹ️ History is retained for 7 days. Download important results before they expire._`;

        await ctx.replyWithMarkdown(message, { disable_web_page_preview: true, ...linkedKeyboard });
    } catch (err) {
        console.error("Error fetching check history:", err);
        ctx.reply("❌ Failed to fetch your check history. Please try again later.", linkedKeyboard);
    }
});

// ======================================================================
// 🔗 API KEY — View, generate or regenerate API key
// ======================================================================
bot.hears("🔗 API Key", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user) {
            return ctx.reply("Please link your account first via /start.", unlinkedKeyboard);
        }

        if (!user.vip) {
            return ctx.replyWithMarkdown(
                `🔒 *Premium Feature*\n\nAPI access requires a VIP subscription.\n\n💎 Upgrade your plan to get API access!\n\n🌐 [Upgrade Now](${WEBSITE_URL}/plans)`,
                linkedKeyboard
            );
        }

        if (!user.apiaccess) {
            return ctx.replyWithMarkdown(
                `⚠️ *API Access Not Enabled*\n\nYou have a VIP subscription but API access is not enabled on your account.\n\nPlease contact support to enable API access:\n📩 [Contact Support](https://t.me/Royalsoftechstudios)`,
                { disable_web_page_preview: true, ...linkedKeyboard }
            );
        }

        if (user.apiKey) {
            const createdDate = user.apiKeyCreatedAt
                ? new Date(user.apiKeyCreatedAt).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                })
                : "Unknown";

            let message = `🔑 *Your API Key*\n\n`;
            message += `\`${user.apiKey}\`\n\n`;
            message += `📅 *Generated:* ${createdDate}\n\n`;
            message += `⚠️ _Keep this key secret! Do not share it publicly._\n\n`;
            message += `📄 API Docs: ${WEBSITE_URL}/api-docs`;

            const inlineKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🔄 Regenerate API Key", "REGEN_API_KEY")]
            ]);

            return ctx.replyWithMarkdown(message, inlineKeyboard);
        } else {
            let message = `🔑 *API Key Management*\n\n`;
            message += `You don't have an API key yet.\n\n`;
            message += `Generate one to start using the Email Scan API programmatically!\n\n`;
            message += `📄 API Docs: ${WEBSITE_URL}/api-docs`;

            const inlineKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🆕 Generate API Key", "GEN_API_KEY")]
            ]);

            return ctx.replyWithMarkdown(message, inlineKeyboard);
        }
    } catch (err) {
        console.error("Error in API Key handler:", err);
        ctx.reply("❌ Failed to fetch API key info. Please try again later.", linkedKeyboard);
    }
});

// Inline callbacks for API key generation/regeneration
bot.action("GEN_API_KEY", async (ctx) => {
    try {
        await ctx.answerCbQuery("Generating API key...");
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user || !user.vip || !user.apiaccess) {
            return ctx.editMessageText("❌ Unable to generate key. Ensure you have VIP + API access.");
        }

        const apiKey = crypto.randomBytes(18).toString("hex");
        user.apiKey = apiKey;
        user.apiKeyCreatedAt = new Date();
        await user.save();

        let message = `✅ *API Key Generated Successfully!*\n\n`;
        message += `\`${apiKey}\`\n\n`;
        message += `📅 *Generated:* ${new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })}\n\n`;
        message += `⚠️ _Keep this key secret! Do not share it publicly._\n\n`;
        message += `📄 API Docs: ${WEBSITE_URL}/api-docs`;

        const inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Regenerate API Key", "REGEN_API_KEY")]
        ]);

        await ctx.editMessageText(message, { parse_mode: "Markdown", ...inlineKeyboard });
    } catch (err) {
        console.error("Error generating API key:", err);
        ctx.answerCbQuery("❌ Failed to generate key.").catch(() => { });
    }
});

bot.action("REGEN_API_KEY", async (ctx) => {
    try {
        await ctx.answerCbQuery("Regenerating API key...");
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user || !user.vip || !user.apiaccess) {
            return ctx.editMessageText("❌ Unable to regenerate key. Ensure you have VIP + API access.");
        }

        const apiKey = crypto.randomBytes(18).toString("hex");
        user.apiKey = apiKey;
        user.apiKeyCreatedAt = new Date();
        await user.save();

        let message = `✅ *API Key Regenerated!*\n\n`;
        message += `\`${apiKey}\`\n\n`;
        message += `📅 *Generated:* ${new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })}\n\n`;
        message += `⚠️ _Your old key has been invalidated. Update it in all your applications._\n\n`;
        message += `📄 API Docs: ${WEBSITE_URL}/api-docs`;

        const inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Regenerate Again", "REGEN_API_KEY")]
        ]);

        await ctx.editMessageText(message, { parse_mode: "Markdown", ...inlineKeyboard });
    } catch (err) {
        console.error("Error regenerating API key:", err);
        ctx.answerCbQuery("❌ Failed to regenerate key.").catch(() => { });
    }
});

// ======================================================================
// 📄 API DOCS — Quick reference for the Email Scan API
// ======================================================================
bot.hears("📄 API Docs", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user) {
            return ctx.reply("Please link your account first via /start.", unlinkedKeyboard);
        }

        let message = `📄 *Email Verification API — Quick Reference*\n\n`;
        message += `*Endpoint:*\n\`POST ${WEBSITE_URL}/api/v1/email-check\`\n\n`;
        message += `*Authentication:*\nAdd header: \`x-api-key: YOUR_API_KEY\`\n\n`;
        message += `*Request Body (JSON):*\n`;
        message += `\`\`\`\n["email1@gmail.com", "email2@gmail.com"]\n\`\`\`\n\n`;
        message += `*Response:*\n`;
        message += `\`\`\`\n{\n  "LIVE": "email1@gmail.com",\n  "LIVE_COUNT": 1,\n  "DISABLED": "email2@gmail.com",\n  "DISABLED_COUNT": 1,\n  "NOTEXISTS": "",\n  "NOTEXISTS_COUNT": 0,\n  "shareId": "abc12345"\n}\n\`\`\`\n\n`;
        message += `*Limits:* Up to 50,000 emails per request\n\n`;
        message += `*Status Codes:*\n`;
        message += `• \`200\` — Success\n`;
        message += `• \`400\` — Invalid request\n`;
        message += `• \`401\` — Invalid/missing API key\n`;
        message += `• \`403\` — No VIP/API access\n`;
        message += `• \`500\` — Server error\n\n`;
        message += `*Requirements:*\n`;
        message += `• Active VIP subscription\n`;
        message += `• API access enabled\n`;
        message += `• Valid API key (generate via 🔗 API Key)\n\n`;
        message += `📖 Full API Docs: ${WEBSITE_URL}/api-docs\n`;
        message += `📩 Support: https://t.me/Royalsoftechstudios`;

        await ctx.replyWithMarkdown(message, { disable_web_page_preview: true, ...linkedKeyboard });
    } catch (err) {
        console.error("Error showing API docs:", err);
        ctx.reply("❌ Failed to load API docs. Please try again.", linkedKeyboard);
    }
});

// ======================================================================
// History pagination via inline buttons
// ======================================================================
bot.action(/^HISTORY_PAGE_(\d+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1]);
        const telegramId = ctx.from.id.toString();
        const user = await User.findOne({ telegramId });

        if (!user || !user.vip) return;

        const pageSize = 5;
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const total = await CheckingLog.countDocuments({
            email: user.email,
            createdAt: { $gte: sevenDaysAgo }
        });

        const totalPages = Math.ceil(total / pageSize);

        const logs = await CheckingLog.find({
            email: user.email,
            createdAt: { $gte: sevenDaysAgo }
        })
            .sort({ createdAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean();

        if (!logs.length) return;

        let message = `📜 *Check History — Page ${page}/${totalPages}*\n\n`;

        logs.forEach((log, index) => {
            const sNo = (page - 1) * pageSize + index + 1;
            const date = new Date(log.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const status = log.status || {};
            const total = log.checkingcount || 0;
            const shareLink = `${WEBSITE_URL}/?share=${log.shareId}`;

            message += `*${sNo}.* 📅 ${date}\n`;
            message += `   📊 Total: *${total}* | ✅ ${status.Good || 0} | ❌ ${status.Disable || 0} | ⚠️ ${status.NotExist || 0}\n`;
            message += `   🔗 ${shareLink}\n\n`;
        });

        const buttons = [];
        if (page > 1) buttons.push(Markup.button.callback("⬅️ Prev", `HISTORY_PAGE_${page - 1}`));
        buttons.push(Markup.button.callback(`${page}/${totalPages}`, "NOOP"));
        if (page < totalPages) buttons.push(Markup.button.callback("Next ➡️", `HISTORY_PAGE_${page + 1}`));

        await ctx.editMessageText(message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            ...Markup.inlineKeyboard([buttons])
        });
    } catch (err) {
        console.error("Error in history pagination:", err);
    }
});

bot.action("NOOP", (ctx) => ctx.answerCbQuery().catch(() => { }));

bot.hears("🌐 Visit Website", (ctx) => {
    ctx.reply(`Opening website: ${WEBSITE_URL}`).catch(() => {});
});

bot.hears("🚪 Logout", async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        // Clear all telegram fields on logout
        await User.updateOne(
            { telegramId },
            {
                $unset: {
                    telegramId: "",
                    telegramChatId: "",
                    telegramUsername: "",
                    telegramLinkToken: "",
                    telegramLinkTokenExpires: ""
                }
            }
        );
        await ctx.reply("You have been logged out and your account has been unlinked.", Markup.removeKeyboard());
        return ctx.reply("Type /start to login or sign up again.");
    } catch (err) {
        console.error("Logout error:", err);
        ctx.reply("Logout failed. Please try again.");
    }
});

// Launch bot
bot.launch().then(() => {
    console.log("🤖 Telegram Bot is running!");
}).catch(err => {
    console.error("❌ Failed to launch bot:", err);
});

// --- Global Error Handling for Process ---
process.on("uncaughtException", (err) => {
    console.error("💥 UNCAUGHT EXCEPTION:", err);
    // In production, you might want to restart the process
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("💥 UNHANDLED REJECTION at:", promise, "reason:", reason);
});

// Enable graceful stop
process.once("SIGINT", () => {
    console.log("SIGINT received. Stopping...");
    bot.stop("SIGINT");
    process.exit(0);
});
process.once("SIGTERM", () => {
    console.log("SIGTERM received. Stopping...");
    bot.stop("SIGTERM");
    process.exit(0);
});
