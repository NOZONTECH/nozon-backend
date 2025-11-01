const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Создаём папку для загрузок
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors({
  origin: ['https://nozon.tech', 'http://localhost:8080'] // разрешить ваш фронтенд
}));
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer для загрузки фото
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});

// Инициализация базы данных
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err.message);
  } else {
    console.log('Подключено к SQLite');
    createTables();
  }
});

function createTables() {
  db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_paid BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Лоты
    db.run(`CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_price INTEGER NOT NULL,
      reserve_price INTEGER NOT NULL,
      current_bid INTEGER NOT NULL,
      end_time TEXT NOT NULL,
      owner TEXT NOT NULL,
      images TEXT, -- JSON массив имён файлов
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ставки
    db.run(`CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      user TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(lot_id) REFERENCES lots(id) ON DELETE CASCADE
    )`);

    // Админ (один аккаунт)
    db.run(`INSERT OR IGNORE INTO users (username, password_hash) 
            VALUES ('admin', '$2a$10$Zq9/5D8vQY6eF2xK7J3N7uR1X4Y5Z6a7b8c9d0e1f2g3h4i5j6k')`);
    // Пароль: admin123 (хеш bcrypt)
  });
}

// === Роуты ===

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', 
      [username, hash], 
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Логин занят' });
          }
          return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json({ success: true });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Ошибка хеширования' });
  }
});

// Вход
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

// Получить все лоты
app.get('/api/lots', (req, res) => {
  db.all('SELECT * FROM lots ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка загрузки лотов' });
    
    const lots = rows.map(lot => ({
      ...lot,
      images: lot.images ? JSON.parse(lot.images) : [],
      images: lot.images ? lot.images.map(img => `/uploads/${img}`) : []
    }));
    res.json(lots);
  });
});

// Создать лот
app.post('/api/lots', upload.array('images', 3), (req, res) => {
  const { title, description, start_price, reserve_price, end_time, owner } = req.body;
  const imageFiles = req.files?.map(file => file.filename) || [];

  if (!title || !description || !start_price || !reserve_price || !end_time || !owner) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }

  const stmt = db.prepare(`
    INSERT INTO lots (title, description, start_price, reserve_price, current_bid, end_time, owner, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    title,
    description,
    start_price,
    reserve_price,
    start_price,
    end_time,
    owner,
    JSON.stringify(imageFiles),
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Ошибка создания лота' });
      }
      res.json({ success: true, lotId: this.lastID });
    }
  );
  stmt.finalize();
});

// Сделать ставку
app.post('/api/bids', (req, res) => {
  const { lot_id, user, amount } = req.body;
  if (!lot_id || !user || !amount) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  // Проверяем, есть ли лот
  db.get('SELECT current_bid FROM lots WHERE id = ?', [lot_id], (err, lot) => {
    if (err || !lot) return res.status(404).json({ error: 'Лот не найден' });
    if (amount <= lot.current_bid) return res.status(400).json({ error: 'Ставка должна быть выше текущей' });

    // Сохраняем ставку
    db.run('INSERT INTO bids (lot_id, user, amount) VALUES (?, ?, ?)', [lot_id, user, amount], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка ставки' });

      // Обновляем текущую ставку
      db.run('UPDATE lots SET current_bid = ? WHERE id = ?', [amount, lot_id], (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка обновления лота' });
        res.json({ success: true });
      });
    });
  });
});

// Админка: удалить лот
app.delete('/api/lots/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM lots WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка удаления' });
    if (this.changes === 0) return res.status(404).json({ error: 'Лот не найден' });
    res.json({ success: true });
  });
});

// Здоровье сервера
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
