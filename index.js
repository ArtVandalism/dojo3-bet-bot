const fs = require("fs")
const path = require("path")
const chalk = require("chalk")
const pLimit = require("p-limit")

// --- КОНФИГУРАЦИЯ ---
const THREADS = 1;
const MAX_GAMES = 5;
const BET_AMOUNT = 200 // Сумма ставки

let AVAILABLE_TOKENS = []
try {
	const filePath = path.join(__dirname, "top_tokens.json")
	const fileContent = fs.readFileSync(filePath, "utf8")
	const parsedTokens = JSON.parse(fileContent)

	if (Array.isArray(parsedTokens)) {
		AVAILABLE_TOKENS = parsedTokens
	} else {
		console.warn(
			"Предупреждение: Файл top_tokens.json не содержит JSON-массив. Используется пустой список токенов."
		)
	}
} catch (error) {
	console.error(
		`Ошибка при чтении или парсинге top_tokens.json: ${error.message}`
	)
	console.error("Используется пустой список токенов.")
	AVAILABLE_TOKENS = []
}

// --- КОНСТАНТЫ API ---
const BASE_URL = "https://api.dojo3.io/v1"
const BALANCE_URL =
	"https://quest.dojo3.io/v2/customer/me?businessType=ojo,asset"
const HEADERS = jwt => ({
	Accept: "*/*",
	"Accept-Language": "en-US,en;q=0.9",
	Connection: "keep-alive",
	"Content-Type": "application/json",
	DNT: "1",
	Origin: "https://package.dojo3.io",
	Referer: "https://package.dojo3.io/",
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
	jwt_token: jwt,
	saas_id: "dojo3-tg",
})

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
const delay = ms => new Promise(res => setTimeout(res, ms))

function getNextMinuteTs(secOffset = 0) {
	const now = new Date()
	const next = new Date(now)
	next.setMilliseconds(0)
	if (now.getSeconds() >= secOffset) {
		next.setMinutes(now.getMinutes() + 1)
	}
	next.setSeconds(secOffset)
	return next.getTime()
}

function getRoundIdFromTimestamp(timestamp) {
	const d = new Date(timestamp)
	d.setSeconds(18, 0)
	const roundTimestamp = d.getTime()
	return `ojoCap_${roundTimestamp}`
}

// --- УЛУЧШЕННАЯ ФУНКЦИЯ FETCH С ПОВТОРНЫМИ ПОПЫТКАМИ ---
async function safeFetch(url, options, retries = 3, retryDelay = 2000) {
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url, options)
			if (!res.ok) {
				const errorBody = await res.text()
				// Скрываем вывод ошибки в консоль для чистоты, можно раскомментировать для отладки
				// console.error(chalk.red(`API Error: Status ${res.status}. URL: ${url}. Body: ${errorBody.slice(0, 300)}`));
				if (res.status === 401 || res.status === 403) {
					console.error(
						chalk.bgRed.bold(
							"CRITICAL: Received 401/403 Unauthorized. Your JWT token is likely invalid or expired."
						)
					)
				}
				throw new Error(`Request failed with status ${res.status}`)
			}
			const textBody = await res.text()
			if (!textBody) throw new Error("Received empty response from server.")
			return JSON.parse(textBody)
		} catch (error) {
			if (error.name === "SyntaxError") {
				console.error(
					chalk.red(`JSON Parse Error at ${url}. Response was not valid JSON.`)
				)
			} else {
				console.error(
					chalk.yellow(
						`Fetch error for ${url}: ${error.message}. Retrying (${
							i + 1
						}/${retries})...`
					)
				)
			}
			if (i < retries - 1) await delay(retryDelay)
			else throw error
		}
	}
}

// --- ОБНОВЛЕННЫЕ ФУНКЦИИ API ---
async function getBalance(jwt) {
	try {
		const json = await safeFetch(BALANCE_URL, { headers: HEADERS(jwt) })
		return parseFloat(json.obj?.ojoValue || 0)
	} catch (error) {
		console.error(chalk.red(`❌ Could not fetch balance after all retries.`))
		return null
	}
}

async function getConfig(jwt, roundId) {
	const url = `${BASE_URL}/games/battle/${roundId}/configs`
	return (await safeFetch(url, { headers: HEADERS(jwt) }))?.data
}

async function getBetId(jwt, roundId) {
	const url = `${BASE_URL}/games/battle/${roundId}/bets/id`
	return (
		await safeFetch(url, { headers: HEADERS(jwt), method: "POST", body: "{}" })
	)?.data
}

