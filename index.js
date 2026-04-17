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
const readline = require("readline");

const app = express();
app.get("/", (req, res) => res.send("Bot is Active"));
app.listen(process.env.PORT || 10000, '0.0.0.0');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Phone number for pairing (Include country code, e.g., 256...)
const phoneNumber = "YOUR_PHONE_NUMBER_HERE"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false, // We are using Pairing Code instead
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu('Chrome'),
    });

    // PAIRING CODE LOGIC
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            console.log("\n--- WHATSAPP PAIRING CODE ---");
            console.log(`YOUR CODE IS: ${code}`);
            console.log("-----------------------------\n");
            console.log("Instructions: Open WhatsApp -> Settings -> Linked Devices -> Link with Phone Number.");
        }, 5000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log("Reconnecting...");
                setTimeout(() => startBot(), 10000);
            }
        } else if (connection === "open") {
            console.log("✅ SUCCESS: Connected!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;

        // STATUS VIEW & REACT
        if (jid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await delay(3000);
            await sock.sendMessage(jid, { react: { text: "❤️", key: msg.key } }, { statusForward: true });
            return;
        }

        // AI REPLY
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            const result = await model.generateContent(text);
            await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
        }
    });
}

startBot();
