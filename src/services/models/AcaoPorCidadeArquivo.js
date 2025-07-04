const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./src/banco.sqlite');

module.exports = {
  create(acaoPorCidadeId, arquivo, tipo, callback) {
    db.run(
      `INSERT INTO acao_por_cidade_arquivos (acao_por_cidade_id, arquivo, tipo) VALUES (?, ?, ?)`,
      [acaoPorCidadeId, arquivo, tipo],
      callback
    );
  },
  getAllByAcaoPorCidade(id, callback) {
    db.all(
      `SELECT * FROM acao_por_cidade_arquivos WHERE acao_por_cidade_id = ?`,
      [id], callback
    );
  }
};