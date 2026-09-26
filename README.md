# 📧 Email Scan Telegram Bot

A high-performance, standalone Node.js service for scanning email lists via Telegram. Built with Telegraf, it seamlessly integrates with your existing Email-Scan ecosystem, sharing the same MongoDB backend for unified user management and VIP features.

## ✨ Features

- **🔑 Secure Authentication**: Link your Telegram to your website account using Login/Signup wizards, or auto-link via website deep-links.
- **📁 Auto-File Processing**: Upload `.txt` files containing email lists for instant scanning with downloadable results.
- **🔗 File Sharing Links**: Every scan generates a unique shareable link to view results on the web app.
- **📜 Check History**: View your last 10 scan results from the past 7 days, with status breakdowns and share links.
- **🔑 API Key Management**: Generate, view, and regenerate your API key directly from Telegram.
- **📄 API Docs Reference**: Quick-reference API documentation card with endpoint, auth, and code examples.
- **🌟 VIP Exclusive Access**: Integrated plan management to ensure premium features are reserved for VIP members.
- **📊 Real-time Profile**: Monitor your plan status, expiry date, API key, and access directly from Telegram.
- **🌐 Website Integration**: Unified database for consistent cross-platform user experience.
- **📈 Monitoring Dashboard**: Web dashboard at port 4000 showing user stats and activity.

---

## 📂 Project Structure

```text
email-scan-telegram-bot/
├── 🤖 bot/
│   └── scenes.js       # Interactive multi-step wizards (Login, Signup, Upload)
├── ⚙️ config/
│   └── db.js           # MongoDB connection management with retry
├── 🗄️ models/
│   ├── User.js         # Unified User schema (shared with web app)
│   └── CheckingLog.js  # Scan activity logging with shareId
├── 🛠️ scripts/          # Administrative & Diagnostic utilities
│   ├── check_linked.js # View all Telegram-linked users
│   ├── check_logs.js   # Audit recent scanning logs
│   ├── diagnostic.js   # Verify database & connection health
│   └── list_dbs.js     # List available databases
├── 🚀 services/
│   └── scanner.js      # Core scanning logic, file handling, & share links
├── 🖥️ views/
│   └── index.ejs       # Monitoring dashboard template
├── 📄 index.js         # Bot entry point, commands, history, API key, docs
├── 📝 HOW_TO_RUN.txt   # Complete setup & testing guide
└── 📝 README.md        # This file
```

---

## 🛠️ Setup & Installation

### 1️⃣ Prerequisites
- **Node.js**: v18+ recommended.
- **MongoDB**: Access to the production/dev database URI.
- **Telegram Token**: Get one from [@BotFather](https://t.me/BotFather).

### 2️⃣ Installation
```bash
npm install
```

### 3️⃣ Environment Configuration
Create or edit your `.env` file:
```env
TELEGRAM_BOT_TOKEN="your_bot_token"
MONGODB_URI="your_mongodb_connection_string"
FRONTEND_URL="http://localhost:3000"
DASHBOARD_PORT=4000
VIP_GMAIL_CHECK_URL="http://65.109.63.238:5000/process-emails"
```

### 4️⃣ Launching the Bot
```bash
# Production
npm start

# Development
npm run dev
```

> 📖 For the complete setup guide including running both the web app and bot simultaneously, see [HOW_TO_RUN.txt](HOW_TO_RUN.txt).

---

## 🤖 Bot Menu & Commands

### Telegram Menu Layout (After Login)
```
┌─────────────────┬──────────────────┐
│  👤 Profile     │  📧 Check Accts  │
├─────────────────┼──────────────────┤
│  📜 Check Hist  │  🔗 API Key      │
├─────────────────┼──────────────────┤
│  📄 API Docs    │  🌐 Website      │
├─────────────────┴──────────────────┤
│          🚪 Logout                 │
└────────────────────────────────────┘
```

### Feature Details

| Button | Feature | VIP Required |
|--------|---------|:------------:|
| 👤 Profile | View username, email, plan, expiry, API status | No |
| 📧 Check Accounts | Upload .txt file to scan emails | Yes |
| 📜 Check History | View last 10 scans (7-day window) with share links | Yes |
| 🔗 API Key | Generate/view/regenerate your API key | Yes + API Access |
| 📄 API Docs | Quick reference for the Email Scan API | No |
| 🌐 Visit Website | Open the web app | No |
| 🚪 Logout | Unlink Telegram from your account | No |

### Scan Results with Share Links
After every successful scan, the bot sends:
- A downloadable `scan_results.txt` file
- A summary with Good/Disabled/NotExist counts
- A **shareable link** (`{FRONTEND_URL}/history?uuid={shareId}`) to view full results on the web

---

## 🛠️ Developer Scripts
Located in the `scripts/` directory for system maintenance:
- `node scripts/diagnostic.js`: Quick health check for DB connectivity.
- `node scripts/check_linked.js`: List all users currently using the bot.
- `node scripts/check_logs.js`: View recent scan activity logs.
- `node scripts/list_dbs.js`: List available MongoDB databases.

---

## ⚖️ License
This project is licensed under the ISC License.
