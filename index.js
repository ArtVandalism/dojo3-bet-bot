const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const pLimit = require("p-limit");


// --- КОНФИГУРАЦИЯ ---
const THREADS = 1;
const MAX_GAMES = 5;
const BET_AMOUNT = 200; // Сумма ставки

let AVAILABLE_TOKENS = [];
try {
  const filePath = path.join(__dirname, 'top_tokens.json');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const parsedTokens = JSON.parse(fileContent);

  if (Array.isArray(parsedTokens)) {
    AVAILABLE_TOKENS = parsedTokens;
  } else {
    console.warn('Предупреждение: Файл top_tokens.json не содержит JSON-массив. Используется пустой список токенов.');
  }
} catch (error) {
  console.error(`Ошибка при чтении или парсинге top_tokens.json: ${error.message}`);
  console.error('Используется пустой список токенов.');
  AVAILABLE_TOKENS = [];
}


// --- КОНСТАНТЫ API ---
const BASE_URL = "https://api.dojo3.io/v1";
const BALANCE_URL = "https://quest.dojo3.io/v2/customer/me?businessType=ojo,asset";
const HEADERS = jwt => ({
    Accept: '*/*',
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Content-Type": "application/json",
    DNT: "1",
    Origin: "https://package.dojo3.io",
    Referer: "https://package.dojo3.io/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    jwt_token: jwt,
    saas_id: "dojo3-tg",
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function getNextMinuteTs(secOffset = 0) {
    const now = new Date();
    const next = new Date(now);
    next.setMilliseconds(0);
    if (now.getSeconds() >= secOffset) {
        next.setMinutes(now.getMinutes() + 1);
    }
    next.setSeconds(secOffset);
    return next.getTime();
}

function getRoundIdFromTimestamp(timestamp) {
    const d = new Date(timestamp);
    d.setSeconds(18, 0);
    const roundTimestamp = d.getTime();
    return `ojoCap_${roundTimestamp}`;
}

// --- УЛУЧШЕННАЯ ФУНКЦИЯ FETCH С ПОВТОРНЫМИ ПОПЫТКАМИ ---
async function safeFetch(url, options, retries = 3, retryDelay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                const errorBody = await res.text();
                console.error(chalk.red(`API Error: Status ${res.status}. URL: ${url}. Body: ${errorBody.slice(0, 300)}`));
                if (res.status === 401 || res.status === 403) {
                    console.error(chalk.bgRed.bold("CRITICAL: Received 401/403 Unauthorized. Your JWT token is likely invalid or expired."));
                }
                throw new Error(`Request failed with status ${res.status}`);
            }
            const textBody = await res.text();
            if (!textBody) throw new Error("Received empty response from server.");
            return JSON.parse(textBody);
        } catch (error) {
            if (error.name === 'SyntaxError') {
                console.error(chalk.red(`JSON Parse Error at ${url}. Response was not valid JSON.`));
            } else {
                console.error(chalk.yellow(`Fetch error for ${url}: ${error.message}. Retrying (${i + 1}/${retries})...`));
            }
            if (i < retries - 1) await delay(retryDelay);
            else throw error;
        }
    }
}

// --- ОБНОВЛЕННЫЕ ФУНКЦИИ API ---
async function getBalance(jwt) {
    try {
        const json = await safeFetch(BALANCE_URL, { headers: HEADERS(jwt) });
        return parseFloat(json.obj?.ojoValue || 0);
    } catch (error) {
        console.error(chalk.red(`❌ Could not fetch balance after all retries.`));
        return null;
    }
}

async function getConfig(jwt, roundId) {
    const url = `${BASE_URL}/games/battle/${roundId}/configs`;
    let json;
    try {
        json = await safeFetch(url, { headers: HEADERS(jwt) });
    } catch (error) {
        throw error;
    }
    return json?.data;
}

async function getBetId(jwt, roundId) {
    const url = `${BASE_URL}/games/battle/${roundId}/bets/id`;
    const json = await safeFetch(url, { headers: HEADERS(jwt), method: "POST", body: "{}" });
    return json?.data;
}

