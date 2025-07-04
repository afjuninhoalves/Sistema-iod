const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = (db) => {
  // Tela de login
  router.get('/externo/login', (req, res) => {
    res.render('acesso-externo/login', { erro: null });
  });

  // Processa login
  router.post('/externo/login', (req, res) => {
    const { email, senha } = req.body;

    db.get('SELECT * FROM usuarios_externos WHERE email = ?', [email], async (err, usuario) => {
      if (err) return res.status(500).send('Erro no banco de dados');
      if (!usuario) return res.render('acesso-externo/login', { erro: 'Usuário não encontrado' });

      const senhaConfere = await bcrypt.compare(senha, usuario.senha);
      if (!senhaConfere) return res.render('acesso-externo/login', { erro: 'Senha incorreta' });

      req.session.usuarioExterno = {
        id: usuario.id,
        nome: usuario.nome,
        cidade_id: usuario.cidade_id
      };
      res.redirect('/externo/ocorrencias');
    });
  });

  // Logout
  router.get('/externo/logout', (req, res) => {
    req.session.usuarioExterno = null;
    res.redirect('/externo/login');
  });

  // Cadastro de usuário externo (GET)
  router.get('/externo/cadastro', (req, res) => {
    if (!req.session.user || req.session.user.perfil !== 'admin') {
      return res.status(403).send('Acesso negado');
    }

    db.all('SELECT * FROM cidades ORDER BY cidade', (err, cidades) => {
      if (err) return res.status(500).send('Erro ao buscar cidades');
      res.render('acesso-externo/cadastro', { cidades, erro: null });
    });
  });

  router.get('/externo/ocorrencia/:id/midias', (req, res) => {
  if (!req.session.usuarioExterno) return res.redirect('/externo/login');

  const id = parseInt(req.params.id, 10);

  db.all('SELECT * FROM midias_ocorrencia WHERE ocorrencia_id = ?', [id], (err, midias) => {
    if (err) return res.status(500).send('Erro ao carregar mídias');

    res.render('acesso-externo/midiasOcorrencia', {
      midias,
      ocorrenciaId: id
    });
  });
});




  // Ocorrências liberadas para o órgão do usuário externo
router.get('/externo/ocorrencias', (req, res) => {
  if (!req.session.usuarioExterno) return res.redirect('/externo/login');

  const { cidade_id, id } = req.session.usuarioExterno;

  db.get('SELECT orgao FROM usuarios_externos WHERE id = ?', [id], (err, user) => {
    if (err || !user) return res.status(500).send('Erro ao buscar órgão');

    const orgao = user.orgao;

    db.all(`
      SELECT o.*, c.cidade AS cidade_nome
      FROM ocorrencias o
      INNER JOIN ocorrencias_liberadas ol ON ol.ocorrencia_id = o.id
      LEFT JOIN cidades c ON o.cidade_id = c.id
      WHERE ol.orgao = ? AND o.cidade_id = ?
      ORDER BY o.data_hora_fato DESC
    `, [orgao, cidade_id], (err2, ocorrencias) => {
      if (err2) return res.status(500).send('Erro ao buscar ocorrências');
      res.render('acesso-externo/ocorrencias', { ocorrencias });
    });
  });
});


 // Exibir solicitações com resposta para o usuário externo
  router.get('/externo/minhas-solicitacoes', (req, res) => {
    if (!req.session.usuarioExterno) return res.redirect('/externo/login');

    const cidadeId = req.session.usuarioExterno.cidade_id;
    const usuarioId = req.session.usuarioExterno.id;

    db.all(`
      SELECT s.*, o.protocolo
      FROM solicitacoes s
      LEFT JOIN ocorrencias o ON o.id = s.ocorrencia_id
      WHERE s.usuario_externo_id = ? AND s.cidade_id = ?
      ORDER BY s.data_solicitacao DESC
    `, [usuarioId, cidadeId], (err, solicitacoes) => {
      if (err) return res.status(500).send('Erro ao buscar solicitações');
      res.render('acesso-externo/minhasSolicitacoes', { solicitacoes });
    });
  });

  // Cadastro de usuário externo (POST)
  router.post('/externo/cadastro', (req, res) => {
    if (!req.session.user || req.session.user.perfil !== 'admin') {
      return res.status(403).send('Acesso negado');
    }

    const { cidade_id, nome, cpf, email, senha, funcao, contato, orgao } = req.body;

    bcrypt.hash(senha, 10, (err, hash) => {
      if (err) return res.status(500).send('Erro ao gerar hash de senha');

      db.run(`
        INSERT INTO usuarios_externos (cidade_id, nome, cpf, email, senha, funcao, contato, orgao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cidade_id, nome, cpf, email, hash, funcao, contato, orgao],
        (err2) => {
          if (err2) {
            const msg = err2.message.includes('UNIQUE constraint failed') ? 'E-mail já cadastrado' : 'Erro ao salvar';
            return db.all('SELECT * FROM cidades ORDER BY cidade', (err3, cidades) => {
              if (err3) return res.status(500).send('Erro ao carregar cidades');
              res.render('acesso-externo/cadastro', { cidades, erro: msg });
            });
          }

          res.redirect('/usuarios-externos');
        }
      );
    });
  });

 // Página de detalhes da ocorrência para usuários externos
router.get('/externo/detalhes-ocorrencia/:id', (req, res) => {
  if (!req.session.usuarioExterno) {
    return res.redirect('/externo/login');
  }

  const id = parseInt(req.params.id, 10);

  db.get(`SELECT o.*, c.cidade AS cidade_nome
          FROM ocorrencias o
          LEFT JOIN cidades c ON o.cidade_id = c.id
          WHERE o.id = ?`, [id], (err, ocorrencia) => {
    if (err || !ocorrencia) {
      return res.status(500).send('Erro ao carregar ocorrência');
    }

    // Busca veículos
    db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err2, veiculos) => {
      if (err2) return res.status(500).send('Erro ao buscar veículos');

      // Busca envolvidos
      db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err3, envolvidos) => {
        if (err3) return res.status(500).send('Erro ao buscar envolvidos');

        // Busca complementos
        db.all('SELECT * FROM complementos_ocorrencia WHERE ocorrencia_id = ? ORDER BY data ASC, hora ASC', [id], (err4, complementos) => {
          if (err4) return res.status(500).send('Erro ao buscar complementos');

          res.render('acesso-externo/detalhesOcorrencia', {
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


router.get('/externo/solicitacoes/:id/detalhes', (req, res) => {
  if (!req.session.usuarioExterno) return res.redirect('/externo/login');

  const id = req.params.id;
  const usuarioId = req.session.usuarioExterno.id;

  db.get(`
    SELECT s.*, o.protocolo AS protocolo_ocorrencia, u.nome_completo AS respondeu_nome
    FROM solicitacoes s
    LEFT JOIN ocorrencias o ON o.id = s.ocorrencia_id
    LEFT JOIN usuarios u ON u.id = s.usuario_respondeu_id
    WHERE s.id = ? AND s.usuario_externo_id = ?
  `, [id, usuarioId], (err, solicitacao) => {
    if (err || !solicitacao) return res.status(500).send('Erro ao carregar solicitação');

    res.render('acesso-externo/detalhesSolicitacao', { solicitacao });
  });
});




// Lista de solicitações feitas pelo usuário externo e suas respostas
router.get('/externo/minhas-solicitacoes', (req, res) => {
  if (!req.session.usuarioExterno) return res.redirect('/externo/login');

  const usuarioId = req.session.usuarioExterno.id;

  db.all(`
    SELECT s.id, s.titulo, s.descricao, s.data_criacao,
           r.resposta, r.data_resposta, o.protocolo AS protocolo_ocorrencia
    FROM solicitacoes s
    LEFT JOIN respostas_solicitacao r ON r.solicitacao_id = s.id
    LEFT JOIN ocorrencias o ON r.ocorrencia_id = o.id
    WHERE s.usuario_externo_id = ?
    ORDER BY s.data_criacao DESC
  `, [usuarioId], (err, resultados) => {
    if (err) return res.status(500).send('Erro ao carregar solicitações');
    res.render('acesso-externo/minhasSolicitacoes', { resultados });
  });
});

  return router;
};