async function placeBet(jwt, roundId, betId, token, amount) {
	const url = `${BASE_URL}/games/battle/${roundId}/real/bets?betId=${betId}&token=${token}&amount=${amount}`
	return await safeFetch(url, {
		headers: HEADERS(jwt),
		method: "POST",
		body: "{}",
	})
}

async function getAndLogBetResult(jwt, roundId, balanceBeforeBet) {
	console.log(chalk.gray(`⏱️  Checking result for round ${roundId}...`))
	const betResult = await safeFetch(
		`${BASE_URL}/games/battle/${roundId}/bets/get`,
		{ headers: HEADERS(jwt) }
	).catch(() => null)

	if (betResult?.success && betResult.data?.groupDatas?.real) {
		const winners = Object.entries(betResult.data.groupDatas.real.bets)
			.filter(([, data]) => data.sort <= 3)
			.map(([tkn, data]) => `${tkn} (Place: ${data.sort})`)

		if (winners.length > 0) {
			console.log(
				chalk.magenta(`🏆 Winners of round ${roundId}: ${winners.join(", ")}`)
			)
		}
	}

	const currentBalance = await getBalance(jwt)
	if (currentBalance !== null && balanceBeforeBet !== null) {
		const diff = currentBalance - balanceBeforeBet
		console.log(
			chalk.blue(
				`📊 Balance after round: ${currentBalance.toFixed(2)} | Diff: ${
					diff >= 0
						? chalk.green(`+${diff.toFixed(2)}`)
						: chalk.red(`${diff.toFixed(2)}`)
				}`
			)
		)
	}
	return currentBalance
}

