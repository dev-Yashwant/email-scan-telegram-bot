const { Scenes, Markup } = require("telegraf");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { handleTelegramDocument } = require("../services/scanner");

// Shared keyboard definitions
const linkedKeyboard = Markup.keyboard([
    ["👤 Profile", "📧 Check Accounts"],
    ["📜 Check History", "🔗 API Key"],
    ["📄 API Docs", "🌐 Visit Website"],
    ["🚪 Logout"]
], {
    input_field_placeholder: "Choose an action or send a file...",
    is_persistent: true
}).resize();

// --- Login Wizard ---
const loginWizard = new Scenes.WizardScene(
    "LOGIN_SCENE",
    async (ctx) => {
        try {
            await ctx.reply("Please enter your registered Email address:", Markup.forceReply());
            return ctx.wizard.next();
        } catch (error) {
            console.error("Login scene start error:", error);
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply("Please enter a valid email address:");
                return;
            }
            const email = ctx.message.text.trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                await ctx.reply("❌ Invalid email format. Please try again:", Markup.forceReply());
                return;
            }
            ctx.wizard.state.email = email;

            await ctx.reply("Please enter your password:", Markup.forceReply());
            return ctx.wizard.next();
        } catch (error) {
            console.error("Login email step error:", error);
            await ctx.reply("An error occurred. Returning to menu.");
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply("Please enter your password:");
                return;
            }
            const password = ctx.message.text;
            const email = ctx.wizard.state.email;
            const telegramId = ctx.from.id.toString();

            // Delete the message containing the password for security
            try { await ctx.deleteMessage(); } catch (e) { }

            const user = await User.findOne({ email });
            if (!user) {
                await ctx.reply("❌ Account not found with that email. Please try again with /start.");
                return ctx.scene.leave();
            }

            if (user.provider !== "local") {
                await ctx.reply("❌ This account was created via social login. Please login via the website and link your Telegram account there.");
                return ctx.scene.leave();
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                await ctx.reply("❌ Invalid password. Please try again with /start.");
                return ctx.scene.leave();
            }

            // check if another user has this telegram id
            const existingTelegramUser = await User.findOne({ telegramId, email: { $ne: email } });
            if (existingTelegramUser) {
                // unlink previous user and link to this one
                await User.updateOne({ _id: existingTelegramUser._id }, { $unset: { telegramId: "" } });
            }

            user.telegramId = telegramId;
            user.telegramChatId = ctx.chat.id.toString();
            user.telegramUsername = ctx.from.username || undefined;
            user.socialUsername = `(${ctx.from.id})[@${ctx.from.username || 'N/A'}]`;
            await user.save();

            let message = `Successfully linked your account! 🎉\n\n`;
            message += `*Your Account Status:*\n`;
            message += `- Plan: ${user.vip ? "VIP ⭐️" : "Free Player"}\n`;
            message += `- API Access: ${user.apiaccess ? "Enabled ✅" : "Disabled ❌"}\n\n`;
            message += `Use the menu below to navigate.`;

            await ctx.replyWithMarkdown(message, linkedKeyboard);

            return ctx.scene.leave();
        } catch (error) {
            console.error("Login Error:", error);
            await ctx.reply("An error occurred during login. Please try again later.");
            return ctx.scene.leave();
        }
    }
);

