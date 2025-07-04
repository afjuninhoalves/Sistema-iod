const express = require('express');
const multer = require('multer');
const path = require('path');

module.exports = (db) => {
  const router = express.Router();

  // Ativa o body parser para todos os POSTs
  router.use(express.urlencoded({ extended: true }));

  // Configura o Multer para salvar arquivos
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(__dirname, '../../../uploads')),
      filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    })
  });

  // Lista solicitações do usuário externo
  router.get('/', (req, res) => {
    if (!req.session.usuarioExterno) return res.redirect('/externo/login');

    const cidadeId = req.session.usuarioExterno.cidade_id;

    db.all(`
      SELECT * FROM solicitacoes
      WHERE cidade_id = ?
      ORDER BY data_solicitacao DESC
    `, [cidadeId], (err, solicitacoes) => {
      if (err) return res.status(500).send(err.message);
      res.render('acesso-externo/minhasSolicitacoes', { solicitacoes });
    });
  });

  // Formulário de nova solicitação
  router.get('/nova', (req, res) => {
    if (!req.session.usuarioExterno) return res.redirect('/externo/login');
    res.render('acesso-externo/novaSolicitacao', { erro: null });
  });

  // Envio da nova solicitação com anexo
  router.post('/nova', upload.single('anexo'), (req, res) => {
    if (!req.session.usuarioExterno) return res.redirect('/externo/login');

    const { titulo, descricao } = req.body;
    const cidadeId = req.session.usuarioExterno.cidade_id;
    const usuarioExternoId = req.session.usuarioExterno.id;
    const anexo = req.file ? req.file.filename : null;

    if (!titulo || !descricao) {
      return res.render('acesso-externo/novaSolicitacao', {
        erro: 'Todos os campos são obrigatórios.'
      });
    }

    db.run(`
      INSERT INTO solicitacoes (titulo, descricao, cidade_id, usuario_externo_id, anexo)
      VALUES (?, ?, ?, ?, ?)
    `, [titulo, descricao, cidadeId, usuarioExternoId, anexo], (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/externo/solicitacoes');
    });
  });

  return router;
};
