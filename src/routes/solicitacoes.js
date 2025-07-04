const express = require('express');
const router = express.Router();

// ROTA: Usuário externo cria solicitação
router.get('/externo/nova', (req, res) => {
  const cidadeId = req.session.usuario_externo?.cidade_id;
  if (!cidadeId) return res.status(403).send('Acesso negado');
  res.render('solicitacoes/novaSolicitacao', { erro: null });
});

router.post('/externo/nova', (req, res) => {
  const cidadeId = req.session.usuario_externo?.cidade_id;
  const usuarioId = req.session.usuario_externo?.id;
  const { titulo, descricao } = req.body;

  if (!cidadeId || !usuarioId) return res.status(403).send('Acesso negado');

  req.app.locals.db.run(`
    INSERT INTO solicitacoes (cidade_id, usuario_externo_id, titulo, descricao)
    VALUES (?, ?, ?, ?)`,
    [cidadeId, usuarioId, titulo, descricao],
    (err) => {
      if (err) return res.status(500).send('Erro ao registrar solicitação');
      res.redirect('/externo/solicitacoes');
    }
  );
});

// ROTA: Usuário externo vê suas solicitações
router.get('/externo/solicitacoes', (req, res) => {
  const usuarioId = req.session.usuario_externo?.id;
  if (!usuarioId) return res.status(403).send('Acesso negado');

  req.app.locals.db.all(`
    SELECT s.*, r.resposta, o.protocolo
    FROM solicitacoes s
    LEFT JOIN solicitacoes_respostas r ON r.solicitacao_id = s.id
    LEFT JOIN ocorrencias o ON o.id = r.ocorrencia_id
    WHERE s.usuario_externo_id = ?
    ORDER BY s.data DESC
  `, [usuarioId], (err, rows) => {
    if (err) return res.status(500).send('Erro ao buscar solicitações');
    res.render('solicitacoes/listaSolicitacoesExterno', { solicitacoes: rows });
  });
});

// ROTA: Sistema principal vê solicitações da cidade
router.get('/solicitacoes-recebidas', (req, res) => {
  const cidadeId = req.session.user?.cidade_id;
  if (!cidadeId) return res.status(403).send('Acesso negado');

  req.app.locals.db.all(`
    SELECT s.*, ue.nome AS nome_externo
    FROM solicitacoes s
    LEFT JOIN usuarios_externos ue ON ue.id = s.usuario_externo_id
    WHERE s.cidade_id = ?
    ORDER BY s.data DESC
  `, [cidadeId], (err, rows) => {
    if (err) return res.status(500).send('Erro ao buscar solicitações');
    res.render('solicitacoes/listaSolicitacoesPrincipal', { solicitacoes: rows });
  });
});

// ROTA: Formulário de resposta
router.get('/solicitacoes/:id/responder', (req, res) => {
  const { id } = req.params;
  req.app.locals.db.all('SELECT id, protocolo FROM ocorrencias WHERE encerrada = 1', [], (err, ocorrencias) => {
    if (err) return res.status(500).send('Erro ao listar ocorrências');

    res.render('solicitacoes/responderSolicitacao', { id, ocorrencias });
  });
});

// ROTA: Envia resposta
router.post('/solicitacoes/:id/responder', (req, res) => {
  const { id } = req.params;
  const { resposta, ocorrencia_id } = req.body;

  req.app.locals.db.run(`
    INSERT INTO solicitacoes_respostas (solicitacao_id, resposta, ocorrencia_id)
    VALUES (?, ?, ?)`,
    [id, resposta, ocorrencia_id || null],
    (err) => {
      if (err) return res.status(500).send('Erro ao salvar resposta');
      res.redirect('/solicitacoes-recebidas');
    }
  );
});

module.exports = router;
