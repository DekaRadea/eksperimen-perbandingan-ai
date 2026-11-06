const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'data.db');

let db;

// Simpan seluruh isi database (in-memory) ke file data.db
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// Jalankan SELECT dan kembalikan array of object
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

// Validasi: semua field wajib diisi
function validate(body) {
  const nim = String(body.nim ?? '').trim();
  const nama = String(body.nama ?? '').trim();
  const prodi = String(body.prodi ?? '').trim();
  const errors = [];
  if (!nim) errors.push('NIM wajib diisi.');
  if (!nama) errors.push('Nama wajib diisi.');
  if (!prodi) errors.push('Prodi wajib diisi.');
  return { data: { nim, nama, prodi }, errors };
}

async function main() {
  const SQL = await initSqlJs();

  // Muat database dari file jika ada, jika tidak buat baru
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS mahasiswa (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      nim   TEXT NOT NULL UNIQUE,
      nama  TEXT NOT NULL,
      prodi TEXT NOT NULL
    )
  `);
  saveDb();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // 2) Tampilkan semua data
  app.get('/api/mahasiswa', (req, res) => {
    const rows = queryAll(
      'SELECT id, nim, nama, prodi FROM mahasiswa ORDER BY nim'
    );
    res.json(rows);
  });

  // 1) Tambah data
  app.post('/api/mahasiswa', (req, res) => {
    const { data, errors } = validate(req.body);
    if (errors.length)
      return res.status(400).json({ message: errors.join(' ') });

    if (queryOne('SELECT id FROM mahasiswa WHERE nim = ?', [data.nim])) {
      return res
        .status(409)
        .json({ message: `NIM ${data.nim} sudah terdaftar.` });
    }

    try {
      db.run('INSERT INTO mahasiswa (nim, nama, prodi) VALUES (?, ?, ?)', [
        data.nim,
        data.nama,
        data.prodi,
      ]);
      const id = queryOne('SELECT last_insert_rowid() AS id').id;
      saveDb();
      res.status(201).json({ id, ...data });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res
          .status(409)
          .json({ message: `NIM ${data.nim} sudah terdaftar.` });
      }
      res.status(500).json({ message: 'Gagal menyimpan data.' });
    }
  });

  // 3) Edit data
  app.put('/api/mahasiswa/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!queryOne('SELECT id FROM mahasiswa WHERE id = ?', [id])) {
      return res.status(404).json({ message: 'Data tidak ditemukan.' });
    }

    const { data, errors } = validate(req.body);
    if (errors.length)
      return res.status(400).json({ message: errors.join(' ') });

    // NIM tidak boleh sama dengan milik mahasiswa lain
    if (
      queryOne('SELECT id FROM mahasiswa WHERE nim = ? AND id <> ?', [
        data.nim,
        id,
      ])
    ) {
      return res
        .status(409)
        .json({ message: `NIM ${data.nim} sudah dipakai mahasiswa lain.` });
    }

    try {
      db.run('UPDATE mahasiswa SET nim = ?, nama = ?, prodi = ? WHERE id = ?', [
        data.nim,
        data.nama,
        data.prodi,
        id,
      ]);
      saveDb();
      res.json({ id, ...data });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res
          .status(409)
          .json({ message: `NIM ${data.nim} sudah dipakai mahasiswa lain.` });
      }
      res.status(500).json({ message: 'Gagal memperbarui data.' });
    }
  });

  // 4) Hapus data
  app.delete('/api/mahasiswa/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!queryOne('SELECT id FROM mahasiswa WHERE id = ?', [id])) {
      return res.status(404).json({ message: 'Data tidak ditemukan.' });
    }
    db.run('DELETE FROM mahasiswa WHERE id = ?', [id]);
    saveDb();
    res.json({ message: 'Data berhasil dihapus.' });
  });

  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
