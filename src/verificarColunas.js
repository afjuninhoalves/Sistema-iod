
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/ocorrencias.db');

db.all("PRAGMA table_info(ocorrencias);", [], (err, columns) => {
    if (err) {
        console.error(err.message);
        return;
    }
    console.log("Colunas da tabela ocorrencias:");
    columns.forEach(col => console.log(`- ${col.name}`));
});

db.close();