async function placeBet(jwt, roundId, betId, token, amount) {
    const url = `${BASE_URL}/games/battle/${roundId}/real/bets?betId=${betId}&token=${token}&amount=${amount}`;
    return await safeFetch(url, { headers: HEADERS(jwt), method: "POST", body: "{}" });
}

async function getAndLogBetResult(jwt, roundId, lastBalance) {
    console.log(chalk.gray(`⏱️ Checking result for round ${roundId}...`));
    const betResult = await safeFetch(`${BASE_URL}/games/battle/${roundId}/bets/get`, { headers: HEADERS(jwt), method: "GET" }).catch(() => null);

    if (betResult && betResult.success && betResult.data?.groupDatas?.real) {
        const winners = [];
        for (const tkn in betResult.data.groupDatas.real.bets) {
            if (betResult.data.groupDatas.real.bets[tkn].sort <= 3) {
                winners.push(`${tkn} (Place: ${betResult.data.groupDatas.real.bets[tkn].sort})`);
            }
        }
        if (winners.length > 0) {
            console.log(chalk.magenta(`🏆 Winners of round ${roundId}: ${winners.join(", ")}`));
        } else {
            console.log(chalk.yellow(`⚠️ Could not determine winners for round ${roundId}.`));
        }
    } else {
        console.log(chalk.yellow(`⚠️ Could not retrieve bet result for round ${roundId}.`));
    }

    const currentBalance = await getBalance(jwt);
    if (currentBalance !== null && lastBalance !== null) {
        const diff = currentBalance - lastBalance;
        console.log(
            chalk.blue(
                `📊 Balance after round ${roundId}: ${currentBalance.toFixed(2)} | Diff: ${diff >= 0 ? chalk.green(`+${diff.toFixed(2)}`) : chalk.red(`${diff.toFixed(2)}`)}`
            )
        );
    }
    return currentBalance;
}


