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

const app = express();
app.get("/", (req, res) => res.send("Bot status: Running"));
app.listen(process.env.PORT || 10000, '0.0.0.0');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "You are a helpful business assistant."
});

// IMPORTANT: Put your number here!
const phoneNumber = "YOUR_PHONE_NUMBER_HERE"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu('Chrome'),
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            console.log("\n----------------------------");
            console.log(`YOUR PAIRING CODE: ${code}`);
            console.log("----------------------------\n");
        }, 5000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log("Reconnecting...");
                setTimeout(() => startBot(), 8000);
            }
        } else if (connection === "open") {
            console.log("✅ Bot is online and connected!");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;

        if (jid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            const emojis = ["🔥", "👏", "🙌", "❤️"];
            await delay(3000);
            await sock.sendMessage(jid, { react: { text: emojis[Math.floor(Math.random()*4)], key: msg.key } }, { statusForward: true });
            return;
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text && !jid.endsWith('@g.us')) {
            try {
                const result = await model.generateContent(text);
                await sock.sendMessage(jid, { text: result.response.text() }, { quoted: msg });
            } catch (e) { console.log("Gemini Error"); }
        }
    });
}
startBot();
