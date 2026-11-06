const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DB_PATH = path.join(__dirname, 'data.db');

let db;

// Middleware
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'kampus-secret-ganti-di-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// Simpan database ke file
function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper menjalankan query
function query(sql, params = []) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);

    const results = [];

    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }

    return results;
  } finally {
    stmt.free();
  }
}

// Helper menjalankan perintah SQL
function execute(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

// Middleware autentikasi
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: 'Silakan login terlebih dahulu.',
    });
  }

  next();
}

// Middleware khusus admin
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: 'Silakan login terlebih dahulu.',
    });
  }

  if (req.session.user.role !== 'admin') {
    return res.status(403).json({
      message: 'Akses ditolak. Khusus admin.',
    });
  }

  next();
}

// Registrasi
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Semua field wajib diisi.',
      });
    }

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        message: 'Format data tidak valid.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password minimal 8 karakter.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = query('SELECT id FROM users WHERE email = ?', [
      normalizedEmail,
    ]);

    if (existing.length > 0) {
      return res.status(409).json({
        message: 'Email sudah terdaftar.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    execute(
      `INSERT INTO users (name, email, password, role)
             VALUES (?, ?, ?, 'user')`,
      [name.trim(), normalizedEmail, hashedPassword]
    );

    res.status(201).json({
      message: 'Registrasi berhasil. Silakan login.',
    });
  } catch (error) {
    console.error('Register error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan pada server.',
    });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      !email ||
      !password ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        message: 'Email dan password wajib diisi.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const users = query('SELECT * FROM users WHERE email = ?', [
      normalizedEmail,
    ]);

    if (users.length === 0) {
      return res.status(401).json({
        message: 'Email atau password salah.',
      });
    }

    const user = users[0];

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({
        message: 'Email atau password salah.',
      });
    }

    // Regenerasi session untuk mencegah session fixation
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({
          message: 'Gagal membuat session.',
        });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };

      req.session.save((err) => {
        if (err) {
          return res.status(500).json({
            message: 'Gagal menyimpan session.',
          });
        }

        res.json({
          message: 'Login berhasil.',
          user: req.session.user,
        });
      });
    });
  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      message: 'Terjadi kesalahan pada server.',
    });
  }
});

// Cek status login
app.get('/api/me', (req, res) => {
  res.json({
    user: req.session.user || null,
  });
});

// Logout
app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        message: 'Gagal logout.',
      });
    }

    res.clearCookie('connect.sid');

    res.json({
      message: 'Logout berhasil.',
    });
  });
});

// Melihat semua pengumuman
// Dapat diakses admin maupun user yang sudah login
app.get('/api/announcements', requireAuth, (req, res) => {
  const announcements = query(
    `SELECT id, title, content, created_at
         FROM announcements
         ORDER BY id DESC`
  );

  res.json(announcements);
});

// Menambahkan pengumuman (admin saja)
app.post('/api/announcements', requireAdmin, (req, res) => {
  try {
    const { title, content } = req.body;

    if (
      !title ||
      !content ||
      typeof title !== 'string' ||
      typeof content !== 'string' ||
      !title.trim() ||
      !content.trim()
    ) {
      return res.status(400).json({
        message: 'Judul dan isi pengumuman wajib diisi.',
      });
    }

    execute(
      `INSERT INTO announcements (title, content, created_at)
             VALUES (?, ?, ?)`,
      [title.trim(), content.trim(), new Date().toISOString()]
    );

    res.status(201).json({
      message: 'Pengumuman berhasil ditambahkan.',
    });
  } catch (error) {
    console.error('Add announcement error:', error);

    res.status(500).json({
      message: 'Gagal menambahkan pengumuman.',
    });
  }
});

// Menghapus pengumuman (admin saja)
app.delete('/api/announcements/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: 'ID pengumuman tidak valid.',
    });
  }

  const existing = query('SELECT id FROM announcements WHERE id = ?', [id]);

  if (existing.length === 0) {
    return res.status(404).json({
      message: 'Pengumuman tidak ditemukan.',
    });
  }

  execute('DELETE FROM announcements WHERE id = ?', [id]);

  res.json({
    message: 'Pengumuman berhasil dihapus.',
  });
});

// Inisialisasi database
async function startServer() {
  try {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    // Tabel users
    db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
                    CHECK(role IN ('user', 'admin'))
            )
        `);

    // Tabel announcements
    db.run(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `);

    saveDatabase();

    // Buat akun admin otomatis jika belum ada
    const admin = query('SELECT id FROM users WHERE email = ?', [
      'admin@kampus.test',
    ]);

    if (admin.length === 0) {
      const hashedPassword = await bcrypt.hash('Admin123!', 10);

      execute(
        `INSERT INTO users (name, email, password, role)
                 VALUES (?, ?, ?, 'admin')`,
        ['Administrator Kampus', 'admin@kampus.test', hashedPassword]
      );

      console.log('Akun admin berhasil dibuat.');
    }

    app.listen(PORT, () => {
      console.log('--------------------------------');
      console.log('Aplikasi Pengumuman Kampus');
      console.log(`Server berjalan: http://localhost:${PORT}`);
      console.log('--------------------------------');
    });
  } catch (error) {
    console.error('Gagal menjalankan server:', error);
    process.exit(1);
  }
}

startServer();
