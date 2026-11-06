const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3000;

const DB_PATH = path.join(__dirname, 'data.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

// Fungsi menyimpan database ke file
function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Fungsi mengambil seluruh data mahasiswa
function getAllMahasiswa() {
  const stmt = db.prepare('SELECT * FROM mahasiswa ORDER BY id DESC');

  const result = [];

  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }

  stmt.free();

  return result;
}

// Inisialisasi database
async function startServer() {
  const SQL = await initSqlJs();

  // Membaca database jika sudah tersedia
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Membuat tabel jika belum tersedia
  db.run(`
        CREATE TABLE IF NOT EXISTS mahasiswa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nim TEXT NOT NULL UNIQUE,
            nama TEXT NOT NULL,
            prodi TEXT NOT NULL
        )
    `);

  saveDatabase();

  // =========================
  // GET: Menampilkan data
  // =========================
  app.get('/api/mahasiswa', (req, res) => {
    try {
      const data = getAllMahasiswa();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        message: 'Gagal mengambil data mahasiswa',
      });
    }
  });

  // =========================
  // POST: Menambahkan data
  // =========================
  app.post('/api/mahasiswa', (req, res) => {
    const { nim, nama, prodi } = req.body;

    // Validasi field wajib
    if (!nim?.trim() || !nama?.trim() || !prodi?.trim()) {
      return res.status(400).json({
        message: 'Semua field wajib diisi!',
      });
    }

    const nimValue = nim.trim();
    const namaValue = nama.trim();
    const prodiValue = prodi.trim();

    try {
      // Cek NIM duplikat
      const check = db.prepare('SELECT id FROM mahasiswa WHERE nim = ?');

      check.bind([nimValue]);

      const exists = check.step();
      check.free();

      if (exists) {
        return res.status(400).json({
          message: 'NIM sudah terdaftar!',
        });
      }

      // Simpan data
      db.run(
        `INSERT INTO mahasiswa (nim, nama, prodi)
                 VALUES (?, ?, ?)`,
        [nimValue, namaValue, prodiValue]
      );

      saveDatabase();

      res.status(201).json({
        message: 'Data mahasiswa berhasil ditambahkan!',
      });
    } catch (error) {
      res.status(500).json({
        message: 'Gagal menambahkan data mahasiswa',
      });
    }
  });

  // =========================
  // PUT: Mengedit data
  // =========================
  app.put('/api/mahasiswa/:id', (req, res) => {
    const id = Number(req.params.id);
    const { nim, nama, prodi } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: 'ID mahasiswa tidak valid!',
      });
    }

    // Validasi field wajib
    if (!nim?.trim() || !nama?.trim() || !prodi?.trim()) {
      return res.status(400).json({
        message: 'Semua field wajib diisi!',
      });
    }

    const nimValue = nim.trim();
    const namaValue = nama.trim();
    const prodiValue = prodi.trim();

    try {
      // Pastikan data tersedia
      const current = db.prepare('SELECT id FROM mahasiswa WHERE id = ?');

      current.bind([id]);

      const found = current.step();
      current.free();

      if (!found) {
        return res.status(404).json({
          message: 'Data mahasiswa tidak ditemukan!',
        });
      }

      // Cek NIM duplikat selain data yang sedang diedit
      const check = db.prepare(
        `SELECT id FROM mahasiswa
                 WHERE nim = ? AND id != ?`
      );

      check.bind([nimValue, id]);

      const duplicate = check.step();
      check.free();

      if (duplicate) {
        return res.status(400).json({
          message: 'NIM sudah digunakan mahasiswa lain!',
        });
      }

      // Update data
      db.run(
        `UPDATE mahasiswa
                 SET nim = ?, nama = ?, prodi = ?
                 WHERE id = ?`,
        [nimValue, namaValue, prodiValue, id]
      );

      saveDatabase();

      res.json({
        message: 'Data mahasiswa berhasil diperbarui!',
      });
    } catch (error) {
      res.status(500).json({
        message: 'Gagal memperbarui data mahasiswa',
      });
    }
  });

  // =========================
  // DELETE: Menghapus data
  // =========================
  app.delete('/api/mahasiswa/:id', (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: 'ID mahasiswa tidak valid!',
      });
    }

    try {
      const stmt = db.prepare('SELECT id FROM mahasiswa WHERE id = ?');

      stmt.bind([id]);

      const exists = stmt.step();
      stmt.free();

      if (!exists) {
        return res.status(404).json({
          message: 'Data mahasiswa tidak ditemukan!',
        });
      }

      db.run('DELETE FROM mahasiswa WHERE id = ?', [id]);

      saveDatabase();

      res.json({
        message: 'Data mahasiswa berhasil dihapus!',
      });
    } catch (error) {
      res.status(500).json({
        message: 'Gagal menghapus data mahasiswa',
      });
    }
  });

  // Menjalankan server
  app.listen(PORT, () => {
    console.log('--------------------------------');
    console.log('Aplikasi Data Mahasiswa berjalan');
    console.log(`URL: http://localhost:${PORT}`);
    console.log('Database: data.db');
    console.log('--------------------------------');
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan server:', error);
  process.exit(1);
});
