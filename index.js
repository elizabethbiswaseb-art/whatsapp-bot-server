const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let sock;

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
            console.log('\n==============================================');
            console.log('নিচের QR কোডটি হোয়াটসঅ্যাপ দিয়ে স্ক্যান করুন:');
            qrcode.generate(qr, { small: true });
            console.log('==============================================\n');
        }

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot সফলভাবে অনলাইন হয়েছে!\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('কানেকশন বিচ্ছিন্ন হয়েছে। পুনঃসংযোগ করার চেষ্টা করা হচ্ছে...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });
}

// অটো-পোস্টিং এপিআই এন্ডপয়েন্ট
app.post('/send-post', async (req, res) => {
    try {
        const { channelId, title, postUrl, imageUrl } = req.body;

        if (!sock) {
            return res.status(500).json({ success: false, error: 'WhatsApp socket connected নয়!' });
        }

        const messageCaption = `📌 *${title}*\n\nপড়ুন পুরো পোস্টটি:\n${postUrl}`;

        if (imageUrl) {
            await sock.sendMessage(channelId, {
                image: { url: imageUrl },
                caption: messageCaption
            });
        } else {
            await sock.sendMessage(channelId, {
                text: messageCaption
            });
        }

        return res.json({ success: true, message: 'চ্যানেলে পোস্ট সফলভাবে পাঠানো হয়েছে!' });
    } catch (err) {
        console.error('পোস্ট পাঠাতে ব্যর্থ:', err);
        return res.status(500).json({ success: false, error: err.toString() });
    }
});

app.get('/', (req, res) => {
    res.send('WhatsApp Bot Server is Running Live!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});