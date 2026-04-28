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
    // Find the CAPTCHA iframe
    const iframeElement = await page.waitForSelector('iframe[src*="funcaptcha"]', { timeout: 15000 });
    const frame = await iframeElement.contentFrame();
    
    // Get public key from iframe URL
    const src = await frame.evaluate(() => window.location.href);
    const publicKeyMatch = src.match(/pkey=([^&]+)/);
    const publicKey = publicKeyMatch ? publicKeyMatch[1] : '476068BF-9607-4799-B53D-966BE98E2B81';
    
    // Create Capsolver task
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
    
    // Poll for result
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const getRes = await axios.post('https://api.capsolver.com/getTaskResult', {
            clientKey: CAPSOLVER_API_KEY,
            taskId
        });
        if (getRes.data.status === 'ready') {
            return getRes.data.solution.token;
        }
    }
    throw new Error('CAPTCHA solving timeout');
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
        
        // Fill username
        await page.waitForSelector('#signup-username', { timeout: 10000 });
        await page.type('#signup-username', username);
        
        // Fill password
        await page.type('#signup-password', password);
        
        // Set birthday
        await page.select('#MonthDropdown', 'Jan');
        await page.select('#DayDropdown', '15');
        await page.select('#YearDropdown', '2000');
        
        // Click signup button
        await page.click('#signup-button');
        console.log(`[+] Signup submitted, checking for CAPTCHA...`);
        
        // Wait 3 seconds for CAPTCHA to potentially load
        await new Promise(r => setTimeout(r, 3000));
        
        // Check if CAPTCHA iframe exists
        let captchaPresent = false;
        try {
            const iframe = await page.$('iframe[src*="funcaptcha"]');
            if (iframe) captchaPresent = true;
        } catch (e) {}
        
        if (captchaPresent) {
            console.log(`[+] CAPTCHA detected, solving...`);
            const token = await solveCaptcha(page);
            // Submit the token
            await page.evaluate((t) => {
                const input = document.querySelector('input[name="captcha-solution"]');
                if (input) input.value = t;
                const form = document.querySelector('form');
                if (form) form.submit();
            }, token);
        } else {
            console.log(`[+] No CAPTCHA detected, submitting directly...`);
            // Click the submit button again if needed
            await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
            });
        }
        
        // Wait for navigation to home page (account created)
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
        
        // Get cookies
        const cookies = await page.cookies();
        const robloxCookie = cookies.find(c => c.name === '.ROBLOSECURITY')?.value;
        if (!robloxCookie) throw new Error('No .ROBLOSECURITY cookie');
        
        console.log(`[SUCCESS] ${username} | ${password}`);
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
        color: 0x57F287,
        fields: [
            { name: 'Username', value: account.username, inline: true },
            { name: 'Password', value: `||${account.password}||`, inline: true },
            { name: 'Cookie (.ROBLOSECURITY)', value: `||${account.cookie}||`, inline: false }
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
    console.log('🚀 Roblox Account Generator Started (CAPTCHA optional)');
    let consecutiveFailures = 0;
    while (true) {
        const account = await createAccount();
        if (account) {
            await sendToDiscord(account);
            consecutiveFailures = 0;
            await new Promise(r => setTimeout(r, 1000)); // tiny delay
        } else {
            consecutiveFailures++;
            if (consecutiveFailures > 3) {
                console.log('Too many failures, waiting 30s...');
                await new Promise(r => setTimeout(r, 30000));
                consecutiveFailures = 0;
            }
        }
    }
}

main();
