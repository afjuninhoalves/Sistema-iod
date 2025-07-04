// models/Qualificador.js

module.exports = function(db) {
  return {
    /**
     * Insere um novo qualificador na tabela.
     * @param {{acaoPorCidadeId:number, tipo:string, nome:string, cpf?:string, endereco?:string, telefone:string, descricao:string}} data
     * @param {(err:Error|null)=>void} cb
     */
    create(data, cb) {
      const sql = `
        INSERT INTO qualificadores
          (acao_por_cidade_id, tipo, nome, cpf, endereco, telefone, descricao)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(
        sql,
        [
          data.acaoPorCidadeId,
          data.tipo,
          data.nome,
          data.cpf || null,
          data.endereco || null,
          data.telefone,
          data.descricao
        ],
        cb
      );
    },

    /**
     * Retorna todos os qualificadores de uma ação por cidade.
     * @param {number} acaoPorCidadeId
     * @param {(err:Error|null, rows:any[])=>void} cb
     */
    findByAcaoPorCidade(acaoPorCidadeId, cb) {
      const sql = `
        SELECT
          id,
          tipo,
          nome,
          cpf,
          endereco,
          telefone,
          descricao
        FROM qualificadores
        WHERE acao_por_cidade_id = ?
        ORDER BY id
      `;
      db.all(sql, [acaoPorCidadeId], cb);
    }
  };
};