const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Создаём папку uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 10000;

// === CORS для nozon.tech ===
app.use(cors({
  origin: ['https://nozon.tech'],
  methods: ['GET', 'POST', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// === База данных ===
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
  if (err) {
    console.error('Ошибка БД:', err.message);
  } else {
    console.log('Подключено к SQLite');
    createTables();
  }
});

function createTables() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )`);
  });
}

// === Регистрация ===
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3) {
    return res.status(400).json({ error: 'Логин от 3 символов' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Логин занят' });
        }
        return res.status(500).json({ error: 'Ошибка БД' });
      }
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка хеширования' });
  }
});

// === Вход ===
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT password_hash FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }
    const isValid = await bcrypt.compare(password, row.password_hash);
    if (isValid) {
      res.json({ success: true, username });
    } else {
      res.status(400).json({ error: 'Неверный логин или пароль' });
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
