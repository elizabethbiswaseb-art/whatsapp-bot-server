const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

let sock;
let currentRawQR = '';
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"],
        keepAliveIntervalMs: 30000, // ৩০ সেকেন্ড পর পর কানেকশন লাইভ রাখবে
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentRawQR = qr;
            isConnected = false;
        }

        if (connection === 'close') {
            isConnected = false;
            currentRawQR = '';

            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Connection closed. Reason Status Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
                // ২ সেকেন্ড পর অটো রিকানেক্ট
                setTimeout(connectToWhatsApp, 2000);
            } else {
                console.log('Logged out from WhatsApp. Please scan QR code again.');
            }
        } else if (connection === 'open') {
            console.log('Connected successfully to WhatsApp!');
            isConnected = true;
            currentRawQR = '';
        }
    });
}

// Render Server Keep-Alive Ping Engine (সার্ভারকে ঘুমাতে দেবে না)
setInterval(() => {
    if (isConnected && sock) {
        sock.sendPresenceUpdate('available').catch(() => { });
    }
}, 45000);

const handleQR = async (req, res) => {
    if (isConnected) {
        return res.send(`
            <html>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;background:#f0f2f5;">
                    <div style="text-align:center;background:white;padding:40px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color:#25D366;">✔ WhatsApp Connected Successfully!</h2>
                        <p>Your bot is live and working properly.</p>
                    </div>
                </body>
            </html>
        `);
    }

    if (currentRawQR) {
        try {
            const qrImageUrl = await QRCode.toDataURL(currentRawQR);
            return res.send(`
                <html>
                    <head>
                        <title>Scan WhatsApp QR</title>
                        <meta http-equiv="refresh" content="3">
                    </head>
                    <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;background:#f0f2f5;">
                        <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                            <h2 style="color:#128C7E;margin-top:0;">Scan QR Code with WhatsApp</h2>
                            <img src="${qrImageUrl}" style="width:280px;height:280px;border:2px solid #25D366;padding:10px;border-radius:8px;" />
                            <p style="color:#888;font-size:12px;margin-top:15px;">Auto-refreshing every 3 seconds...</p>
                        </div>
                    </body>
                </html>
            `);
        } catch (err) {
            return res.status(500).send('Error rendering QR Code');
        }
    }

    return res.send(`
        <html>
            <head>
                <title>Connecting...</title>
                <meta http-equiv="refresh" content="3">
            </head>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;">
                <h3 style="color:#555;">Generating new QR Code, please wait 3 seconds...</h3>
            </body>
        </html>
    `);
};

app.get('/', handleQR);
app.get('/qr', handleQR);

app.get('/ping', (req, res) => res.send('PONG'));

app.get('/reset-session', (req, res) => {
    if (fs.existsSync('auth_session')) {
        fs.rmSync('auth_session', { recursive: true, force: true });
        isConnected = false;
        currentRawQR = '';
        setTimeout(() => connectToWhatsApp(), 2000);
        return res.send("Session deleted! Now go to /qr to scan new QR code.");
    }
    return res.send("No session found. Go to /qr to scan.");
});

app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) {
        return res.status(400).json({ error: 'Number and message are required' });
    }

    if (!sock || !isConnected) {
        return res.status(503).json({ error: 'WhatsApp is not connected yet' });
    }

    try {
        let jid = number.trim();
        if (!jid.includes('@')) {
            jid = `${jid}@s.whatsapp.net`;
        }

        await sock.sendMessage(jid, { text: message });
        return res.json({ status: 'success', message: 'Sent successfully' });
    } catch (error) {
        console.error("Sending Error:", error);
        return res.status(500).json({ status: 'error', error: error.message || 'Failed to send message' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});