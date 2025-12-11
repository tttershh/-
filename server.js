const express = require('express');
const app = express();
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// static public & uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// multer setup for avatars and item images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });


// Register
app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const text = `INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, avatar, role`;
    const values = [username, email, hashed];
    const result = await db.query(text, values);
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') { 
      return res.status(400).json({ message: 'Email already used' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const text = `SELECT * FROM users WHERE email = $1`;
    const { rows } = await db.query(text, [email]);
    const user = rows[0];
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    delete user.password;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Get my profile
app.get('/auth/me', authMiddleware, async (req, res) => {
  const { rows } = await db.query('SELECT id, username, email, avatar, role FROM users WHERE id = $1', [req.userId]);
  res.json(rows[0] || null);
});

// Update me + avatar
app.put('/auth/me', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const { username } = req.body;
    let avatarPath;
    if (req.file) avatarPath = `/uploads/${req.file.filename}`;
    const text = `UPDATE users SET username = COALESCE($1, username), avatar = COALESCE($2, avatar) WHERE id = $3 RETURNING id, username, email, avatar, role`;
    const values = [username || null, avatarPath || null, req.userId];
    const { rows } = await db.query(text, values);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


// GET all items
app.get('/items', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM items ORDER BY created_at DESC', []);
  res.json(rows);
});

// GET item by id
app.get('/items/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

// POST create item (with optional image)
app.post('/items', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;
    const text = `INSERT INTO items (title, description, image) VALUES ($1, $2, $3) RETURNING *`;
    const values = [title, description, image];
    const { rows } = await db.query(text, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT update item (this is one of the tasks)
app.put('/items/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const id = req.params.id;
    const { title, description } = req.body;
    let image = null;
    if (req.file) image = `/uploads/${req.file.filename}`;

    if (image) {
      const text = `UPDATE items SET title = COALESCE($1, title), description = COALESCE($2, description), image = $3 WHERE id = $4 RETURNING *`;
      const values = [title || null, description || null, image, id];
      const { rows } = await db.query(text, values);
      if (!rows[0]) return res.status(404).json({ message: 'Item not found' });
      return res.json(rows[0]);
    } else {
      const text = `UPDATE items SET title = COALESCE($1, title), description = COALESCE($2, description) WHERE id = $3 RETURNING *`;
      const values = [title || null, description || null, id];
      const { rows } = await db.query(text, values);
      if (!rows[0]) return res.status(404).json({ message: 'Item not found' });
      return res.json(rows[0]);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE item by id (this is one of the tasks)
app.delete('/items/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { rows: existing } = await db.query('SELECT image FROM items WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ message: 'Item not found' });

    const del = `DELETE FROM items WHERE id = $1 RETURNING *`;
    const { rows } = await db.query(del, [id]);

    // remove file from uploads (best-effort)
    if (existing[0].image) {
      const filePath = path.join(__dirname, existing[0].image.replace(/^\/+/,''));
      fs.unlink(filePath, (err) => { /* ignore errors */ });
    }

    res.json({ message: 'Deleted', item: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Add item to cart
app.post('/cart/add', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { item_id, quantity } = req.body;
    const text = `
      INSERT INTO cart (user_id, item_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, item_id)
      DO UPDATE SET quantity = cart.quantity + EXCLUDED.quantity
      RETURNING *;
    `;
    const values = [userId, item_id, quantity || 1];
    const { rows } = await db.query(text, values);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove item from cart (удаление товара из корзины) — important
app.delete('/cart/remove', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { item_id } = req.body;
    const text = `DELETE FROM cart WHERE user_id = $1 AND item_id = $2 RETURNING *`;
    const values = [userId, item_id];
    const { rows } = await db.query(text, values);
    if (!rows[0]) return res.status(404).json({ message: 'Item not in cart' });
    res.json({ message: 'Removed from cart', removed: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's cart
app.get('/cart', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const text = `
      SELECT c.id as cart_id, c.quantity, c.added_at,
             i.id as item_id, i.title, i.description, i.image, i.created_at
      FROM cart c
      JOIN items i ON c.item_id = i.id
      WHERE c.user_id = $1
      ORDER BY c.added_at DESC
    `;
    const { rows } = await db.query(text, [userId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
