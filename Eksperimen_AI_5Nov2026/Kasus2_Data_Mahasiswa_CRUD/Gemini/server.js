const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;
const dbFile = 'data.db';

// Inisialisasi Database sql.js
initSqlJs()
  .then(function (SQL) {
    if (fs.existsSync(dbFile)) {
      // Jika file data.db ada, muat isinya ke database memory
      const filebuffer = fs.readFileSync(dbFile);
      db = new SQL.Database(filebuffer);
      console.log('Database berhasil dimuat dari data.db');
    } else {
      // Jika belum ada, buat baru dan bikin tabel
      db = new SQL.Database();
      db.run(
        'CREATE TABLE mahasiswa (nim TEXT PRIMARY KEY, nama TEXT, prodi TEXT)'
      );
      saveDatabase();
      console.log('Database data.db baru berhasil dibuat');
    }

    // Jalankan server setelah database siap
    app.listen(port, () => {
      console.log(`Server berjalan di http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Gagal menginisialisasi sql.js:', err);
  });

// Fungsi pembantu untuk menyimpan db dari memory ke file data.db
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbFile, buffer);
}

// ================= API ROUTES =================

// Ambil semua data mahasiswa
app.get('/api/mahasiswa', (req, res) => {
  const query = db.exec('SELECT * FROM mahasiswa');
  let result = [];
  if (query.length > 0) {
    const columns = query[0].columns;
    const values = query[0].values;
    // Format dari array of arrays ke array of objects
    result = values.map((val) => {
      let obj = {};
      columns.forEach((col, index) => {
        obj[col] = val[index];
      });
      return obj;
    });
  }
  res.json(result);
});

// Tambah data mahasiswa
app.post('/api/mahasiswa', (req, res) => {
  const { nim, nama, prodi } = req.body;

  if (!nim || !nama || !prodi) {
    return res.status(400).json({ error: 'Semua field wajib diisi!' });
  }

  // Cek duplikasi NIM
  const cekNim = db.exec('SELECT nim FROM mahasiswa WHERE nim = ?', [nim]);
  if (cekNim.length > 0) {
    return res
      .status(400)
      .json({ error: 'NIM sudah terdaftar, tidak boleh duplikat!' });
  }

  try {
    db.run('INSERT INTO mahasiswa (nim, nama, prodi) VALUES (?, ?, ?)', [
      nim,
      nama,
      prodi,
    ]);
    saveDatabase();
    res.json({ message: 'Data berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Edit data mahasiswa
app.put('/api/mahasiswa/:nim', (req, res) => {
  const { nama, prodi } = req.body;
  const nim = req.params.nim;

  if (!nama || !prodi) {
    return res
      .status(400)
      .json({ error: 'Nama dan Program Studi wajib diisi!' });
  }

  try {
    db.run('UPDATE mahasiswa SET nama = ?, prodi = ? WHERE nim = ?', [
      nama,
      prodi,
      nim,
    ]);
    saveDatabase();
    res.json({ message: 'Data berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Hapus data mahasiswa
app.delete('/api/mahasiswa/:nim', (req, res) => {
  const nim = req.params.nim;
  try {
    db.run('DELETE FROM mahasiswa WHERE nim = ?', [nim]);
    saveDatabase();
    res.json({ message: 'Data berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});