// --- ОСНОВНАЯ ЛОГИКА БОТА ---
async function runTimedBets(jwt, maxGames = MAX_GAMES, amount = BET_AMOUNT) {
    let initialBalanceCheck = await getBalance(jwt);
    if (initialBalanceCheck === null) {
        console.error(chalk.bgRed.bold("Could not start bot due to initial balance fetch error. Check your token."));
        return;
    }

    if (initialBalanceCheck < amount) {
        console.log(chalk.yellow(`⏹️ Initial balance (${initialBalanceCheck.toFixed(2)}) is less than bet amount (${amount}). Skipping this account.`));
        return;
    }

    const initialBalance = initialBalanceCheck;
    let currentBalance = initialBalanceCheck;
    console.log(chalk.greenBright(`▶ Starting bot, initial balance: ${initialBalance.toFixed(2)} OJO. Target: ${maxGames} games.`));

    let gamesPlayed = 0;
    const pendingResults = [];

    const resultChecker = async () => {
        while (gamesPlayed < maxGames || pendingResults.length > 0) {
            const now = Date.now();
            if (pendingResults.length > 0 && now >= pendingResults[0].checkTime) {
                const { roundId, balanceBefore } = pendingResults.shift();
                const newBalance = (await getAndLogBetResult(jwt, roundId, balanceBefore));
                if (newBalance !== null) {
                    currentBalance = newBalance;
                }
            }
            await delay(3000);
        }
    };
    resultChecker();

    while (gamesPlayed < maxGames) {

        const balanceForCheck = await getBalance(jwt);
        if (balanceForCheck === null) {
            console.error(chalk.bgRed.bold("❌ Failed to fetch balance mid-session. Stopping this account."));
            return;
        }

        console.log(chalk.blue(`Current balance before bet: ${balanceForCheck.toFixed(2)} OJO.`));

        if (balanceForCheck < amount) {
            console.log(chalk.yellow(`⏹️ Balance (${balanceForCheck.toFixed(2)}) is below bet amount (${amount}). Stopping work for this account.`));
            break;
        }

        const roundStartTime = getNextMinuteTs(18);
        const waitToStart = roundStartTime - Date.now();

        if (waitToStart > 0) {
            console.log(chalk.gray(`⏳ Waiting for next round... (${Math.ceil(waitToStart / 1000)}s)`));
            await delay(waitToStart);
        }
        await delay((Math.floor(Math.random() * 25) + 2) * 1000);
        console.log(chalk.yellow(`\n--- Game ${gamesPlayed + 1}/${maxGames} ---`));

        const roundId = getRoundIdFromTimestamp(Date.now());
        let config;
        try {
            console.log(chalk.blue(`Fetching config for round ${roundId}...`));
            config = await getConfig(jwt, roundId);
            if (!config || !config.tokens || config.tokens.length === 0) {
                throw new Error("Config is invalid or has no tokens.");
            }
        } catch (error) {
            console.log(chalk.red(`⚠️ Failed to load valid config. Skipping.`));
            await delay(2000);
            continue;
        }

        const availableTokens = config.tokens;
        let token;

		if (Math.random() < 0.5) {
			const matched = AVAILABLE_TOKENS.find(t => availableTokens.includes(t));
			token = matched || availableTokens[Math.floor(Math.random() * availableTokens.length)];
		} else {
			token = availableTokens[Math.floor(Math.random() * availableTokens.length)];
		}

		console.log(chalk.cyan(`🎯 Selected token: ${token} from [${availableTokens.join(", ")}]`));

        try {
            const balanceBeforeBet = balanceForCheck;
            const betId = await getBetId(jwt, roundId);
            const result = await placeBet(jwt, roundId, betId, token, amount);

            if (result.success) {
                console.log(chalk.green(`✅ Bet on ${token} placed successfully!`));
                gamesPlayed++;
                pendingResults.push({
                    roundId: roundId,
                    checkTime: getNextMinuteTs(9),
                    balanceBefore: balanceBeforeBet
                });
            } else {
                console.log(chalk.red(`❌ Bet failed: ${result.msgKey || 'Unknown error'}`));
            }
        } catch (error) {
            console.log(chalk.red(`❌ Fatal error during betting. Skipping round.`));
        }
    }

    while (pendingResults.length > 0) {
        await delay(5000);
        console.log(chalk.gray(`Waiting for the last ${pendingResults.length} result(s) to be processed...`));
    }

    const finalBalance = await getBalance(jwt) ?? currentBalance;

    console.log(chalk.green(`\n🏁 All games session for this account completed.`));
    console.log(chalk.bold(`📈 Final Result: ${finalBalance > initialBalance ? chalk.green(`+${(finalBalance - initialBalance).toFixed(2)}`) : chalk.red(`${(finalBalance - initialBalance).toFixed(2)}`)} OJO`));
    console.log(chalk.bold(`   (Start: ${initialBalance.toFixed(2)}, End: ${finalBalance.toFixed(2)})`));
}

// --- ТОЧКА ВХОДА ---
async function main() {
    const lines = fs.readFileSync("./tokens.txt", "utf-8").split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
        console.log(chalk.red("❌ tokens.txt is empty. Please add your JWT tokens."));
        return;
    }
    if (AVAILABLE_TOKENS.length === 0) {
        console.log(chalk.red("❌ AVAILABLE_TOKENS list is empty. Please check top_tokens.json."));
        return;
    }
    console.log(chalk.yellow(`🔍 Found ${lines.length} token(s). Launching in ${THREADS} thread(s).`));
    const limit = pLimit(THREADS);
    await Promise.all(lines.map((jwt, index) => limit(async () => {
        console.log(chalk.bgBlue(`\n--- Starting bot for token #${index + 1} ---`));
        await runTimedBets(jwt);
        console.log(chalk.bgBlue(`--- Finished bot for token #${index + 1} ---\n`));
    })));
    console.log(chalk.bgGreen.bold("\n✅ All bots have finished their sessions."));
}

main().catch((err) => console.error(chalk.red(err)));