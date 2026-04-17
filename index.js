const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");

// Render Keep-Alive Server
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is Active"));
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", 
    systemInstruction: "You are a helpful business assistant." 
});

const lastManualReplyTime = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        browser: ["RenderBot", "Chrome", "1.0.0"],
        // REMOVED printQRInTerminal: true because it's deprecated
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // MANUALLY PRINT QR CODE
        if (qr) {
            console.log("--- SCAN THE QR CODE BELOW ---");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed. Reconnecting in 5 seconds...", shouldReconnect);
            // Added a 5-second delay to prevent the "Connection Failure" loop
            await delay(5000);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log("✅ Bot connected successfully!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;

        // STATUS INTERACTION
        if (jid === 'status@broadcast') {
            try {
                await sock.readMessages([msg.key]);
                const emojis = ["🔥", "👏", "🙌", "❤️"];
                await delay(3000);
                await sock.sendMessage(jid, { 
                    react: { text: emojis[Math.floor(Math.random() * 4)], key: msg.key } 
                }, { statusForward: true });
            } catch (e) {}
            return;
        }

        // AI AUTO-REPLY
        const isMe = msg.key.fromMe;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (isMe) {
            lastManualReplyTime[jid] = Date.now();
            return;
        }

        if (text && !jid.endsWith('@g.us')) {
            const lastManual = lastManualReplyTime[jid] || 0;
            const fiveMinutes = 5 * 60 * 1000;
            if (Date.now() - lastManual > fiveMinutes) {
                try {
                    const result = await model.generateContent(text);
                    await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
                } catch (err) { console.error("Gemini Error:", err); }
            }
        }
    });
}

startBot();
