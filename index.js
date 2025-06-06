const fs = require("fs")
const chalk = require("chalk")
const pLimit = require("p-limit")

const BASE_URL = "https://api.dojo3.io/v1"
const BALANCE_URL =
	"https://quest.dojo3.io/v2/customer/me?businessType=ojo,asset"

const THREADS = 4 // Количество потоков / Number of concurrent threads
const MAX_GAMES = 5 // Игр на аккаунт / Games per account
const BET_AMOUNT = 200 // Сумма ставки / Bet amount per game

const HEADERS = jwt => ({
	Accept: "*/*",
	"Accept-Language": "en",
	Connection: "keep-alive",
	DNT: "1",
	Origin: "https://package.dojo3.io",
	Referer: "https://package.dojo3.io/",
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36",
	jwt_token: jwt,
	saas_id: "dojo3-tg",
})

const delay = ms => new Promise(res => setTimeout(res, ms))

function getNextMinuteTs(secOffset = 0) {
	const now = new Date()
	now.setSeconds(0, 0)
	const next = new Date(now.getTime() + 60_000)
	next.setSeconds(secOffset)
	return next.getTime()
}

function getRoundIdFromTimestamp(timestamp) {
	const rounded = Math.floor(timestamp / 1000 / 60) * 60 * 1000 + 18000
	return `ojoCap_${rounded}`
}

async function getBalance(jwt) {
	const res = await fetch(BALANCE_URL, { headers: HEADERS(jwt) })
	const json = await res.json()
	const ojo = json.obj?.ojoValue || 0
	console.log(chalk.blueBright(`💰 Current balance: ${ojo}`))
	return parseFloat(ojo)
}

async function getConfig(jwt, roundId) {
	const url = `${BASE_URL}/games/battle/${roundId}/configs`
	const res = await fetch(url, { headers: HEADERS(jwt) })
	const json = await res.json()
	return json.data
}

async function getBetId(jwt, roundId) {
	const url = `${BASE_URL}/games/battle/${roundId}/bets/id`
	const res = await fetch(url, {
		headers: HEADERS(jwt),
		method: "POST",
		body: "{}",
	})
	const json = await res.json()
	return json.data
}

async function placeBet(jwt, roundId, betId, token, amount) {
	const url = `${BASE_URL}/games/battle/${roundId}/real/bets?betId=${betId}&token=${token}&amount=${amount}`
	const res = await fetch(url, {
		headers: HEADERS(jwt),
		method: "POST",
		body: "{}",
	})
	const json = await res.json()
	return json
}

async function runTimedBets(jwt, maxGames = MAX_GAMES, amount = BET_AMOUNT) {
	console.log(chalk.greenBright(`▶ Starting bot with ${maxGames} bets`))
	let gamesPlayed = 0

	const initialBalance = await getBalance(jwt)

	while (gamesPlayed < maxGames) {
		const ts18 = getNextMinuteTs(18)
		const ts20 = getNextMinuteTs(20)
		const roundId = getRoundIdFromTimestamp(ts18)

		const wait18 = ts18 - Date.now()
		if (wait18 > 0) {
			console.log(chalk.gray(`⏳ Waiting for 18th second... ${wait18}ms`))
			await delay(wait18)
		}

		let config = null
		try {
			config = await getConfig(jwt, roundId)
		} catch {
			console.log(chalk.red(`⚠️ Failed to load config`))
			await delay(10000)
			continue
		}

		const tokens = config.tokens
		if (!tokens || tokens.length === 0) {
			console.log(chalk.red(`❌ No available tokens for betting`))
			continue
		}

		console.log(chalk.yellow(`🪙 Available tokens: ${tokens.join(", ")}`))
		const token = tokens[Math.floor(Math.random() * tokens.length)]
		console.log(chalk.cyan(`🎯 Selected token: ${token}`))

		const waitTo20 = ts20 - Date.now()
		if (waitTo20 > 0) {
			console.log(
				chalk.gray(`⏱ Waiting for 20th second (${waitTo20}ms) to bet...`)
			)
			await delay(waitTo20)
		}

		const before = await getBalance(jwt)

		const betId = await getBetId(jwt, roundId)
		const result = await placeBet(jwt, roundId, betId, token, amount)

		if (result.success) {
			console.log(chalk.green(`✅ Bet on ${token} placed successfully`))
			gamesPlayed++
		} else {
			console.log(chalk.red(`❌ Bet failed: ${result.msgKey}`))
		}

		const after = await getBalance(jwt)
		const diff = after - before
		console.log(
			chalk.blue(
				`📊 Balance before: ${before}, after: ${after} → ${
					diff > 0 ? chalk.green(`+${diff}`) : chalk.red(`${diff}`)
				}`
			)
		)

		const nextRoundTs = getNextMinuteTs(18)
		const now = Date.now()
		const waitNext = nextRoundTs - now
		console.log(
			chalk.gray(`⏳ Waiting for next round: ${Math.ceil(waitNext / 1000)} sec`)
		)
		await delay(waitNext)
	}

	const finalBalance = await getBalance(jwt)
	const net = finalBalance - initialBalance
	console.log(chalk.green(`\n🏁 All ${maxGames} bets completed.`))
	console.log(
		chalk.bold(
			`📈 Result: ${
				net > 0 ? chalk.green(`+${net}`) : chalk.red(`${net}`)
			} OJO (start: ${initialBalance}, end: ${finalBalance})`
		)
	)
}

async function main() {
	const lines = fs
		.readFileSync("./tokens.txt", "utf-8")
		.split("\n")
		.map(l => l.trim())
		.filter(Boolean)

	console.log(
		chalk.yellow(
			`🔍 Found ${lines.length} token(s). Launching in ${THREADS} thread(s).`
		)
	)

	const limit = pLimit(THREADS)
	await Promise.all(lines.map(jwt => limit(() => runTimedBets(jwt))))
}

main().catch(err => console.error(chalk.red(err)))
