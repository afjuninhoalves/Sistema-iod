const express = require('express');
const router = express.Router();

// Detalhes de uma Ocorrência
router.get('/:id', (req, res, next) => {
  const { id } = req.params;
  const db = req.app.locals.db;

  // 1) Busca ocorrência
  db.get('SELECT * FROM ocorrencias WHERE id = ?', [id], (err, ocorrencia) => {
    if (err) return next(err);
    if (!ocorrencia) return res.status(404).send('Ocorrência não encontrada');

    // 2) Veículos
    db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err2, veiculos) => {
      if (err2) return next(err2);

      // 3) Envolvidos
      db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err3, envolvidos) => {
        if (err3) return next(err3);

        // 4) Complementos
        db.all('SELECT * FROM complementos_ocorrencia WHERE ocorrencia_id = ?', [id], (err4, complementos) => {
          if (err4) return next(err4);

          // 5) Renderiza a view com todos os dados
          res.render('ocorrencias/detalhesOcorrencia', {
            ocorrencia,
            veiculos,
            envolvidos,
            complementos
          });
        });
      });
    });
  });
});

module.exports = router;
