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

// 1. Render Port Binding
const app = express();
app.get("/", (req, res) => res.send("Bot Status: Ready for Pairing"));
app.listen(process.env.PORT || 10000, '0.0.0.0');

// 2. Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const myNumber = "256755190711"; 

async function startBot() {
    // Delete any old session data to start fresh (fixes corrupted files)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        // TRICK: Identifies as Windows Chrome (Very stable)
        browser: Browsers.appropriate('Desktop'),
        connectTimeoutMs: 120000,
        keepAliveIntervalMs: 30000,
    });

    // Request Pairing Code
    if (!sock.authState.creds.registered) {
        console.log("⏳ Waiting 15 seconds for connection to stabilize...");
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(myNumber);
                console.log("\n----------------------------");
                console.log(`👉 YOUR PAIRING CODE: ${code}`);
                console.log("----------------------------\n");
            } catch (err) {
                console.log("Error getting code (IP likely blocked). Retrying in 1 minute...");
            }
        }, 15000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed. Code: ${reason}`);

            // ANTI-405 LOGIC: If flagged, wait 10 MINUTES instead of 5 seconds
            if (reason === 405 || reason === 401) {
                console.log("🚩 405 ERROR DETECTED. WhatsApp flagged the IP. Cooling down for 10 minutes...");
                await delay(600000); // 10 minute wait
                startBot();
            } else if (reason !== DisconnectReason.loggedOut) {
                await delay(10000);
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ SUCCESS: WhatsApp Connected!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;

        // Auto-View Status
        if (jid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await sock.sendMessage(jid, { react: { text: "❤️", key: msg.key } }, { statusForward: true });
            return;
        }

        // Gemini AI Response
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            try {
                const result = await model.generateContent(text);
                await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
            } catch (e) { console.log("AI Error"); }
        }
    });
}

startBot();