// --- ОСНОВНАЯ ЛОГИКА БОТА (ПЕРЕРАБОТАНА И ИСПРАВЛЕНА) ---
async function runTimedBets(jwt, maxGames = MAX_GAMES, amount = BET_AMOUNT) {
	let currentBalance = await getBalance(jwt)
	if (currentBalance === null) {
		console.error(
			chalk.bgRed.bold(
				"Could not start bot due to initial balance fetch error. Check your token."
			)
		)
		return
	}

	const initialBalance = currentBalance

	// Первичная проверка баланса
	if (initialBalance < amount) {
		console.log(
			chalk.yellow(
				`⏹️ Initial balance (${initialBalance.toFixed(
					2
				)}) is less than bet amount (${amount}). Skipping account.`
			)
		)
		return
	}

	console.log(
		chalk.greenBright(
			`▶ Starting bot, initial balance: ${initialBalance.toFixed(
				2
			)} OJO. Target: ${maxGames} games.`
		)
	)

	let gamesPlayed = 0
	let lastRoundData = null // Для хранения данных о последней ставке { roundId, balanceBeforeBet }

	while (gamesPlayed < maxGames) {
		// ШАГ 1: Если это не первая игра, ждем и проверяем результат ПРЕДЫДУЩЕГО раунда
		if (lastRoundData) {
			const resultCheckTime = getNextMinuteTs(9) // Результаты доступны после 9-й секунды
			const waitTime = resultCheckTime - Date.now()
			if (waitTime > 0) {
				console.log(
					chalk.gray(
						`⏳ Waiting ${Math.ceil(
							waitTime / 1000
						)}s for previous round result...`
					)
				)
				await delay(waitTime + 1000) // +1 сек для надежности
			}

			const newBalance = await getAndLogBetResult(
				jwt,
				lastRoundData.roundId,
				lastRoundData.balanceBeforeBet
			)

			// Обновляем наш текущий баланс
			currentBalance = newBalance ?? currentBalance
			lastRoundData = null // Сбрасываем данные, т.к. результат обработан
		}

		// ШАГ 2: ПРОВЕРКА БАЛАНСА. Происходит ПОСЛЕ получения результатов предыдущего раунда.
		if (currentBalance < amount) {
			console.log(
				chalk.yellow(
					`⏹️ Balance (${currentBalance.toFixed(
						2
					)}) is now below bet amount (${amount}). Stopping work for this account.`
				)
			)
			break // Выходим из цикла, если денег не хватает
		}

		// ШАГ 3: Готовимся и делаем ставку на НОВЫЙ раунд
		const roundStartTime = getNextMinuteTs(18)
		const waitToStart = roundStartTime - Date.now()

		if (waitToStart > 0) {
			console.log(
				chalk.gray(
					`⏳ Waiting for next betting round... (${Math.ceil(
						waitToStart / 1000
					)}s)`
				)
			)
			await delay(waitToStart)
		}
		await delay((Math.floor(Math.random() * 25) + 2) * 1000) // Случайная задержка

		console.log(
			chalk.yellow(
				`\n--- Game ${
					gamesPlayed + 1
				}/${maxGames} | Balance: ${currentBalance.toFixed(2)} OJO ---`
			)
		)

		const roundId = getRoundIdFromTimestamp(Date.now())
		const config = await getConfig(jwt, roundId).catch(() => null)
		if (!config?.tokens?.length) {
			console.log(
				chalk.red(
					`⚠️ Failed to load valid config for round ${roundId}. Skipping.`
				)
			)
			await delay(5000)
			continue
		}

		const { tokens: availableTokensInRound } = config
		const matched = AVAILABLE_TOKENS.find(t =>
			availableTokensInRound.includes(t)
		)
		const token =
			Math.random() < 0.5 && matched
				? matched
				: availableTokensInRound[
						Math.floor(Math.random() * availableTokensInRound.length)
				  ]

		console.log(
			chalk.cyan(
				`🎯 Selected token: ${token} from [${availableTokensInRound.join(
					", "
				)}]`
			)
		)

		try {
			const balanceBeforeBet = currentBalance // Запоминаем баланс перед ставкой
			const betId = await getBetId(jwt, roundId)
			const result = await placeBet(jwt, roundId, betId, token, amount)

			if (result.success) {
				console.log(
					chalk.green(
						`✅ Bet on ${token} for ${amount} OJO placed successfully!`
					)
				)
				gamesPlayed++
				// Сохраняем данные этого раунда, чтобы на следующей итерации проверить его результат
				lastRoundData = { roundId, balanceBeforeBet }
			} else {
				console.log(
					chalk.red(`❌ Bet failed: ${result.msgKey || "Unknown error"}`)
				)
				await delay(5000)
			}
		} catch (error) {
			console.log(chalk.red(`❌ Fatal error during betting. Skipping round.`))
			await delay(5000)
		}
	}

	// --- ПОСЛЕ ЦИКЛА: Проверяем результат ПОСЛЕДНЕЙ игры, если она была ---
	if (lastRoundData) {
		const resultCheckTime = getNextMinuteTs(9)
		const waitTime = resultCheckTime - Date.now()
		if (waitTime > 0) {
			console.log(
				chalk.gray(
					`⏳ Waiting ${Math.ceil(
						waitTime / 1000
					)}s for the final round result...`
				)
			)
			await delay(waitTime + 1000)
		}
		currentBalance =
			(await getAndLogBetResult(
				jwt,
				lastRoundData.roundId,
				lastRoundData.balanceBeforeBet
			)) ?? currentBalance
	}

	const finalBalance = (await getBalance(jwt)) ?? currentBalance

	console.log(chalk.green(`\n🏁 Session for this account completed.`))
	console.log(
		chalk.bold(
			`📈 Final Result: ${
				finalBalance > initialBalance
					? chalk.green(`+${(finalBalance - initialBalance).toFixed(2)}`)
					: chalk.red(`${(finalBalance - initialBalance).toFixed(2)}`)
			} OJO`
		)
	)
	console.log(
		chalk.bold(
			`   (Start: ${initialBalance.toFixed(2)}, End: ${finalBalance.toFixed(
				2
			)})`
		)
	)
}

// --- ТОЧКА ВХОДА ---
async function main() {
	// Убедитесь, что имя файла с токенами верное
	const tokenFile = "./tokens.txt"
	const lines = fs
		.readFileSync(tokenFile, "utf-8")
		.split("\n")
		.map(l => l.trim())
		.filter(Boolean)
	if (lines.length === 0) {
		console.log(
			chalk.red(`❌ ${tokenFile} is empty. Please add your JWT tokens.`)
		)
		return
	}
	if (AVAILABLE_TOKENS.length === 0) {
		console.log(
			chalk.red(
				"❌ AVAILABLE_TOKENS list is empty. Please check top_tokens.json."
			)
		)
		return
	}
	console.log(
		chalk.yellow(
			`🔍 Found ${lines.length} token(s). Launching in ${THREADS} thread(s).`
		)
	)
	const limit = pLimit(THREADS)
	await Promise.all(
		lines.map((jwt, index) =>
			limit(async () => {
				console.log(
					chalk.bgBlue(`\n--- Starting bot for token #${index + 1} ---`)
				)
				await runTimedBets(jwt)
				console.log(
					chalk.bgBlue(`--- Finished bot for token #${index + 1} ---\n`)
				)
			})
		)
	)
	console.log(chalk.bgGreen.bold("\n✅ All bots have finished their sessions."))
}

main().catch(err => console.error(chalk.red(err)))
