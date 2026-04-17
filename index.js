const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    makeCacheableSignalKeyStore,
    Browsers 
} = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");

// Keep-Alive Server
const app = express();
const PORT = process.env.PORT || 10000;
app.get("/", (req, res) => res.send("Bot Status: Active"));
app.listen(PORT, '0.0.0.0', () => console.log(`Health Server Port ${PORT}`));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", 
    systemInstruction: "You are a professional business assistant." 
});

const lastManualReplyTime = {};

async function startBot() {
    // 1. Session folder
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // 2. Socket Config
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        // TRICK: Identifies as a real Desktop Chrome on MacOS
        browser: Browsers.macOS('Chrome'),
        connectTimeoutMs: 120000, // Wait 2 mins to connect
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📢 !!! QR CODE DETECTED !!!");
            console.log("Zoom out your browser (Ctrl and -) so the QR code is square!");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection Error Code: ${reason}`);
            
            // If it's not a manual logout, wait 20 seconds and retry
            // Longer delay prevents WhatsApp from temporary-banning the IP
            if (reason !== DisconnectReason.loggedOut) {
                console.log("IP flagged or connection lost. Cooling down for 20s before retry...");
                await delay(20000); 
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ SUCCESS: WhatsApp is Connected!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;

        // STATUS AUTO-VIEW & REACT
        if (jid === 'status@broadcast') {
            try {
                await sock.readMessages([msg.key]);
                const emojis = ["🔥", "👏", "🙌", "❤️"];
                await delay(Math.floor(Math.random() * 5000) + 3000);
                await sock.sendMessage(jid, { 
                    react: { text: emojis[Math.floor(Math.random() * 4)], key: msg.key } 
                }, { statusForward: true });
            } catch (e) {}
            return;
        }

        // AI AUTO-REPLY
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            const last = lastManualReplyTime[jid] || 0;
            if (Date.now() - last > 300000) { // 5 Minute Rule
                try {
                    const result = await model.generateContent(text);
                    await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
                } catch (err) { console.error("AI Error:", err); }
            }
        }
    });
}

// Global error handler
process.on('uncaughtException', (err) => {
    console.log('Detected Error, restarting...:', err.message);
    if (!err.message.includes('Mismatched')) startBot();
});

startBot();
