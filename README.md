# 🎮 DOJO3 Multi-Account Betting Bot

Многопоточный бот для автоматических ставок в игре [Dojo3](https://www.dojo3.io/?inviteCode=DG23U4&sourceType=WEB).  
Работает с несколькими JWT-токенами параллельно и автоматически делает ставку раз в минуту.

A multi-threaded bot for automated betting in the game [Dojo3](https://www.dojo3.io/?inviteCode=DG23U4&sourceType=WEB).  
It runs multiple JWT tokens in parallel and places a bet once per minute.

---

## 📦 Установка / Installation 

1. Клонируйте репозиторий, установите [Nodejs](https://nodejs.org/en) и зависимости:  
   Clone the repository, install [Nodejs](https://nodejs.org/en) and  dependencies:

```bash
git clone https://github.com/ArtVandalism/dojo3-bet-bot.git
cd dojo3-bet-bot
npm install
```

2. Убедитесь, что установлены необходимые библиотеки:  
   Make sure the required packages are installed:

```bash
npm install chalk@4 p-limit@3
```

> ⚠ Если в `package.json` присутствует `"type": "module"`, либо удалите его, либо используйте `import` вместо `require`.

---

## 🧾 Настройка токенов / Token Setup

Создайте файл `tokens.txt` в корне проекта.  
Добавьте по одному JWT-токену в каждой строке:

Create a `tokens.txt` file in the project root.  
Add one JWT token per line:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6...
eyJhbGciOiJIUzI1NiIsInR5cCI6...
...
```
---
## 🔑 Где взять JWT токен / How to get your JWT token
🇷🇺 Инструкция (для браузера)

 - Перейдите на сайт [Dojo3](https://www.dojo3.io/?inviteCode=DG23U4&sourceType=WEB) и войдите через Abstract кошелек.

 - Откройте инструменты разработчика:
 - F12 → вкладка Application → слева в списке Cookie → выберите https://www.dojo3.io

 - Найдите ключ jwt — это и есть ваш токен.

 - Скопируйте его и вставьте в tokens.txt, одна строка — один токен.

🇺🇸 Instructions (browser method)

 - Go to [Dojo3](https://www.dojo3.io/?inviteCode=DG23U4&sourceType=WEB) and log in via Abstract wallet.

 - Open developer tools:
 - F12 → Application tab → left panel: Cookie → choose https://www.dojo3.io

 - Find the key jwt — that's your authentication token.

 - Copy it and paste it into tokens.txt, one token per line.
---

## ⚙️ Настройки / Configuration

Откройте файл `index.js` и измените параметры:  
Open `index.js` and update the following values:

```js
const THREADS = 4        // Количество потоков / Number of concurrent threads
const MAX_GAMES = 5      // Игр на аккаунт / Games per account
const BET_AMOUNT = 200   // Сумма ставки / Bet amount per game
```

---

## ▶️ Запуск / Run the Bot

```bash
node index.js
```

### Логи будут содержать / Output includes:

- Аккаунт и его токен / Token used for account  
- Баланс до и после ставки / Balance before and after the bet  
- Ошибки, если есть / Errors if any  
- Количество сыгранных игр / Number of completed games

---

## 💡 Поведение бота / Bot Behavior

- Проверяет баланс перед каждой ставкой  
  *Checks balance before each bet*
- Делает ставку на случайный токен из доступных (5 шт)  
  *Bets on a random token from the available 5*
- Повторяет цикл каждую минуту (в 18–20 секунде)  
  *Repeats the cycle every minute (around 18–20 seconds)*
- Завершает работу после заданного количества игр на аккаунт  
  *Stops after the defined number of games per account*

---

## 🧠 Используемые технологии / Tech Stack

- Node.js
- [`chalk@4`](https://www.npmjs.com/package/chalk) — цветной вывод / terminal colors
- [`p-limit@3`](https://www.npmjs.com/package/p-limit) — управление параллелизмом / concurrency control
- `fetch` — HTTP-запросы / HTTP requests

---

## 📄 Лицензия / License

MIT License — use at your own risk.  
MIT Лицензия — используйте на свой страх и риск.
