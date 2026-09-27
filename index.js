const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let sock;
let currentRawQR = '';
let isConnected = false;

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
            currentRawQR = qr;
            isConnected = false;
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Connected successfully!');
            isConnected = true;
            currentRawQR = '';
        }
    });
}

// অটো-রিফ্রেশসহ QR কোড পেজ (মূল পেজ এবং /qr দুই রুটের জন্যই প্রযোজ্য)
const renderQRPage = async (req, res) => {
    if (isConnected) {
        return res.send(`
            <html>
                <head><title>WhatsApp Connected</title></head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;background-color:#f0f2f5;">
                    <div style="text-align:center;background:white;padding:40px;border-radius:10px;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                        <h1 style="color:#25D366;margin-bottom:10px;">✔ Successfully Connected!</h1>
                        <p style="color:#666;">Your WhatsApp Bot Server is Live and Ready.</p>
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
                        <title>Scan WhatsApp QR Code</title>
                        <meta http-equiv="refresh" content="5">
                    </head>
                    <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;background-color:#f0f2f5;">
                        <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                            <h2 style="color:#128C7E;margin-top:0;">Scan QR Code with WhatsApp</h2>
                            <img src="${qrImageUrl}" style="width:280px;height:280px;border:2px solid #25D366;padding:10px;border-radius:8px;" />
                            <p style="color:#888;font-size:13px;margin-top:15px;">Auto-refreshing every 5 seconds...</p>
                        </div>
                    </body>
                </html>
            `);
        } catch (err) {
            return res.status(500).send('Error generating QR image');
        }
    }

    // যদি QR কোড এখনও তৈরি না হয়ে থাকে
    return res.send(`
        <html>
            <head>
                <title>Generating QR Code...</title>
                <meta http-equiv="refresh" content="3">
            </head>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;">
                <h3 style="color:#555;">Generating QR Code, please wait 3 seconds...</h3>
            </body>
        </html>
    `);
};

// মূল লিঙ্ক এবং /qr লিঙ্ক দুটিতেই পেজটি দেখাবে
app.get('/', renderQRPage);
app.get('/qr', renderQRPage);

// ব্লগের পোস্ট ফ্যাচ করার রুট
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

// মেসেজ পাঠানোর API
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