// --- Sign Up Wizard ---
const signupWizard = new Scenes.WizardScene(
    "SIGNUP_SCENE",
    async (ctx) => {
        try {
            await ctx.reply("Let's create your account!\n\nPlease enter your Email address:", Markup.forceReply());
            return ctx.wizard.next();
        } catch (error) {
            console.error("Signup scene start error:", error);
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply("Please enter a valid email address:");
                return;
            }
            const email = ctx.message.text.trim().toLowerCase();

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                await ctx.reply("❌ Please enter a valid email address:", Markup.forceReply());
                return;
            }

            // Check if email exists
            const exists = await User.findOne({ email });
            if (exists) {
                await ctx.reply("❌ An account with that email already exists. Please enter a different email (or /start to login):", Markup.forceReply());
                return;
            }

            ctx.wizard.state.email = email;
            await ctx.reply("Great! Now please enter a Password.\n\n_Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character._", { parse_mode: "Markdown", ...Markup.forceReply() });
            return ctx.wizard.next();
        } catch (error) {
            console.error("Signup email step error:", error);
            await ctx.reply("An error occurred. Returning to menu.");
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply("Please enter a valid password:");
                return;
            }
            const password = ctx.message.text;

            const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).+$/;
            if (password.length < 8 || !pwdRegex.test(password)) {
                await ctx.reply("❌ Password is too weak. Please ensure it is 8+ chars and has uppercase, lowercase, number, and special character:", Markup.forceReply());
                return;
            }

            // Delete the message containing the password for security
            try { await ctx.deleteMessage(); } catch (e) { }

            const { email } = ctx.wizard.state;
            const telegramId = ctx.from.id.toString();

            // Generate a random username (e.g. user_738291)
            const randomSuffix = Math.floor(100000 + Math.random() * 900000);
            const username = `user_${randomSuffix}`;

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // check if another user has this telegram id
            const existingTelegramUser = await User.findOne({ telegramId });
            if (existingTelegramUser) {
                await User.updateOne({ _id: existingTelegramUser._id }, { $unset: { telegramId: "" } });
            }

            const newUser = new User({
                username,
                email,
                password: hashedPassword,
                provider: "local",
                telegramId,
                telegramChatId: ctx.chat.id.toString(),
                telegramUsername: ctx.from.username || undefined,
                socialUsername: `(${ctx.from.id})[@${ctx.from.username || 'N/A'}]`,
                registrationSource: "bot",
                vip: false,
                apiaccess: false
            });

            await newUser.save();

            let message = `Account created successfully! 🎉\n\n`;
            message += `*Username:* \`${username}\` (Generated automatically)\n`;
            message += `*Email:* ${email}\n\n`;
            message += `*Your Account Status:*\n`;
            message += `- Plan: Free Player\n`;
            message += `- API Access: Disabled ❌\n\n`;
            message += `Use the menu below to navigate.`;

            await ctx.replyWithMarkdown(message, linkedKeyboard);

            return ctx.scene.leave();
        } catch (error) {
            console.error("Signup Error:", error);
            await ctx.reply("An error occurred during signup. Please try again later.");
            return ctx.scene.leave();
        }
    }
);

// --- Upload Document Wizard ---
const uploadWizard = new Scenes.WizardScene(
    "UPLOAD_SCENE",
    async (ctx) => {
        try {
            const telegramId = ctx.from.id.toString();
            const user = await User.findOne({ telegramId });

            if (!user) {
                await ctx.reply("Please link your account first via /start.");
                return ctx.scene.leave();
            }

            if (!user.vip) {
                await ctx.reply("⭐ *VIP Feature*\n\nEmail checking is currently exclusive to VIP members. Please visit the website to upgrade your plan!\n\n🌐 https://emailscan.in", { parse_mode: 'Markdown' });
                return ctx.scene.leave();
            }

            await ctx.reply("Please upload a `.txt` file containing the emails/usernames you want to scan.\n\n_Make sure there is one entry per line._", { parse_mode: "Markdown" });
            return ctx.wizard.next();
        } catch (error) {
            console.error("Upload scene start error:", error);
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        try {
            if (!ctx.message) return;

            // Allow users to exit the scene by clicking other menu buttons or typing /cancel
            if (ctx.message.text) {
                const text = ctx.message.text;
                const exitCommands = [
                    "/cancel", "🚪 Logout", "👤 Profile", "🌐 Visit Website",
                    "📜 Check History", "🔗 API Key", "📄 API Docs"
                ];
                if (exitCommands.includes(text)) {
                    await ctx.reply("Returning to main menu...");
                    return ctx.scene.leave();
                }
            }

            if (ctx.message.document) {
                const telegramId = ctx.from.id.toString();
                const user = await User.findOne({ telegramId });

                if (user) {
                    await handleTelegramDocument(ctx, user);
                } else {
                    await ctx.reply("Session expired. Please start again.");
                }
                return ctx.scene.leave();
            }

            await ctx.reply("❌ Invalid input. Please upload a `.txt` file or tap a menu button to cancel.");
        } catch (error) {
            console.error("Upload document step error:", error);
            await ctx.reply("An error occurred. Returning to menu.");
            return ctx.scene.leave();
        }
    }
);

module.exports = { loginWizard, signupWizard, uploadWizard };
