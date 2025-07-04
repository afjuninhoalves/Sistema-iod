// models/AcaoPorCidadeOcorrencia.js
module.exports = (db) => ({
  // 1) vincula uma ocorrência (por ID) a uma ação por cidade (por ID)
  link: (acaoPorCidadeId, ocorrenciaId, cb) => {
    db.run(
      `INSERT INTO acao_por_cidade_ocorrencias
         (acao_por_cidade_id, ocorrencia_id)
       VALUES (?, ?)`,
      [acaoPorCidadeId, ocorrenciaId],
      cb
    );
  },

  // 2) traz todas as ocorrências já vinculadas a uma dada ação por cidade
  findByAcaoPorCidade: (acaoPorCidadeId, cb) => {
    db.all(
      `SELECT o.*
         FROM acao_por_cidade_ocorrencias aco
         JOIN ocorrencias o
           ON aco.ocorrencia_id = o.id
        WHERE aco.acao_por_cidade_id = ?`,
      [acaoPorCidadeId],
      cb
    );
  }
});
