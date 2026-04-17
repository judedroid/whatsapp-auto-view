const { makeWASocket, useMultiFileAuthState, DisconnectReason, delay, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is Active"));
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction: "You are a helpful business assistant." });
const lastManualReplyTime = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
        printQRInTerminal: true,
        browser: ["RenderBot", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
        if (u.qr) qrcode.generate(u.qr, { small: true });
        if (u.connection === "close") startBot();
        if (u.connection === "open") console.log("✅ Connected!");
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;

        // STATUS VIEW & REACT
        if (jid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            const emojis = ["🔥", "👏", "🙌", "❤️"];
            await delay(2000);
            await sock.sendMessage(jid, { react: { text: emojis[Math.floor(Math.random()*4)], key: msg.key } }, { statusForward: true });
            return;
        }

        // AI AUTO-REPLY (5 MINUTE RULE)
        if (msg.key.fromMe) { lastManualReplyTime[jid] = Date.now(); return; }
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            const last = lastManualReplyTime[jid] || 0;
            if (Date.now() - last > 300000) {
                const result = await model.generateContent(text);
                await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
            }
        }
    });
}
startBot();
