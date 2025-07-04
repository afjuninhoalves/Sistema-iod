const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./src/banco.sqlite');

module.exports = {
  getAllByAcao(acaoId, callback) {
    db.all(
      `SELECT apc.*, c.nome as cidade
       FROM acao_por_cidade apc
       JOIN cidades c ON apc.cidade_id = c.id
       WHERE apc.acoes_conjuntas_id = ?
       ORDER BY apc.data_hora DESC`,
      [acaoId], callback
    );
  },
  create(data, callback) {
    const {
      acaoId, cidade_id, data_hora,
      responsavel, descricao,
      qualificacao_tipo,
      q_nome, q_cpf, q_endereco, q_telefone, q_descricao
    } = data;
    db.run(
      `INSERT INTO acao_por_cidade
        (acoes_conjuntas_id, cidade_id, data_hora, responsavel, descricao,
         qualificacao_tipo, q_nome, q_cpf, q_endereco, q_telefone, q_descricao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        acaoId, cidade_id, data_hora,
        responsavel, descricao,
        qualificacao_tipo,
        q_nome, q_cpf, q_endereco, q_telefone, q_descricao
      ],
      function(err) { callback(err, this.lastID); }
    );
  }
};