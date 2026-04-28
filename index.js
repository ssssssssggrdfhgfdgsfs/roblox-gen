require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!CAPSOLVER_API_KEY || !WEBHOOK_URL) {
    console.error('Missing CAPSOLVER_API_KEY or WEBHOOK_URL');
    process.exit(1);
}

function randomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function generateUsername() {
    const prefixes = ['Cool', 'Pro', 'Mega', 'Super', 'Ultra', 'Fast', 'Epic', 'King', 'Shadow', 'Blaze'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] + randomString(4);
}

function generatePassword() {
    return randomString(12) + 'A1!';
}

async function solveCaptcha(page) {
    // Extract FunCaptcha parameters
    const captchaData = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="funcaptcha"]');
        if (!iframe) throw new Error('No FunCaptcha iframe');
        const src = iframe.src;
        const pkey = src.match(/pkey=([^&]+)/)?.[1] || '476068BF-9607-4799-B53D-966BE98E2B81';
        const blob = src.match(/blob=([^&]+)/)?.[1] || '';
        return { publicKey: pkey, blob: decodeURIComponent(blob) };
    });

    // Create task on Capsolver
    const task = {
        clientKey: CAPSOLVER_API_KEY,
        task: {
            type: 'FunCaptchaTaskProxyless',
            websiteURL: 'https://www.roblox.com/',
            websitePublicKey: captchaData.publicKey,
            data: JSON.stringify({ blob: captchaData.blob })
        }
    };
    const createRes = await axios.post('https://api.capsolver.com/createTask', task);
    const taskId = createRes.data.taskId;

    // Poll for result
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const getRes = await axios.post('https://api.capsolver.com/getTaskResult', {
            clientKey: CAPSOLVER_API_KEY,
            taskId
        });
        if (getRes.data.status === 'ready') return getRes.data.solution.token;
    }
    throw new Error('CAPTCHA timeout');
}

async function createAccount() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    const username = generateUsername();
    const password = generatePassword();

    try {
        console.log(`[+] Trying: ${username}`);
        await page.goto('https://www.roblox.com/account/signupredir', { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for signup form
        await page.waitForSelector('#signup-username', { timeout: 10000 });
        await page.type('#signup-username', username);
        await page.type('#signup-password', password);

        // Birthday
        await page.select('#MonthDropdown', 'Jan');
        await page.select('#DayDropdown', '15');
        await page.select('#YearDropdown', '2000');

        // Click signup
        await page.click('#signup-button');

        // Wait for CAPTCHA
        await page.waitForSelector('iframe[src*="funcaptcha"]', { timeout: 15000 });
        const token = await solveCaptcha(page);
        console.log(`[+] CAPTCHA solved`);

        // Submit token
        await page.evaluate((t) => {
            const input = document.querySelector('input[name="captcha-solution"]');
            if (input) input.value = t;
            document.querySelector('form')?.submit();
        }, token);

        // Wait for redirect to home
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

        // Get cookie
        const cookies = await page.cookies();
        const robloxCookie = cookies.find(c => c.name === '.ROBLOSECURITY')?.value;
        if (!robloxCookie) throw new Error('No cookie');

        console.log(`[SUCCESS] ${username}:${password}`);
        return { username, password, cookie: robloxCookie };
    } catch (err) {
        console.error(`[FAIL] ${username}:`, err.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function sendToDiscord(account) {
    const embed = {
        title: '✅ New Roblox Account',
        color: 0x00ff00,
        fields: [
            { name: 'Username', value: account.username, inline: true },
            { name: 'Password', value: `||${account.password}||`, inline: true },
            { name: 'Cookie', value: `||${account.cookie}||`, inline: false }
        ]
    };
    try {
        await axios.post(WEBHOOK_URL, { embeds: [embed] });
        console.log('[+] Webhook sent');
    } catch (err) {
        console.error('Webhook error:', err.message);
    }
}

async function main() {
    console.log('Roblox Account Generator Started');
    while (true) {
        const account = await createAccount();
        if (account) await sendToDiscord(account);
        // No delay – maximum speed
    }
}

main();
