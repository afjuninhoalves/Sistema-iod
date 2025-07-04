const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./src/banco.sqlite');

module.exports = {
  getAllOpen(callback) {
    db.all(
      `SELECT ac.id, c.nome as cidade_responsavel, ac.objetivo
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
       WHERE ac.status = 'aberta'
       ORDER BY ac.created_at DESC`,
      [], callback
    );
  },
  getById(id, callback) {
    db.get(
      `SELECT ac.*, c.nome as cidade_responsavel
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
       WHERE ac.id = ?`,
      [id], callback
    );
  },
  create(data, callback) {
    const { cidade_responsavel_id, objetivo, participantes } = data;
    db.run(
      `INSERT INTO acoes_conjuntas (cidade_responsavel_id, objetivo) VALUES (?, ?)`,
      [cidade_responsavel_id, objetivo],
      function(err) {
        if (err) return callback(err);
        const acaoId = this.lastID;
        const stmt = db.prepare(
          `INSERT INTO acoes_conjuntas_participantes (acoes_conjuntas_id, cidade_id) VALUES (?, ?)`
        );
        participantes.forEach(cid => stmt.run(acaoId, cid));
        stmt.finalize(() => callback(null, acaoId));
      }
    );
  }
};