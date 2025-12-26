const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function openDatabase(dbPath, schemaPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA synchronous = NORMAL;');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schema);

  return db;
}

module.exports = {
  openDatabase
};


