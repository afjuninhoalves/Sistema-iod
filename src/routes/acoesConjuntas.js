const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const QualificadorFactory = require('../models/Qualificador');
const AcaoPorCidadeOcorrenciaFactory = require('../models/AcaoPorCidadeOcorrencia');

// Multer setup para upload de arquivos de mídia
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, path.join(__dirname, '..', '..', 'uploads')),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      file.mimetype.startsWith('audio/') ||
      (file.mimetype.startsWith('video/') && ext === '.mp4')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido'));
    }
  }
});

// Helper: executa db.run como Promise e retorna lastID
function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

// ─── Visualizar Ação por Cidade (read-only) ───────────────────────────
router.get('/:acaoId/acao-por-cidade/:porCidadeId', (req, res, next) => {
  const { acaoId, porCidadeId } = req.params;
  const db = req.app.locals.db;
  const Qual = require('../models/Qualificador')(db);

  // 1) Carrega os dados básicos da ação por cidade
  db.get(
    `SELECT apc.*,
            c.cidade            AS cidade_participante,
            group_concat(apca.arquivo) AS arquivos,
            group_concat(apca.tipo)    AS tipos
       FROM acao_por_cidade apc
       JOIN cidades c   ON apc.cidade_id     = c.id
  LEFT JOIN acao_por_cidade_arquivos apca
         ON apc.id = apca.acao_por_cidade_id
      WHERE apc.id = ?
      GROUP BY apc.id`,
    [porCidadeId],
    (err, record) => {
      if (err) return next(err);
      if (!record) return res.status(404).send('Ação por cidade não encontrada');

      // 2) Ajusta arrays de mídia
      record.arquivos = record.arquivos ? record.arquivos.split(',') : [];
      record.tipos    = record.tipos    ? record.tipos.split(',')    : [];

      // 3) Busca qualificadores
      Qual.findByAcaoPorCidade(porCidadeId, (e, quals) => {
        if (e) return next(e);
        record.qualificadores = quals;

        // 4) Busca todas as ocorrências vinculadas
        db.all(
          `SELECT oc.id,
                  oc.protocolo,
                  oc.status
             FROM ocorrencias oc
             JOIN acao_cidade_ocorrencia apco
               ON apco.ocorrencia_id = oc.id
            WHERE apco.acao_por_cidade_id = ?`,
          [porCidadeId],
          (err2, vinculadas) => {
            if (err2) return next(err2);
            record.ocorrencias = vinculadas;

            // 5) Renderiza a view já com record.ocorrencias disponível
            res.render('acoes-conjuntas/detailPorCidade', {
              acaoId,
              record
            });
          }
        );
      });
    }
  );
}); // fecha router.get

// ─── Formulário para vincular múltiplas ocorrências ──────────────────
router.get(
  '/:acaoId/acao-por-cidade/:porCidadeId/vincular-ocorrencias',
  (req, res, next) => {
    const { acaoId, porCidadeId } = req.params;
    const db = req.app.locals.db;

    // 1) Pega a cidade desta ação
    db.get(
      'SELECT cidade_id FROM acao_por_cidade WHERE id = ?',
      [porCidadeId],
      (err, row) => {
        if (err) return next(err);
        const cid = row.cidade_id;

        // 2) Lista ocorrências desta cidade
        db.all(
          'SELECT id, protocolo, status FROM ocorrencias WHERE cidade_id = ?',
          [cid],
          (err2, possiveis) => {
            if (err2) return next(err2);

            // 3) Pega IDs já vinculados
            db.all(
              'SELECT ocorrencia_id FROM acao_cidade_ocorrencia WHERE acao_por_cidade_id = ?',
              [porCidadeId],
              (err3, links) => {
                if (err3) return next(err3);
                const linkedIds = links.map(l => l.ocorrencia_id);

                // 4) Renderiza o formulário
                res.render('acoes-conjuntas/vincularOcorrencias', {
                  acaoId,
                  id: porCidadeId,
                  possiveis,
                  linkedIds
                });
              }
            );
          }
        );
      }
    );
  }
);
// POST → grava as ocorrências selecionadas
router.post(
  '/:acaoId/acao-por-cidade/:porCidadeId/vincular-ocorrencias',
  (req, res, next) => {
    const { acaoId, porCidadeId } = req.params;
    let { ocorrencias } = req.body;  // pode vir string ou array
    const db = req.app.locals.db;

    // 1) Apaga todos os vínculos antigos desta ação
    db.run(
      'DELETE FROM acao_cidade_ocorrencia WHERE acao_por_cidade_id = ?',
      [porCidadeId],
      err => {
        if (err) return next(err);

        // 2) Se não houve seleção, volta direto
        if (!ocorrencias) {
          return res.redirect(
            `/acoes-conjuntas/${acaoId}/acao-por-cidade/${porCidadeId}`
          );
        }

        // 3) Garante array
        if (!Array.isArray(ocorrencias)) {
          ocorrencias = [ocorrencias];
        }

        // 4) Insere um a um
        const stmt = db.prepare(
          'INSERT INTO acao_cidade_ocorrencia (acao_por_cidade_id, ocorrencia_id) VALUES (?, ?)'
        );
        ocorrencias.forEach(ocId => {
          stmt.run(porCidadeId, ocId);
        });
        stmt.finalize(err2 => {
          if (err2) return next(err2);
          // 5) Redireciona de volta para o detalhe
          res.redirect(
            `/acoes-conjuntas/${acaoId}/acao-por-cidade/${porCidadeId}`
          );
        });
      }
    );
  }
);

