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
    const iframeElement = await page.waitForSelector('iframe[src*="funcaptcha"]', { timeout: 10000 });
    const frame = await iframeElement.contentFrame();
    const src = await frame.evaluate(() => window.location.href);
    const publicKeyMatch = src.match(/pkey=([^&]+)/);
    const publicKey = publicKeyMatch ? publicKeyMatch[1] : '476068BF-9607-4799-B53D-966BE98E2B81';
    
    const taskPayload = {
        clientKey: CAPSOLVER_API_KEY,
        task: {
            type: 'FunCaptchaTaskProxyless',
            websiteURL: 'https://www.roblox.com/',
            websitePublicKey: publicKey,
            data: JSON.stringify({ blob: '' })
        }
    };
    const createRes = await axios.post('https://api.capsolver.com/createTask', taskPayload);
    const taskId = createRes.data.taskId;
    
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const getRes = await axios.post('https://api.capsolver.com/getTaskResult', {
            clientKey: CAPSOLVER_API_KEY,
            taskId
        });
        if (getRes.data.status === 'ready') return getRes.data.solution.token;
    }
    throw new Error('CAPTCHA timeout');
}

// Single account creation using a shared page
async function createAccountOnPage(page, username, password, capsolverKey) {
    try {
        console.log(`[+] Starting: ${username}`);
        
        await page.goto('https://www.roblox.com/account/signupredir', { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        await page.waitForSelector('#signup-username', { timeout: 5000 });
        await page.type('#signup-username', username);
        await page.type('#signup-password', password);
        
        await page.select('#MonthDropdown', 'Jan');
        await page.select('#DayDropdown', '15');
        await page.select('#YearDropdown', '2000');
        
        await page.click('#signup-button');
        
        // Check for CAPTCHA very quickly (no extra sleep)
        let captchaPresent = false;
        try {
            const iframe = await page.$('iframe[src*="funcaptcha"]');
            if (iframe) captchaPresent = true;
        } catch (e) {}
        
        if (captchaPresent) {
            const token = await solveCaptcha(page);
            await page.evaluate((t) => {
                const input = document.querySelector('input[name="captcha-solution"]');
                if (input) input.value = t;
                const form = document.querySelector('form');
                if (form) form.submit();
            }, token);
        } else {
            await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
            });
        }
        
        // Wait for redirect
        await page.waitForFunction(() => window.location.href.includes('https://www.roblox.com/home'), { timeout: 30000 });
        
        const cookies = await page.cookies();
        const robloxCookie = cookies.find(c => c.name === '.ROBLOSECURITY')?.value;
        if (!robloxCookie) throw new Error('No cookie');
        
        console.log(`[SUCCESS] ${username}`);
        return { username, password, cookie: robloxCookie };
    } catch (err) {
        console.error(`[FAIL] ${username}:`, err.message);
        return null;
    }
}

// Worker that creates accounts continuously on a dedicated page
async function worker(browser, capsolverKey, workerId) {
    while (true) {
        const page = await browser.newPage();
        const username = generateUsername();
        const password = generatePassword();
        try {
            const account = await createAccountOnPage(page, username, password, capsolverKey);
            if (account) {
                await sendToDiscord(account);
            }
        } catch (err) {
            console.error(`Worker ${workerId} error:`, err.message);
        } finally {
            await page.close();
        }
        // Small delay to avoid hammering
        await new Promise(r => setTimeout(r, 500));
    }
}

async function sendToDiscord(account) {
    const embed = {
        title: '✅ New Roblox Account',
        color: 0x57F287,
        fields: [
            { name: 'Username', value: account.username, inline: true },
            { name: 'Password', value: `||${account.password}||`, inline: true },
            { name: 'Cookie', value: `||${account.cookie}||`, inline: false }
        ]
    };
    try {
        await axios.post(WEBHOOK_URL, { embeds: [embed] });
        console.log('[+] Webhook sent');
    } catch (err) {}
}

async function main() {
    console.log('🚀 ULTRA-FAST Roblox Generator (Concurrent)');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    // Run 3 concurrent workers
    const workers = [];
    for (let i = 1; i <= 3; i++) {
        workers.push(worker(browser, CAPSOLVER_API_KEY, i));
        console.log(`Started worker ${i}`);
    }
    await Promise.all(workers);
}

main();
