const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use(
  session({
    secret: 'kampus-rahasia-super-aman',
    resave: false,
    saveUninitialized: false,
  })
);

let db;

// Fungsi helper untuk menyimpan database ke file fisik karena sql.js berjalan in-memory
function saveDb() {
  const data = db.export();
  fs.writeFileSync('data.db', Buffer.from(data));
}

// Fungsi helper untuk mengeksekusi SELECT query dan memetakan hasilnya menjadi array of objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

// Inisialisasi SQL.js dan server
initSqlJs().then((SQL) => {
  if (fs.existsSync('data.db')) {
    const filebuffer = fs.readFileSync('data.db');
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
    db.run(
      `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, role TEXT)`
    );
    db.run(
      `CREATE TABLE announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
    );

    // Buat akun admin otomatis saat database pertama kali dibuat
    const hash = bcrypt.hashSync('Admin123!', 10);
    db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, ?)`, [
      'admin@kampus.test',
      hash,
      'admin',
    ]);
    saveDb();
  }

  app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
  });
});

// Middleware Autentikasi dan Otorisasi
const requireAuth = (req, res, next) => {
  if (!req.session.userId)
    return res.status(401).json({ error: 'Harap login terlebih dahulu' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.session.role !== 'admin')
    return res
      .status(403)
      .json({ error: 'Akses ditolak. Fitur khusus admin.' });
  next();
};

// --- ROUTES ---

app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  try {
    const existingUser = queryOne('SELECT * FROM users WHERE email = ?', [
      email,
    ]);
    if (existingUser)
      return res.status(400).json({ error: 'Email sudah terdaftar' });

    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [
      email,
      hash,
      'user',
    ]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ success: true, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, role: req.session.role });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/announcements', requireAuth, (req, res) => {
  const data = queryAll('SELECT * FROM announcements ORDER BY id DESC');
  res.json(data);
});

app.post('/api/announcements', requireAdmin, (req, res) => {
  const { title, content } = req.body;
  db.run('INSERT INTO announcements (title, content) VALUES (?, ?)', [
    title,
    content,
  ]);
  saveDb();
  res.json({ success: true });
});

app.delete('/api/announcements/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});