// ─── Formulário de edição de Ação por Cidade (micro) ────────────────────
router.get('/:acaoId/acao-por-cidade/:porCidadeId/editar', (req, res, next) => {
  const { acaoId, porCidadeId } = req.params;
  const db = req.app.locals.db;
  const Qual = require('../models/Qualificador')(db);
  const Aco = AcaoPorCidadeOcorrenciaFactory(db);

  db.get(
    `SELECT apc.*, c.cidade AS cidade_participante
       FROM acao_por_cidade apc
       JOIN cidades c ON apc.cidade_id = c.id
      WHERE apc.id = ?`,
    [porCidadeId],
    (err, record) => {
      if (err) return next(err);
      if (!record) return res.status(404).send('Registro não encontrado');

      db.all(
        'SELECT arquivo, tipo FROM acao_por_cidade_arquivos WHERE acao_por_cidade_id = ?',
        [porCidadeId],
        (err2, files) => {
          if (err2) return next(err2);
          record.arquivos = files;

          Qual.findByAcaoPorCidade(porCidadeId, (err3, qualifiers) => {
            if (err3) return next(err3);
            record.qualificadores = qualifiers;

            Aco.findByAcaoPorCidade(porCidadeId, (err4, ocorrencias) => {
              if (err4) return next(err4);
              record.ocorrencias = ocorrencias;

              res.render('acoes-conjuntas/editPorCidade', { acaoId, record });
            });
          });
        }
      );
    }
  );
});

// ─── Processar submissão do formulário de edição de Ação por Cidade ────
router.post(
  '/:acaoId/acao-por-cidade/:porCidadeId/editar',
  upload.array('arquivos'),
  async (req, res, next) => {
    const { acaoId, porCidadeId } = req.params;
    const { data_hora, responsavel, descricao } = req.body;
    const {
      qual_id = [],
      qual_tipo = [],
      qual_nome = [],
      qual_cpf = [],
      qual_endereco = [],
      qual_telefone = [],
      qual_descricao = []
    } = req.body;
    const db = req.app.locals.db;
    const Qual = QualificadorFactory(db);

    try {
      await new Promise((ok, no) =>
        db.run(
          `UPDATE acao_por_cidade
              SET data_hora = ?, responsavel = ?, descricao = ?
            WHERE id = ?`,
          [data_hora, responsavel, descricao, porCidadeId],
          err => (err ? no(err) : ok())
        )
      );

      for (let i = 0; i < qual_id.length; i++) {
        await new Promise((ok, no) =>
          db.run(
            `UPDATE qualificadores
                SET tipo = ?, nome = ?, cpf = ?, endereco = ?, telefone = ?, descricao = ?
              WHERE id = ?`,
            [
              qual_tipo[i],
              qual_nome[i],
              qual_cpf[i] || null,
              qual_endereco[i] || null,
              qual_telefone[i],
              qual_descricao[i],
              qual_id[i]
            ],
            err => (err ? no(err) : ok())
          )
        );
      }

      res.redirect(`/acoes-conjuntas/${acaoId}`);
    } catch (e) {
      next(e);
    }
  }
);

// ─── Listagem de Ações Conjuntas (macro) ─────────────────────────────
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  db.all(
    `SELECT ac.id, c.cidade AS cidade_responsavel, ac.objetivo
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
      WHERE ac.status = 'aberta'`,
    [],
    (err, rows) => {
      if (err) return res.status(500).send(err.message);
      res.render('acoes-conjuntas/index', { acoes: rows });
    }
  );
});

