const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let sock;
let currentRawQR = ''; // কাঁচা QR স্ট্রিং রাখার জন্য

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Mac OS", "Chrome", "10.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentRawQR = qr; // নতুন QR আসলেই আপডেট হবে
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Connected successfully!');
            currentRawQR = ''; // কানেক্ট হলে QR মুছে যাবে
        }
    });
}

// ব্রাউজারে QR কোড অটো-জেনারেট করে দেখানোর রুট
app.get('/qr', async (req, res) => {
    if (currentRawQR) {
        try {
            const qrImageUrl = await QRCode.toDataURL(currentRawQR);
            res.send(`
                <html>
                    <head><title>Scan WhatsApp QR</title></head>
                    <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;">
                        <h2>Scan this QR code with WhatsApp</h2>
                        <img src="${qrImageUrl}" style="width:300px;height:300px;border:2px solid #ccc;padding:10px;border-radius:8px;" />
                        <p>Page will refresh automatically if needed.</p>
                    </body>
                </html>
            `);
        } catch (err) {
            res.status(500).send('Error generating QR image');
        }
    } else {
        res.send('<h2 style="text-align:center;margin-top:20%;font-family:sans-serif;">QR Code Unavailable or Already Connected!</h2>');
    }
});

// ব্লগের পোস্ট পাওয়ার রুট (Atom Feed)
app.get('/get-blog-posts', async (req, res) => {
    try {
        const blogUrl = req.query.url || 'https://elizabethfolio.blogspot.com/feeds/posts/default';
        const response = await axios.get(blogUrl);
        const parser = new xml2js.Parser();

        parser.parseString(response.data, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Feed parsing failed' });
            }

            const entries = result.feed.entry || [];
            const posts = entries.map(entry => {
                const linkObj = entry.link.find(l => l.$.rel === 'alternate');
                return {
                    title: entry.title[0]._,
                    link: linkObj ? linkObj.$.href : '',
                    published: entry.published ? entry.published[0] : ''
                };
            });

            res.json({ status: 'success', total: posts.length, posts });
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// WhatsApp মেসেজ পাঠানোর API
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) {
        return res.status(400).json({ error: 'Number and message are required' });
    }

    try {
        const jid = number.includes('@s.whatsapp.net') || number.includes('@g.us') || number.includes('@newsletter')
            ? number
            : `${number}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: message });
        res.json({ status: 'success', message: 'Message sent successfully' });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});