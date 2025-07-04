const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');

// Models
const AcoesConjuntas = require('../models/AcoesConjuntas');
const AcaoPorCidade = require('../models/AcaoPorCidade');
const AcaoPorCidadeArquivo = require('../models/AcaoPorCidadeArquivo');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, path.join(__dirname, '..', '..', 'uploads')),
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      file.mimetype.startsWith('audio/') ||
      (file.mimetype.startsWith('video/') && ext === '.mp4')
    ) cb(null, true);
    else cb(new Error('Formato inválido'));
  }
});

// ─── Listagem de Ações Conjuntas ─────────────────────────────
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const sql =
    'SELECT ac.id, c.cidade AS cidade_responsavel, ac.objetivo ' +
    'FROM acoes_conjuntas ac ' +
    'JOIN cidades c ON ac.cidade_responsavel_id = c.id ' +
    "WHERE ac.status = 'aberta'";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('acoes-conjuntas/index', { acoes: rows });
  });
});

// ─── Formulário Novo ────────────────────────────────────────
router.get('/new', (req, res) => {
  const db = req.app.locals.db;
  db.all('SELECT * FROM cidades', [], (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('acoes-conjuntas/new', { cidades });
  });
});

// ─── Criar Ação Conjunta ───────────────────────────────────
router.post('/', (req, res) => {
  const { cidade_responsavel_id, objetivo, participantes } = req.body;
  const db = req.app.locals.db;
  db.run(
    'INSERT INTO acoes_conjuntas (cidade_responsavel_id, objetivo) VALUES (?, ?)',
    [cidade_responsavel_id, objetivo],
    function(err) {
      if (err) return res.status(500).send(err.message);
      const acaoId = this.lastID;
      const stmt = db.prepare(
        'INSERT INTO acoes_conjuntas_participantes (acoes_conjuntas_id, cidade_id) VALUES (?, ?)'
      );
      const list = Array.isArray(participantes) ? participantes : [participantes];
      list.forEach(cid => stmt.run(acaoId, cid));
      stmt.finalize(() => res.redirect('/acoes-conjuntas'));
    }
  );
});

// ─── Detalhes e Nome de Participantes + Mídias ───────────────────────
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const db = req.app.locals.db;

  // 1) Ação Conjunta
  db.get(
    `SELECT ac.*, c.cidade AS cidade_responsavel
       FROM acoes_conjuntas ac
       JOIN cidades c ON ac.cidade_responsavel_id = c.id
      WHERE ac.id = ?`,
    [id],
    (err, acao) => {
      if (err) return res.status(500).send(err.message);
      if (!acao) return res.status(404).send('Ação não encontrada');

      // 2) Participantes com nome
      db.all(
        `SELECT cp.cidade_id, c.cidade
           FROM acoes_conjuntas_participantes cp
           JOIN cidades c ON cp.cidade_id = c.id
          WHERE cp.acoes_conjuntas_id = ?`,
        [id],
        (err2, participantes) => {
          if (err2) return res.status(500).send(err2.message);

          // 3) Ações por cidade + mídias agrupadas
          db.all(
            `SELECT 
               apc.id,
               apc.data_hora,
               apc.responsavel,
               apc.descricao,
               apc.qualificacao_tipo,
               apc.q_nome,
               apc.q_cpf,
               apc.q_endereco,
               apc.q_telefone,
               apc.q_descricao,
               c.cidade AS cidade_participante,
               group_concat(apca.arquivo) AS arquivos,
               group_concat(apca.tipo)    AS tipos
             FROM acao_por_cidade apc
             JOIN cidades c ON apc.cidade_id = c.id
             LEFT JOIN acao_por_cidade_arquivos apca
               ON apc.id = apca.acao_por_cidade_id
            WHERE apc.acoes_conjuntas_id = ?
            GROUP BY apc.id
            ORDER BY apc.data_hora DESC`,
            [id],
            (err3, acoesCidade) => {
              if (err3) return res.status(500).send(err3.message);
              res.render('acoes-conjuntas/show', {
                acao,
                participantes,
                acoesCidade
              });
            }
          );
        }
      );
    }
  );
});


// ─── Formulário Separado: Adicionar Ação por Cidade ─────────
router.get('/:id/adicionar', (req, res) => {
  const acaoId = req.params.id;
  const db = req.app.locals.db;

  db.all(
    `SELECT cp.cidade_id, c.cidade
       FROM acoes_conjuntas_participantes cp
       JOIN cidades c ON cp.cidade_id = c.id
      WHERE cp.acoes_conjuntas_id = ?`,
    [acaoId],
    (err, cidades) => {
      if (err) return res.status(500).send(err.message);
      if (!cidades.length) return res.redirect(`/acoes-conjuntas/${acaoId}`);
      res.render('acoes-conjuntas/adicionar', { acaoId, cidades });
    }
  );
});

// ─── Formulário de edição de Ação Conjunta ──────────────────────────
router.get('/:id/edit', (req, res) => {
  const acaoId = req.params.id;
  const db = req.app.locals.db;

  // 1) Busca a ação
  db.get(
    'SELECT * FROM acoes_conjuntas WHERE id = ?',
    [acaoId],
    (err, acao) => {
      if (err) return res.status(500).send(err.message);
      if (!acao) return res.status(404).send('Ação não encontrada');
      
      // 2) Busca participantes atuais
      db.all(
        'SELECT cidade_id FROM acoes_conjuntas_participantes WHERE acoes_conjuntas_id = ?',
        [acaoId],
        (err2, parts) => {
          if (err2) return res.status(500).send(err2.message);
          const participantes = parts.map(p => p.cidade_id);
          
          // 3) Busca lista de cidades (para o select e checkboxes)
          db.all('SELECT id, cidade FROM cidades', [], (err3, cidades) => {
            if (err3) return res.status(500).send(err3.message);
            // 4) Renderiza
            res.render('acoes-conjuntas/edit', {
              acao,
              cidades,
              participantes
            });
          });
        }
      );
    }
  );
});