// ─── Formulário nova Ação Conjunta (macro) ────────────────────────────
router.get('/new', (req, res) => {
  const db = req.app.locals.db;
  db.all('SELECT id, cidade FROM cidades', [], (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('acoes-conjuntas/new', { cidades });
  });
});

// ─── Criar Ação Conjunta (macro) ─────────────────────────────────────
router.post('/', (req, res) => {
  const { cidade_responsavel_id, objetivo, participantes } = req.body;
  const db = req.app.locals.db;
  db.run(
    `INSERT INTO acoes_conjuntas (cidade_responsavel_id, objetivo) VALUES (?, ?)`,
    [cidade_responsavel_id, objetivo],
    function (err) {
      if (err) return res.status(500).send(err.message);
      const acaoId = this.lastID;
      const stmt = db.prepare(
        `INSERT INTO acoes_conjuntas_participantes (acoes_conjuntas_id, cidade_id) VALUES (?, ?)`
      );
      const list = Array.isArray(participantes)
        ? participantes
        : [participantes];
      list.forEach(cid => stmt.run(acaoId, cid));
      stmt.finalize(() => res.redirect('/acoes-conjuntas'));
    }
  );
});

// ─── Detalhes da Ação Conjunta (macro) ───────────────────────────────
router.get('/:id', (req, res, next) => {
  const acaoId = req.params.id;
  const db = req.app.locals.db;
  const Qual = require('../models/Qualificador')(db);

  db.get(
    `SELECT ac.*, c.cidade AS cidade_responsavel
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
      WHERE ac.id = ?`,
    [acaoId],
    (err, acao) => {
      if (err) return next(err);
      if (!acao) return res.status(404).send('Ação não encontrada');

      db.all(
        `SELECT cp.cidade_id, c.cidade
           FROM acoes_conjuntas_participantes cp
           JOIN cidades c ON cp.cidade_id = c.id
          WHERE cp.acoes_conjuntas_id = ?`,
        [acaoId],
        (err2, participantes) => {
          if (err2) return next(err2);

          db.all(
            `SELECT
               apc.id,
               apc.data_hora,
               apc.responsavel,
               apc.descricao,
               c.cidade AS cidade_participante,
               group_concat(apca.arquivo) AS arquivos,
               group_concat(apca.tipo)    AS tipos
             FROM acao_por_cidade apc
             JOIN cidades c ON apc.cidade_id = c.id
        LEFT JOIN acao_por_cidade_arquivos apca ON apc.id = apca.acao_por_cidade_id
            WHERE apc.acoes_conjuntas_id = ?
         GROUP BY apc.id
         ORDER BY apc.data_hora DESC`,
            [acaoId],
            async (err3, acoesCidade) => {
              if (err3) return next(err3);

              acoesCidade.forEach(item => {
                item.arquivos = item.arquivos ? item.arquivos.split(',') : [];
                item.tipos = item.tipos ? item.tipos.split(',') : [];
              });

              try {
                await Promise.all(
                  acoesCidade.map(
                    item =>
                      new Promise((ok, fail) => {
                        Qual.findByAcaoPorCidade(item.id, (e, quals) => {
                          if (e) fail(e);
                          else {
                            item.qualificadores = quals;
                            ok();
                          }
                        });
                      })
                  )
                );
                res.render('acoes-conjuntas/show', {
                  acao,
                  participantes,
                  acoesCidade
                });
              } catch (e) {
                next(e);
              }
            }
          );
        }
      );
    }
  );
});

// ─── Formulário Adicionar Ação por Cidade (micro) ──────────────────────
router.get('/:id/adicionar', (req, res) => {
  const acaoId = req.params.id;
  const db = req.app.locals.db;

  // 1) busca as cidades participantes
  db.all(
    `SELECT cp.cidade_id, c.cidade
       FROM acoes_conjuntas_participantes cp
 JOIN cidades c ON cp.cidade_id = c.id
      WHERE cp.acoes_conjuntas_id = ?`,
    [acaoId],
    (err, cidades) => {
      if (err) return res.status(500).send(err.message);
      if (!cidades.length) return res.redirect(`/acoes-conjuntas/${acaoId}`);

      // 2) busca todas as ocorrências
      db.all(
        'SELECT id, protocolo, status FROM ocorrencias ORDER BY protocolo DESC',
        [],
        (err2, ocorrencias) => {
          if (err2) return res.status(500).send(err2.message);

          // 3) renderiza a view já com cidades e ocorrências
          res.render('acoes-conjuntas/adicionar', {
            acaoId,
            cidades,
            ocorrencias
          });
        }
      );

    } // fecha callback do primeiro db.all
  );   // fecha chamada do primeiro db.all

});   


