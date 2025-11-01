// backend/server.js
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Моковые данные (в реальности — из БД)
let lots = [
  {
    id: '1',
    title: 'Винтажная печатная машинка',
    price: 12500,
    endTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['/uploads/lot1_1.jpg'],
    description: 'Рабочая, 1947 года.'
  },
  {
    id: '2',
    title: 'Старинные часы',
    price: 8900,
    endTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['/uploads/lot2_1.jpg'],
    description: 'Латунные карманные часы.'
  }
];

// Роут: получить все активные лоты
app.get('/api/lots', (req, res) => {
  const now = new Date();
  const activeLots = lots.filter(lot => new Date(lot.endTime) > now);
  res.json(activeLots);
});

// Запуск
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