// ─── Processa edição de Ação Conjunta ─────────────────────────────
router.post('/:id/edit', (req, res) => {
  const acaoId = req.params.id;
  const { cidade_responsavel_id, objetivo, participantes } = req.body;
  const db = req.app.locals.db;

  db.serialize(() => {
    // 1) Atualiza os dados principais
    db.run(
      'UPDATE acoes_conjuntas SET cidade_responsavel_id = ?, objetivo = ? WHERE id = ?',
      [cidade_responsavel_id, objetivo, acaoId],
      err => {
        if (err) return res.status(500).send(err.message);

        // 2) Limpa participantes antigos
        db.run(
          'DELETE FROM acoes_conjuntas_participantes WHERE acoes_conjuntas_id = ?',
          [acaoId],
          err2 => {
            if (err2) return res.status(500).send(err2.message);

            // 3) Insere os novos
            const stmt = db.prepare(
              'INSERT INTO acoes_conjuntas_participantes (acoes_conjuntas_id, cidade_id) VALUES (?, ?)'
            );
            const list = Array.isArray(participantes)
              ? participantes
              : [participantes];
            list.forEach(cid => stmt.run(acaoId, cid));
            stmt.finalize(() => res.redirect(`/acoes-conjuntas/${acaoId}`));
          }
        );
      }
    );
  });
});

// ─── Formulário de edição de Ação por Cidade ───────────────────────
router.get('/:acaoId/acao-por-cidade/:porCidadeId/editar', (req, res) => {
  const { acaoId, porCidadeId } = req.params;
  const db = req.app.locals.db;

  db.get(
    `SELECT apc.*, c.cidade AS cidade_participante
       FROM acao_por_cidade apc
       JOIN cidades c ON apc.cidade_id = c.id
      WHERE apc.id = ?`,
    [porCidadeId],
    (err, record) => {
      if (err) return res.status(500).send(err.message);
      if (!record) return res.status(404).send('Ação por cidade não encontrada');
      res.render('acoes-conjuntas/editPorCidade', { acaoId, record });
    }
  );
});

// ─── Processar atualização de Ação por Cidade ────────────────────
router.post(
  '/:acaoId/acao-por-cidade/:porCidadeId/editar',
  upload.array('arquivos'),
  (req, res) => {
    const { acaoId, porCidadeId } = req.params;
    const {
      data_hora,
      responsavel,
      descricao,
      qualificacao_tipo,
      q_nome,
      q_cpf,
      q_endereco,
      q_telefone,
      q_descricao
    } = req.body;
    const db = req.app.locals.db;

    // Atualiza campos textuais
    db.run(
      `UPDATE acao_por_cidade
          SET data_hora         = ?,
              responsavel       = ?,
              descricao         = ?,
              qualificacao_tipo = ?,
              q_nome            = ?,
              q_cpf             = ?,
              q_endereco        = ?,
              q_telefone        = ?,
              q_descricao       = ?
        WHERE id = ?`,
      [
        data_hora,
        responsavel,
        descricao,
        qualificacao_tipo,
        q_nome,
        q_cpf,
        q_endereco,
        q_telefone,
        q_descricao,
        porCidadeId
      ],
      err => {
        if (err) return res.status(500).send(err.message);

        // Insere novos arquivos, se houver
        req.files.forEach(file => {
          const tipo = file.mimetype.startsWith('video/') ? 'video' : 'audio';
          db.run(
            `INSERT INTO acao_por_cidade_arquivos
               (acao_por_cidade_id, arquivo, tipo)
             VALUES (?, ?, ?)`,
            [porCidadeId, file.filename, tipo]
          );
        });

        res.redirect(`/acoes-conjuntas/${acaoId}`);
      }
    );
  }
);

// ─── Visualizar Ação por Cidade (somente leitura) ─────────────────────
router.get('/:acaoId/acao-por-cidade/:porCidadeId', (req, res) => {
  const { acaoId, porCidadeId } = req.params;
  const db = req.app.locals.db;

  db.get(
    `SELECT 
       apc.*,
       c.cidade   AS cidade_participante,
       group_concat(apca.arquivo) AS arquivos,
       group_concat(apca.tipo)    AS tipos
     FROM acao_por_cidade apc
     JOIN cidades c 
       ON apc.cidade_id = c.id
     LEFT JOIN acao_por_cidade_arquivos apca
       ON apc.id = apca.acao_por_cidade_id
     WHERE apc.id = ?
     GROUP BY apc.id`,
    [porCidadeId],
    (err, record) => {
      if (err) return res.status(500).send(err.message);
      if (!record) return res.status(404).send('Ação por cidade não encontrada');
      // explode os media em arrays
      record.arquivos = record.arquivos ? record.arquivos.split(',') : [];
      record.tipos    = record.tipos    ? record.tipos.split(',')    : [];
      res.render('acoes-conjuntas/detailPorCidade', {
        acaoId,
        record
      });
    }
  );
});



module.exports = router;
