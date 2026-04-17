const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    makeCacheableSignalKeyStore,
    Browsers 
} = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pino = require("pino");
const express = require("express");

// 1. Web Server for Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get("/", (req, res) => res.send("Bot is Active"));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Server started on port ${PORT}`));

// 2. Gemini AI Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "dummy_key");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 3. Your Phone Number
const myNumber = "256755190711"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        // Identifies as a real browser
        browser: Browsers.macOS('Chrome'),
    });

    // PAIRING CODE PROCESS
    if (!sock.authState.creds.registered) {
        console.log(`\n⏳ Requesting pairing code for: ${myNumber}...`);
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(myNumber);
                console.log("\n==============================");
                console.log(`👉 YOUR WHATSAPP CODE IS: ${code}`);
                console.log("==============================\n");
                console.log("STEPS TO LINK:");
                console.log("1. Open WhatsApp on your phone.");
                console.log("2. Go to Settings > Linked Devices.");
                console.log("3. Tap 'Link a Device'.");
                console.log("4. Tap 'Link with phone number instead' at the bottom.");
                console.log(`5. Enter the code: ${code}`);
            } catch (e) {
                console.log("Error requesting pairing code. Try redeploying:", e.message);
            }
        }, 10000); // Waits 10 seconds for the server to be ready
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed. Code: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log("Reconnecting...");
                setTimeout(() => startBot(), 10000);
            }
        } else if (connection === "open") {
            console.log("✅ SUCCESS: Your WhatsApp is now LINKED and BOT IS LIVE!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;

        // STATUS AUTO-VIEW & REACT
        if (jid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            const emojis = ["🔥", "👏", "🙌", "❤️"];
            await delay(3000);
            await sock.sendMessage(jid, { react: { text: emojis[Math.floor(Math.random()*4)], key: msg.key } }, { statusForward: true });
            return;
        }

        // AI AUTO-REPLY
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            try {
                const result = await model.generateContent(text);
                await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
            } catch (e) { console.log("AI error: Check your API Key."); }
        }
    });
}

// Global crash protection
process.on('uncaughtException', (err) => console.log("Caught error:", err.message));

startBot();