// ─── Criar Ação por Cidade (multi-bloco + upload) ─────────────────────
router.post('/:id/cidades/:cidadeId', upload.any(), async (req, res, next) => {
  try {
    const acaoId = req.params.id;
    const cidadeId = req.params.cidadeId;
    const { data_hora, responsavel, descricao, ocorrenciaId } = req.body;
    const db = req.app.locals.db;

    const apcId = await runAsync(
      db,
      `INSERT INTO acao_por_cidade
         (acoes_conjuntas_id, cidade_id, ocorrencia_id, data_hora, responsavel, descricao)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        acaoId,
        cidadeId,
        ocorrenciaId || null,  // grava null se não selecionou
        data_hora,
        responsavel,
        descricao
      ]
    );
    

    const Qualificador = QualificadorFactory(db);
    const tipos = Array.isArray(req.body.qualificacao_tipo)
      ? req.body.qualificacao_tipo
      : [req.body.qualificacao_tipo];

    for (let idx = 0; idx < tipos.length; idx++) {
      await new Promise((ok, rej) => {
        Qualificador.create(
          {
            acaoPorCidadeId: apcId,
            tipo: tipos[idx],
            nome: Array.isArray(req.body.q_nome)
              ? req.body.q_nome[idx]
              : req.body.q_nome,
            cpf: Array.isArray(req.body.q_cpf)
              ? req.body.q_cpf[idx]
              : req.body.q_cpf,
            endereco: Array.isArray(req.body.q_endereco)
              ? req.body.q_endereco[idx]
              : req.body.q_endereco,
            telefone: Array.isArray(req.body.q_telefone)
              ? req.body.q_telefone[idx]
              : req.body.q_telefone,
            descricao: Array.isArray(req.body.q_descricao)
              ? req.body.q_descricao[idx]
              : req.body.q_descricao
          },
          err => (err ? rej(err) : ok())
        );
      });
    }

    res.redirect(`/acoes-conjuntas/${acaoId}`);
  } catch (err) {
    next(err);
  }
});

// ─── Editar Ação Conjunta (macro) ─────────────────────────────────────
router.get('/:id/edit', (req, res, next) => {
  const acaoId = req.params.id;
  const db = req.app.locals.db;

  db.get(
    `SELECT ac.*, c.cidade AS cidade_responsavel
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
      WHERE ac.id = ?`,
    [acaoId],
    (err, acao) => {
      if (err) return next(err);
      if (!acao) return res.status(404).send('Ação não encontrada');

      db.all(
        `SELECT cidade_id FROM acoes_conjuntas_participantes
           WHERE acoes_conjuntas_id = ?`,
        [acaoId],
        (err2, parts) => {
          if (err2) return next(err2);
          const participantes = parts.map(p => p.cidade_id);

          db.all('SELECT id, cidade FROM cidades', [], (err3, cidades) => {
            if (err3) return next(err3);
            res.render('acoes-conjuntas/edit', {
              acao,
              participantes,
              cidades
            });
          });
        }
      );
    }
  );
});


// ─── Atualizar Ação Conjunta (macro) ───────────────────────────────────
router.post('/:id/edit', (req, res, next) => {
  const acaoId = req.params.id;
  const { cidade_responsavel_id, objetivo, participantes } = req.body;
  const db = req.app.locals.db;

  db.run(
    'UPDATE acoes_conjuntas SET cidade_responsavel_id = ?, objetivo = ? WHERE id = ?',
    [cidade_responsavel_id, objetivo, acaoId],
    err => {
      if (err) return next(err);

      db.run(
        'DELETE FROM acoes_conjuntas_participantes WHERE acoes_conjuntas_id = ?',
        [acaoId],
        err2 => {
          if (err2) return next(err2);

          const stmt = db.prepare(
            'INSERT INTO acoes_conjuntas_participantes (acoes_conjuntas_id, cidade_id) VALUES (?, ?)'
          );
          const list = Array.isArray(participantes)
            ? participantes
            : [participantes];
          list.forEach(cid => stmt.run(acaoId, cid));

          stmt.finalize(err3 => {
            if (err3) return next(err3);
            res.redirect(`/acoes-conjuntas/${acaoId}`);
          });
        }
      );
    }
  );
});

module.exports = router;
