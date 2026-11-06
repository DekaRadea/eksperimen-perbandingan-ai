const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'data.db');
const ADMIN_EMAIL = 'admin@kampus.test';
const ADMIN_PASSWORD = 'Admin123!';

let db;

// ---------- Helper database ----------
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  db.run(sql, params);
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id)
  )`);

  // Buat akun admin otomatis jika belum ada
  const admin = get('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);
  if (!admin) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Administrator', ADMIN_EMAIL, hash, 'admin']
    );
    console.log(`Akun admin dibuat: ${ADMIN_EMAIL}`);
  }

  saveDb();
}

// ---------- Aplikasi ----------
const app = express();

app.use(express.json({ limit: '100kb' }));

app.use(
  session({
    name: 'kampus.sid',
    secret:
      process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: false, // set true jika memakai HTTPS
      maxAge: 1000 * 60 * 60 * 2, // 2 jam
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Middleware otorisasi ----------
function currentUser(req) {
  if (!req.session.userId) return null;
  // Role selalu dibaca ulang dari database, bukan dari input klien
  return (
    get('SELECT id, name, email, role FROM users WHERE id = ?', [
      req.session.userId,
    ]) || null
  );
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user)
    return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user)
    return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  if (user.role !== 'admin')
    return res.status(403).json({ error: 'Akses ditolak. Hanya admin.' });
  req.user = user;
  next();
}

// ---------- Validasi ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// ---------- Rute autentikasi ----------
app.post('/api/register', (req, res) => {
  const name = str(req.body.name);
  const email = str(req.body.email).toLowerCase();
  const password =
    typeof req.body.password === 'string' ? req.body.password : '';

  if (!name || name.length > 100)
    return res
      .status(400)
      .json({ error: 'Nama wajib diisi (maks. 100 karakter).' });
  if (!EMAIL_RE.test(email) || email.length > 200)
    return res.status(400).json({ error: 'Format email tidak valid.' });
  if (password.length < 8 || password.length > 72) {
    return res
      .status(400)
      .json({ error: 'Password minimal 8 karakter (maks. 72).' });
  }

  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: 'Email sudah terdaftar.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  // Role dipaksa "user"; nilai role dari klien diabaikan
  run(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, hash, 'user']
  );
  saveDb();

  res.status(201).json({ message: 'Registrasi berhasil. Silakan login.' });
});

app.post('/api/login', (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password =
    typeof req.body.password === 'string' ? req.body.password : '';

  const user = get(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = ?',
    [email]
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email atau password salah.' });
  }

  // Regenerasi session untuk mencegah session fixation
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Gagal membuat sesi.' });
    req.session.userId = user.id;
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('kampus.sid');
    res.json({ message: 'Logout berhasil.' });
  });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login.' });
  res.json({ user });
});

// ---------- Rute pengumuman ----------
app.get('/api/announcements', requireAuth, (req, res) => {
  const rows = all(
    `SELECT a.id, a.title, a.content, a.created_at, u.name AS author
     FROM announcements a JOIN users u ON u.id = a.author_id
     ORDER BY a.id DESC`
  );
  res.json({ announcements: rows });
});

app.post('/api/announcements', requireAdmin, (req, res) => {
  const title = str(req.body.title);
  const content = str(req.body.content);

  if (!title || title.length > 200)
    return res
      .status(400)
      .json({ error: 'Judul wajib diisi (maks. 200 karakter).' });
  if (!content || content.length > 5000)
    return res
      .status(400)
      .json({ error: 'Isi wajib diisi (maks. 5000 karakter).' });

  run(
    'INSERT INTO announcements (title, content, author_id) VALUES (?, ?, ?)',
    [title, content, req.user.id]
  );
  const { id } = get('SELECT last_insert_rowid() AS id');
  saveDb();

  res.status(201).json({ message: 'Pengumuman ditambahkan.', id });
});

app.delete('/api/announcements/:id', requireAdmin, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: 'ID tidak valid.' });

  if (!get('SELECT id FROM announcements WHERE id = ?', [id])) {
    return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
  }

  run('DELETE FROM announcements WHERE id = ?', [id]);
  saveDb();
  res.json({ message: 'Pengumuman dihapus.' });
});

// Rute API yang tidak dikenal
app.use('/api', (req, res) =>
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' })
);

// Penanganan error umum
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

initDb()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`Server berjalan di http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('Gagal inisialisasi database:', err);
    process.exit(1);
  });
