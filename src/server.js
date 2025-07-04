const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const logger = require('./services/logger');
const gerarRelatorio = require('./services/pdfService');
const ocorrenciasRouter = require('./routes/ocorrencias');
const veiculosRouter = require('./routes/veiculos');
const usuariosExternosRouter = require('./routes/usuariosExternos');
const gerarRelatorioExterno = require('./services/pdfServiceExterno');


const app = express();
const PORT = process.env.PORT || 3000;


// 1) Compressão e logs — precisam vir **primeiro**
app.use(compression());
app.use(morgan('combined'));

// 2) Parsers e sessão
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'secretkey', resave: false, saveUninitialized: true }));



// 3) Assets estáticos com cache
app.use(
  '/public',
  express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d', etag: false })
);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 4) Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.enable('view cache');
app.use('/ocorrencias', ocorrenciasRouter);
app.use('/veiculos', veiculosRouter);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'secretkey', resave: false, saveUninitialized: true }));
app.use(
  '/public',
  express.static(
    path.join(__dirname, '..', 'public'),
    { maxAge: '7d', etag: false }
  )
);


// Multer setup for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  })
  ,
  limits: { fieldSize: 20 * 1024 * 1024 } // allow form fields up to 20MB, for base64 annotations
});

// Database and migration
const dbPath = path.join(__dirname, '..', 'db', 'ocorrencias.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, err => {


  db.run(`
  CREATE TABLE IF NOT EXISTS solicitacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    data_solicitacao TEXT DEFAULT CURRENT_TIMESTAMP,
    cidade_id INTEGER NOT NULL,
    usuario_externo_id INTEGER NOT NULL,
    resposta TEXT,
    data_resposta TEXT,
    usuario_respondeu_id INTEGER,
    ocorrencia_id INTEGER,
    status TEXT DEFAULT 'pendente',
    FOREIGN KEY (cidade_id) REFERENCES cidades(id),
    FOREIGN KEY (usuario_externo_id) REFERENCES usuarios_externos(id),
    FOREIGN KEY (usuario_respondeu_id) REFERENCES usuarios(id),
    FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id)
  );
`, err => {
    if (err) console.error("Erro ao criar tabela solicitacoes:", err.message);
  });

  // Verifica se a coluna anexo_resposta já existe, e cria se não existir
  db.all(`PRAGMA table_info(solicitacoes)`, (err, columns) => {
    if (err) return console.error("Erro ao listar colunas:", err.message);

    const colNames = columns.map(col => col.name);
    if (!colNames.includes('anexo_resposta')) {
      db.run(`ALTER TABLE solicitacoes ADD COLUMN anexo_resposta TEXT`, err2 => {
        if (err2) console.error("Erro ao adicionar coluna anexo_resposta:", err2.message);
        else console.log("Coluna anexo_resposta criada com sucesso.");
      });
    }
  });

  // ⬇️ CRIA TABELA DE VEÍCULOS AQUI
  db.run(`
  CREATE TABLE IF NOT EXISTS veiculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocorrencia_id INTEGER,
    marca_modelo TEXT DEFAULT '----',
    cor TEXT DEFAULT '----',
    placa TEXT DEFAULT '----',
    FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id) ON DELETE CASCADE
  );
`, err => {
    if (err) console.error("Erro criando tabela veiculos:", err.message);
  });


  if (err) {
    logger.error('Falha ao abrir banco: ' + err.message);
    return;
  }
  logger.info('Banco carregado em ' + dbPath);

  // Otimizações de I/O e journal via PRAGMA
  db.exec(`
     PRAGMA journal_mode = WAL;
     PRAGMA synchronous = NORMAL;
     PRAGMA temp_store = MEMORY;
   `, err2 => {
    if (err2) logger.error('Erro ao aplicar PRAGMAs: ' + err2.message);
  });
});

app.locals.db = db;

// Outras rotas existentes...
app.use(express.urlencoded({ extended: true }));



const setupPainelRoutes = require('./pdf/painel_rel');
setupPainelRoutes(app, db); // ✅ ativa as rotas do painel




// Create midias_ocorrencia table if not exists
db.run(`CREATE TABLE IF NOT EXISTS midias_ocorrencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocorrencia_id INTEGER,
    filename TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ocorrencia_id) REFERENCES ocorrencias(id)
  );`, err => {
  if (err) console.error("Error creating midias_ocorrencia table", err);
});

// Cria tabela de envolvidos específica
db.run(`
  CREATE TABLE IF NOT EXISTS envolvidos_ocorrencia (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ocorrencia_id INTEGER NOT NULL,
    tipo          TEXT CHECK(tipo IN ('Vítima','Envolvido','Suspeito','Autor')) NOT NULL,
    nome          TEXT DEFAULT '----',
    cpf           TEXT DEFAULT '----',
    telefone      TEXT DEFAULT '----',
    endereco      TEXT DEFAULT '----',
    FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id) ON DELETE CASCADE
  );
`, err => {
  if (err) console.error("Erro criando tabela envolvidos_ocorrencia:", err.message);
});

// Cria tabela de vínculo entre Ação por Cidade e Ocorrências
db.run(`
  CREATE TABLE IF NOT EXISTS acao_cidade_ocorrencia (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    acao_por_cidade_id  INTEGER NOT NULL,
    ocorrencia_id       INTEGER NOT NULL,
    FOREIGN KEY(acao_por_cidade_id) REFERENCES acao_por_cidade(id),
    FOREIGN KEY(ocorrencia_id)      REFERENCES ocorrencias(id)
  );
`, err => {
  if (err) console.error("Erro criando acao_cidade_ocorrencia:", err.message);
});

db.run(`
  CREATE TABLE IF NOT EXISTS fatos_ocorrencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocorrencia_id INTEGER NOT NULL,
    data_hora TEXT NOT NULL,
    local TEXT NOT NULL,
    tipo_local TEXT,
    natureza TEXT,
    descricao TEXT,
    armas TEXT,
    documento TEXT,
    ordem INTEGER DEFAULT 0,
    FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id) ON DELETE CASCADE
  )
`);

// MIGRAÇÃO idempotente: só vincula uma vez cada par
db.run(`
  INSERT OR IGNORE INTO acao_cidade_ocorrencia (acao_por_cidade_id, ocorrencia_id)
    SELECT id, ocorrencia_id
      FROM acao_por_cidade
     WHERE ocorrencia_id IS NOT NULL
`, err => {
  if (err) console.error("Erro migrando vínculos antigos:", err.message);
});


// 1) Deduplica registros antigos
db.run(`
  DELETE FROM acao_cidade_ocorrencia
   WHERE id NOT IN (
     SELECT MIN(id)
       FROM acao_cidade_ocorrencia
      GROUP BY acao_por_cidade_id, ocorrencia_id
   );
`, err => {
  if (err) console.error("Erro deduplicando acao_cidade_ocorrencia:", err.message);
});



// Authentication routes

// Exemplo de endpoint

app.get('/', (req, res) => {
  res.redirect('/login'); // ou '/home' ou qualquer página inicial do sistema
});


app.get('/externo/ocorrencia/:id/pdf', (req, res) => {
  const id = req.params.id;

  db.get(`SELECT o.*, c.cidade AS cidade_nome, c.logo AS cidade_logo, c.corporacao AS corporacao
          FROM ocorrencias o
          LEFT JOIN cidades c ON c.id = o.cidade_id
          WHERE o.id = ?`, [id], (err, ocorrencia) => {
    if (err || !ocorrencia) return res.status(404).send('Ocorrência não encontrada.');

    db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err2, veiculos) => {
      if (err2) return res.status(500).send(err2.message);

      db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err3, envolvidos) => {
        if (err3) return res.status(500).send(err3.message);

        db.all('SELECT * FROM complementos_ocorrencia WHERE ocorrencia_id = ? ORDER BY ordem ASC', [id], (err4, complementos) => {
          if (err4) return res.status(500).send(err4.message);

          const armas = ocorrencia.armas
            ? ocorrencia.armas.split(',').map(a => a.trim()).filter(Boolean)
            : [];

          // 🔴 Corrigindo a chamada para usar o `res` certo como último argumento
          gerarRelatorioExterno(ocorrencia, complementos, null, res, veiculos, envolvidos, armas);
        });
      });
    });
  });
});


app.get('/solicitacoes', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  db.all(`
  SELECT s.*, 
         u.nome AS nome_usuario, 
         c.cidade,
         CASE 
           WHEN s.resposta IS NOT NULL THEN 'respondida'
           ELSE 'pendente'
         END AS status
  FROM solicitacoes s
  LEFT JOIN usuarios_externos u ON u.id = s.usuario_externo_id
  LEFT JOIN cidades c ON c.id = s.cidade_id
  ORDER BY s.id DESC
`, (err, solicitacoes) => {
    if (err) return res.status(500).send('Erro ao buscar solicitações');
    res.render('solicitacoes/listarSolicitacoes', { solicitacoes });
  });
});



// Detalhes da solicitação para o usuário externo
app.get('/solicitacoes/:id/detalhes', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const id = req.params.id;

  db.get(`
    SELECT s.*, u.nome AS nome_usuario, c.cidade, o.protocolo
    FROM solicitacoes s
    LEFT JOIN usuarios_externos u ON u.id = s.usuario_externo_id
    LEFT JOIN cidades c ON c.id = s.cidade_id
    LEFT JOIN ocorrencias o ON o.id = s.ocorrencia_id
    WHERE s.id = ?
  `, [id], (err, solicitacao) => {
    if (err || !solicitacao) return res.status(500).send('Solicitação não encontrada');
    res.render('solicitacoes/detalhesSolicitacao', { solicitacao });
  });
});



app.get('/excluir-usuario-externo/:id', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  const id = req.params.id;

  db.run('DELETE FROM usuarios_externos WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/usuarios-externos');
  });
});

app.get('/cadastro-usuario-externo', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  db.all('SELECT * FROM cidades ORDER BY cidade', (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('usuario/cadastroUsuarioExterno', { cidades, erro: null });
  });
});

app.get('/usuarios-externos', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  db.all(`
    SELECT u.id, u.nome, u.cpf, u.email, u.funcao, u.contato, u.orgao, c.cidade
    FROM usuarios_externos u
    LEFT JOIN cidades c ON c.id = u.cidade_id
    ORDER BY u.nome
  `, (err, usuarios) => {
    if (err) return res.status(500).send(err.message);
    res.render('usuario/usuariosExternos', { usuarios });
  });
});

app.get('/editar-usuario-externo/:id', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  const id = req.params.id;
  db.all('SELECT * FROM cidades ORDER BY cidade', (err, cidades) => {
    if (err) return res.status(500).send(err.message);

    db.get('SELECT * FROM usuarios_externos WHERE id = ?', [id], (err2, usuario) => {
      if (err2 || !usuario) return res.status(500).send(err2?.message || 'Usuário não encontrado');
      res.render('usuario/editarUsuarioExterno', { usuario, cidades });
    });
  });
});
app.post('/usuarios/:id/reiniciar-senha', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  const id = req.params.id;
  const novaSenha = '123Mudar';
  const saltRounds = 10;

  bcrypt.hash(novaSenha, saltRounds, (err, hash) => {
    if (err) return res.status(500).send('Erro ao criptografar senha');

    db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, id], function (err) {
      if (err) return res.status(500).send('Erro ao atualizar senha');
      res.render('usuario/senhaReiniciada', { novaSenha });
    });
  });
});

app.get('/alterar-senha', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('usuario/alterarSenha');
});

app.post('/alterar-senha', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const { senhaAtual, novaSenha, confirmarSenha } = req.body;
  const userId = req.session.user.id;

  db.get('SELECT senha FROM usuarios WHERE id = ?', [userId], (err, row) => {
    if (err || !row) return res.status(500).send('Usuário não encontrado.');

    const bcrypt = require('bcrypt');
    bcrypt.compare(senhaAtual, row.senha, (err, match) => {
      if (err || !match) return res.send('❌ Senha atual incorreta.');

      if (novaSenha !== confirmarSenha) return res.send('❌ Nova senha e confirmação não coincidem.');

      bcrypt.hash(novaSenha, 10, (err, hash) => {
        if (err) return res.status(500).send('Erro ao salvar nova senha.');

        db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, userId], (err) => {
          if (err) return res.status(500).send('Erro ao atualizar senha.');
          res.render('usuario/sucessoSenha');
        });
      });
    });
  });
});


app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'usuario', 'login.html'));
});
app.post('/login', (req, res) => {
  const { cpf, senha } = req.body;
  db.get('SELECT * FROM usuarios WHERE cpf = ?', [cpf], (err, user) => {
    if (err || !user) return res.send('Usuário não encontrado');
    bcrypt.compare(senha, user.senha, (err2, ok) => {
      if (ok) {
        // Agora guardamos também o cargo para imprimir no PDF
        req.session.user = { id: user.id, nome_completo: user.nome_completo, perfil: user.perfil, cargo: user.cargo };
        return res.redirect('/home');
      }
      res.send('Senha incorreta');
    });
  });
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Home
app.get('/home', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('home', { user: req.session.user });
});

// List occurrences
app.get('/ocorrencias', (req, res) => {
  db.all(`
    SELECT *,
      CASE 
        WHEN TRIM(motivo_reabertura) != '' THEN 'Reaberta'
        ELSE 'Nova'
      END as status_ocorrencia
    FROM ocorrencias 
    WHERE encerrada = 0 
    ORDER BY id DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('ocorrencias/ocorrencias', { ocorrencias: rows });
  });
});

// Create occurrence

app.get('/cadastro-ocorrencia', (req, res) => {
  db.all('SELECT * FROM cidades ORDER BY cidade', [], (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('ocorrencias/cadastroOcorrencia', { cidades });
  });
});

app.post('/ocorrencia/:id/liberar', (req, res) => {
  const id = req.params.id;
  const { orgao } = req.body;

  if (!orgao) {
    return res.status(400).send('Órgão não selecionado');
  }

  db.run(`
    INSERT INTO ocorrencias_liberadas (ocorrencia_id, orgao)
    VALUES (?, ?)`,
    [id, orgao],
    (err) => {
      if (err) {
        console.error('Erro ao liberar ocorrência:', err.message);
        return res.status(500).send('Erro ao liberar ocorrência');
      }

      res.redirect('/ocorrencias-encerradas');
    }
  );
});

app.get('/solicitacoes/:id/responder', (req, res) => {
  const solicitacaoId = req.params.id;

  db.get(`
    SELECT s.*, c.cidade AS nome_cidade
    FROM solicitacoes s
    LEFT JOIN cidades c ON c.id = s.cidade_id
    WHERE s.id = ?
  `, [solicitacaoId], (err, solicitacao) => {
    if (err || !solicitacao) return res.status(500).send('Erro ao buscar solicitação');

    db.all(`
  SELECT o.id, o.protocolo, o.natureza, o.data_hora_fato, c.cidade
  FROM ocorrencias o
  LEFT JOIN cidades c ON c.id = o.cidade_id
  WHERE o.encerrada = 1 AND o.cidade_id = ?
  ORDER BY o.data_hora_fato DESC
`, [solicitacao.cidade_id], (err2, ocorrenciasEncerradas) => {
      if (err2) {
        console.error('Erro ao buscar ocorrências:', err2.message);
        return res.status(500).send('Erro ao buscar ocorrências');
      }

      res.render('solicitacoes/responderSolicitacao', {
        solicitacao,
        ocorrenciasEncerradas
      });
    });
  });
});

// POST que salva a resposta da solicitação
app.post(
  '/solicitacoes/:id/responder',
  upload.single('anexo'), // já existe o multer configurado mais acima em server.js
  (req, res) => {
    const solicitacaoId = req.params.id;
    const usuarioRespondeuId = req.session.user && req.session.user.id;
    // (certifique-se que o usuário esteja logado; se for liberar só admins, cheque perfil)
    if (!usuarioRespondeuId) {
      return res.status(403).send('Você precisa estar logado para responder.');
    }

    const { resposta } = req.body;
    // No form, o <select> vem como name="ocorrencias_ids[]" (array de strings).
    // A tabela "solicitacoes" só tem uma coluna `ocorrencia_id` (INTEGER). 
    // Ou seja, se vier mais de uma, tome apenas a primeira:
    let ocorrenciaIdAssociada = null;
    if (Array.isArray(req.body['ocorrencias_ids'])) {
      ocorrenciaIdAssociada = req.body['ocorrencias_ids'][0] || null;
    } else {
      ocorrenciaIdAssociada = req.body['ocorrencias_ids'] || null;
    }

    // Se quiser suportar múltiplas ocorrências, teria que criar uma tabela de vínculo.
    // Aqui vamos assumir somente uma (o primeiro elemento).

    // Se enviaram um arquivo:
    const anexoResposta = req.file ? req.file.filename : null;
    const dataResposta = new Date().toISOString();

    // Atualiza a linha na tabela "solicitacoes"
    db.run(
      `
        UPDATE solicitacoes
        SET 
          resposta = ?, 
          data_resposta = ?, 
          usuario_respondeu_id = ?, 
          ocorrencia_id = ?, 
          anexo_resposta = ?,
          status = 'respondida'
        WHERE id = ?
      `,
      [
        resposta,
        dataResposta,
        usuarioRespondeuId,
        ocorrenciaIdAssociada,
        anexoResposta,
        solicitacaoId
      ],
      (err) => {
        if (err) {
          console.error('Erro ao salvar resposta:', err.message);
          return res.status(500).send('Não foi possível salvar a resposta.');
        }
        // Redireciona para a listagem de solicitações (ou outro lugar desejado):
        res.redirect('/solicitacoes');
      }
    );
  }
);

app.post('/editar-usuario-externo/:id', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  const id = req.params.id;
  const { nome, cpf, email, funcao, contato, orgao, cidade_id, novaSenha } = req.body;

  const atualizar = (hashSenha = null) => {
    const query = hashSenha
      ? `UPDATE usuarios_externos SET nome = ?, cpf = ?, email = ?, funcao = ?, contato = ?, orgao = ?, cidade_id = ?, senha = ? WHERE id = ?`
      : `UPDATE usuarios_externos SET nome = ?, cpf = ?, email = ?, funcao = ?, contato = ?, orgao = ?, cidade_id = ? WHERE id = ?`;

    const params = hashSenha
      ? [nome, cpf, email, funcao, contato, orgao, cidade_id, hashSenha, id]
      : [nome, cpf, email, funcao, contato, orgao, cidade_id, id];

    db.run(query, params, err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/usuarios-externos');
    });
  };

  if (novaSenha && novaSenha.trim() !== '') {
    bcrypt.hash(novaSenha, 10, (err, hash) => {
      if (err) return res.status(500).send('Erro ao criptografar nova senha');
      atualizar(hash);
    });
  } else {
    atualizar();
  }
});


app.post('/cadastro-ocorrencia', upload.single('documento'), (req, res) => {
  const { data_hora_fato, local, tipo_local, natureza, descricao, cidade_id } = req.body;
  const documento = req.file ? req.file.filename : null;

  const veicMarcas = [].concat(req.body['veiculos[][marca_modelo]'] || []);
  const veicCores = [].concat(req.body['veiculos[][cor]'] || []);
  const veicPlacas = [].concat(req.body['veiculos[][placa]'] || []);

  const tipos = [].concat(req.body['envolvidos[][tipo]'] || []);
  const nomes = [].concat(req.body['envolvidos[][nome]'] || []);
  const cpfs = [].concat(req.body['envolvidos[][cpf]'] || []);
  const telefones = [].concat(req.body['envolvidos[][telefone]'] || []);
  const enderecos = [].concat(req.body['envolvidos[][endereco]'] || []);

  const envolvidos = tipos.map((_, i) => ({
    tipo: tipos[i] || '----',
    nome: nomes[i] || '----',
    cpf: cpfs[i] || '----',
    telefone: telefones[i] || '----',
    endereco: enderecos[i] || '----'
  }));

  const armasArr = [].concat(req.body.armas || []);
  const armasStr = armasArr.filter(a => a).join(', ') || '----';

  const now = new Date();
  const prefix = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

  db.get('SELECT COUNT(*) AS count FROM ocorrencias WHERE protocolo LIKE ?', [prefix + '%'], (err, row) => {
    if (err) return res.status(500).send(err.message);

    const seq = (row.count || 0) + 1;
    const protocolo = `${prefix}-${seq.toString().padStart(3, '0')}`;

    db.run(`
      INSERT INTO ocorrencias (
        protocolo, data_hora_fato, local, tipo_local, natureza, descricao,
        veiculos, envolvidos, armas, documento, cidade_id, usuario_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        protocolo,
        data_hora_fato,
        local,
        tipo_local,
        natureza,
        descricao,
        '----', // não mais usado, mas deixado por compatibilidade
        '----',
        armasStr,
        documento,
        cidade_id,
        req.session.user.id,
        'aberto'
      ],
      function (err2) {
        if (err2) return res.status(500).send(err2.message);

        const ocorrId = this.lastID;

        // Inserir veículos
        const stmtV = db.prepare(`INSERT INTO veiculos (ocorrencia_id, marca_modelo, cor, placa) VALUES (?, ?, ?, ?)`);
        for (let i = 0; i < veicMarcas.length; i++) {
          stmtV.run(
            ocorrId,
            veicMarcas[i] || '----',
            veicCores[i] || '----',
            veicPlacas[i] || '----'
          );
        }
        stmtV.finalize(err3 => {
          if (err3) return res.status(500).send(err3.message);

          // Inserir envolvidos
          const stmtE = db.prepare(`
            INSERT INTO envolvidos_ocorrencia
              (ocorrencia_id, tipo, nome, cpf, telefone, endereco)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          envolvidos.forEach(ev => {
            stmtE.run(
              ocorrId,
              ev.tipo,
              ev.nome,
              ev.cpf,
              ev.telefone,
              ev.endereco
            );
          });
          stmtE.finalize(err4 => {
            if (err4) return res.status(500).send(err4.message);
            res.redirect('/ocorrencias');
          });
        });
      }
    );
  });
});

app.post('/cadastro-usuario-externo', (req, res) => {
  if (!req.session.user || req.session.user.perfil !== 'admin') {
    return res.status(403).send('Acesso negado');
  }

  const { cidade_id, nome, cpf, email, senha, funcao, contato, orgao } = req.body;

  bcrypt.hash(senha, 10, (err, hash) => {
    if (err) return res.status(500).send('Erro ao criptografar senha');

    db.run(`
      INSERT INTO usuarios_externos (cidade_id, nome, cpf, email, senha, funcao, contato, orgao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cidade_id, nome, cpf, email, hash, funcao, contato, orgao],
      (err2) => {
        if (err2) {
          const msg = err2.message.includes('UNIQUE constraint failed') ? 'E-mail já cadastrado' : 'Erro ao salvar';
          return res.render('usuario/cadastroUsuarioExterno', { cidades: [], erro: msg });
        }

        res.redirect('/usuarios');
      }
    );
  });
});

// Edit occurrence (POST)
app.post('/ocorrencia/:id/editar', upload.single('documento'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { data_hora_fato, local, tipo_local, natureza, descricao, cidade_id } = req.body;
  const documento = req.file ? req.file.filename : req.body.oldDocumento;

  // normaliza arrays de veículos vindos do form
  const veicMarcas = [].concat(req.body['veiculos[][marca_modelo]'] || []);
  const veicCores = [].concat(req.body['veiculos[][cor]'] || []);
  const veicPlacas = [].concat(req.body['veiculos[][placa]'] || []);
  // normaliza arrays de envolvidos (objetos { tipo, nome, cpf, ... })
  const tipos = [].concat(req.body['envolvidos[][tipo]'] || []);
  const nomes = [].concat(req.body['envolvidos[][nome]'] || []);
  const cpfs = [].concat(req.body['envolvidos[][cpf]'] || []);
  const telefones = [].concat(req.body['envolvidos[][telefone]'] || []);
  const enderecos = [].concat(req.body['envolvidos[][endereco]'] || []);

  const enviados = tipos.map((_, i) => ({
    tipo: tipos[i] || '----',
    nome: nomes[i] || '----',
    cpf: cpfs[i] || '----',
    telefone: telefones[i] || '----',
    endereco: enderecos[i] || '----'
  }));
  db.serialize(() => {
    // 1) Atualiza a ocorrência
    db.run(
      `UPDATE ocorrencias
         SET data_hora_fato = ?, local = ?, tipo_local = ?, natureza = ?,
             descricao = ?, cidade_id = ?, documento = ?
       WHERE id = ?`,
      [data_hora_fato, local, tipo_local, natureza, descricao, cidade_id, documento, id],
      err => {
        if (err) return res.status(500).send(err.message);

        // 2) Limpa e insere veículos
        db.run('DELETE FROM veiculos WHERE ocorrencia_id = ?', [id], err2 => {
          if (err2) return res.status(500).send(err2.message);

          const stmtV = db.prepare(
            'INSERT INTO veiculos (ocorrencia_id, marca_modelo, cor, placa) VALUES (?, ?, ?, ?)'
          );
          for (let i = 0; i < veicMarcas.length; i++) {
            stmtV.run(
              id,
              veicMarcas[i] || '----',
              veicCores[i] || '----',
              veicPlacas[i] || '----'
            );
          }
          stmtV.finalize(err3 => {
            if (err3) return res.status(500).send(err3.message);

            // 3) Limpa e insere envolvidos
            db.run(
              'DELETE FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?',
              [id],
              err4 => {
                if (err4) return res.status(500).send(err4.message);

                const stmtE = db.prepare(`
                  INSERT INTO envolvidos_ocorrencia
                    (ocorrencia_id, tipo, nome, cpf, telefone, endereco)
                  VALUES (?, ?, ?, ?, ?, ?)
                `);
                enviados.forEach(ev => {
                  stmtE.run(
                    id,
                    ev.tipo || '----',
                    ev.nome || '----',
                    ev.cpf || '----',
                    ev.telefone || '----',
                    ev.endereco || '----'
                  );
                });
                stmtE.finalize(err5 => {
                  if (err5) return res.status(500).send(err5.message);
                  // 4) Só aqui, depois de tudo, redireciona
                  res.redirect(`/detalhes-ocorrencia/${id}`);
                });
              }
            );
          });
        });
      }
    );
  });
});


// Start server

// GET: Tela de edição da ocorrência
app.get('/ocorrencia/:id/editar', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT * FROM cidades ORDER BY cidade', [], (err, cidades) => {
    if (err) return res.status(500).send(err.message);

    db.get('SELECT * FROM ocorrencias WHERE id = ?', [id], (err2, ocorrencia) => {
      if (err2 || !ocorrencia) return res.status(500).send(err2 ? err2.message : 'Não encontrado');

      // busca veículos
      db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err3, veiculos) => {
        if (err3) return res.status(500).send(err3.message);

        // busca envolvidos
        db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err4, envolvidos) => {
          if (err4) return res.status(500).send(err4.message);

          res.render('ocorrencias/editarOcorrencia', {
            ocorrencia,
            cidades,
            veiculos,
            envolvidos
          });
        });
      });
    });
  });
});


// Rotas visuais: cidades
app.get('/cadastro-cidade', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all('SELECT * FROM cidades', (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('cidade/cadastroCidade', { cidades });
  });
});
app.post('/cadastro-cidade', upload.single('logo'), (req, res) => {
  const { cidade, corporacao, comandante, telefone_contato, telefone_inteligencia } = req.body;
  const logo = req.file ? req.file.filename : null;
  db.run("INSERT INTO cidades (cidade, logo, corporacao, comandante, telefone_contato, telefone_inteligencia) VALUES (?, ?, ?, ?, ?, ?)",
    [cidade, logo, corporacao, comandante, telefone_contato, telefone_inteligencia], err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/cadastro-cidade');
    });
});
app.get('/cidades', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all('SELECT * FROM cidades', (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('cidade/cidades', { cidades });
  });
});

// Rota para exibir formulário de edição de cidade
app.get('/editar-cidade/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const id = req.params.id;
  db.get('SELECT * FROM cidades WHERE id = ?', [id], (err, city) => {
    if (err) return res.status(500).send(err.message);
    if (!city) return res.status(404).send('Cidade não encontrada');
    res.render('cidade/editarCidade', { city });
  });
});

// Rota para processar a atualização da cidade
app.post('/editar-cidade/:id', upload.single('logo'), (req, res) => {
  const id = req.params.id;
  const {
    cidade,
    corporacao,
    comandante,
    telefone_contato,
    telefone_inteligencia,
    currentLogo
  } = req.body;

  const logo = req.file ? req.file.filename : currentLogo;

  db.run(
    `UPDATE cidades
       SET cidade             = ?,
           logo               = ?,
           corporacao         = ?,
           comandante         = ?,
           telefone_contato   = ?,
           telefone_inteligencia = ?
     WHERE id = ?`,
    [cidade, logo, corporacao, comandante, telefone_contato, telefone_inteligencia, id],
    err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/cidades');
    }
  );
});


// Se o usuário não enviar um novo arquivo, mantemos o logo antigo


// Rotas visuais: usuários
app.get('/cadastro-usuario', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all('SELECT * FROM cidades', (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    res.render('usuario/cadastroUsuario', { cidades });
  });
});
app.post('/cadastro-usuario', (req, res) => {
  const { nome_completo, cargo, cidade_id, cpf, telefone, senha, perfil } = req.body;
  bcrypt.hash(senha, 10, (err, hash) => {
    db.run("INSERT INTO usuarios (nome_completo, cargo, cidade_id, cpf, telefone, senha, perfil) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [nome_completo, cargo, cidade_id, cpf, telefone, hash, perfil], err => {
        if (err) return res.status(500).send(err.message);
        res.redirect('/usuarios');
      });
  });
});
app.get('/usuarios', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  db.all('SELECT u.id, u.nome_completo, u.cargo, u.cpf, u.telefone, u.perfil, c.cidade FROM usuarios u JOIN cidades c ON u.cidade_id = c.id', (err, usuarios) => {
    if (err) return res.status(500).send(err.message);
    res.render('usuario/usuarios', {
      usuarios,
      session: req.session  // <-- ADICIONE ISTO
    });
  });
});

// Relatórios
app.get('/relatorios', (req, res) => {
  const { protocolo, data_from, data_to, local, tipo_local, natureza } = req.query;
  let filters = [], params = [];
  if (protocolo) { filters.push('protocolo   LIKE ?'); params.push(`%${protocolo}%`); }
  if (data_from) { filters.push('date(data_hora_fato) >= date(?)'); params.push(data_from); }
  if (data_to) { filters.push('date(data_hora_fato) <= date(?)'); params.push(data_to); }
  if (local) { filters.push('local       LIKE ?'); params.push(`%${local}%`); }
  if (tipo_local) { filters.push('tipo_local  LIKE ?'); params.push(`%${tipo_local}%`); }
  if (natureza) { filters.push('natureza    LIKE ?'); params.push(`%${natureza}%`); }
  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  db.get(`SELECT SUM(CASE WHEN encerrada=0 THEN 1 ELSE 0 END) AS abertas, SUM(CASE WHEN encerrada=1 THEN 1 ELSE 0 END) AS encerradas, SUM(CASE WHEN motivo_reabertura IS NOT NULL THEN 1 ELSE 0 END) AS reabertas FROM ocorrencias ${where}`, params, (err, stats) => {
    if (err) return res.status(500).send(err.message);
    db.all(`SELECT c.cidade AS label, COUNT(*) AS count
        FROM ocorrencias o
        LEFT JOIN cidades c ON c.id = o.cidade_id
        ${where}
        GROUP BY c.cidade
        ORDER BY count DESC
        LIMIT 5`, params, (err2, cities) => {
      if (err2) return res.status(500).send(err2.message);
      db.all(`SELECT natureza AS label, COUNT(*) AS count FROM ocorrencias ${where} GROUP BY natureza ORDER BY count DESC LIMIT 5`, params, (err3, nats) => {
        if (err3) return res.status(500).send(err3.message);
        db.all(`SELECT strftime('%Y-%m', data_hora_fato) AS label, COUNT(*) AS count FROM ocorrencias ${where} GROUP BY label ORDER BY label`, params, (err4, periods) => {
          if (err4) return res.status(500).send(err4.message);
          res.render('relatorios/relatorios', { stats, cities, naturezas: nats, periods, filters: req.query });
        });
      });
    });
  });
});

// Lista de ocorrências encerradas
app.get('/ocorrencias-encerradas', (req, res) => {
  const query = `
    SELECT o.*, GROUP_CONCAT(ol.orgao, ', ') AS orgaos_liberados
    FROM ocorrencias o
    LEFT JOIN ocorrencias_liberadas ol ON o.id = ol.ocorrencia_id
    WHERE o.encerrada = 1
    GROUP BY o.id
    ORDER BY o.id DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('ocorrencias_encerradas/ocorrencias', { ocorrencias: rows });
  });
});


app.get('/editar-usuario/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const id = req.params.id;

  // 1) lista cidades para o <select>
  db.all('SELECT id, cidade FROM cidades', (err, cidades) => {
    if (err) return res.status(500).send(err.message);

    // 2) busca o usuário, só com colunas que existem de verdade
    db.get(
      `SELECT 
         id,
         nome_completo,
         cargo,
         cidade_id,
         cpf,
         telefone,
         perfil
       FROM usuarios
       WHERE id = ?`,
      [id],
      (err, usuario) => {
        if (err) return res.status(500).send(err.message);
        if (!usuario) return res.status(404).send('Usuário não encontrado');

        // 3) garante que nome_completo nunca esteja nulo
        usuario.nome_completo = usuario.nome_completo || '';

        // 4) renderiza o form
        res.render('usuario/editarUsuario', { usuario, cidades });
      }
    );
  });
});

// Processa o envio do formulário
app.post('/editar-usuario/:id', (req, res) => {
  const id = req.params.id;
  const {
    nome_completo,
    cargo,
    cidade_id,
    cpf,
    telefone,
    perfil
  } = req.body;

  db.run(
    `UPDATE usuarios
       SET nome_completo = ?,
           cargo         = ?,
           cidade_id     = ?,
           cpf           = ?,
           telefone      = ?,
           perfil        = ?
     WHERE id = ?`,
    [
      nome_completo,
      cargo,
      cidade_id,
      cpf,
      telefone,
      perfil,
      id
    ],
    err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/usuarios');
    }
  );
});


// Excluir Complemento
app.get('/ocorrencia/:ocorrenciaId/complemento/:id/excluir', (req, res) => {
  const compId = req.params.id;
  const ocorrId = req.params.ocorrenciaId;
  db.run('DELETE FROM complementos_ocorrencia WHERE id = ?', [compId], err => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/detalhes-ocorrencia/' + ocorrId);
  });
});

// GET formulário de Complemento (Adicionar)
app.get('/ocorrencia/:ocorrenciaId/complemento', (req, res) => {
  const ocorrenciaId = req.params.ocorrenciaId;
  db.get('SELECT * FROM ocorrencias WHERE id = ?', [ocorrenciaId], (err, ocorrencia) => {
    if (err || !ocorrencia) return res.status(404).send('Ocorrência não encontrada.');
    res.render('ocorrencias/formComplemento', { complemento: null, ocorrenciaId });
  });
});
// Inserir Complemento (POST)
app.post('/ocorrencia/:ocorrenciaId/complemento', upload.single('arquivo'), (req, res) => {
  const id = req.params.ocorrenciaId;
  const { descricao, data, hora, local, imagemAnotada } = req.body;
  let arquivo = null;

  // 1) Se colou algo no canvas, decode e salve o Base64 como PNG
  if (imagemAnotada) {
    const matches = imagemAnotada.match(/^data:image\/png;base64,(.+)$/);
    if (matches) {
      const base64Data = matches[1];
      const filename = `complemento_${Date.now()}.png`;
      const dest = path.join(__dirname, '..', 'uploads', filename);
      fs.writeFileSync(dest, base64Data, 'base64');
      arquivo = filename;
    }
  }
  // 2) Senão, se escolheu arquivo pelo <input>, use o Multer
  else if (req.file) {
    arquivo = req.file.filename;
  }

  db.run(
    `INSERT INTO complementos_ocorrencia (descricao, data, hora, local, arquivo, ocorrencia_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [descricao, data, hora, local, arquivo, id],
    err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/detalhes-ocorrencia/' + id);
    }
  );
});


// GET Formulário de Complemento (Editar)
app.get('/ocorrencia/:ocorrenciaId/complemento', (req, res) => {
  const ocorrenciaId = req.params.ocorrenciaId;
  db.get('SELECT * FROM ocorrencias WHERE id = ?', [ocorrenciaId], (err, ocorrencia) => {
    if (err || !ocorrencia) return res.status(404).send('Ocorrência não encontrada.');
    if (ocorrencia.encerrada) {
      return res.status(403).send('Ocorrência encerrada. Não é possível adicionar informações complementares.');
    }
    res.render('ocorrencias/formComplemento', { complemento: null, ocorrenciaId });
  });
});

// Atualizar Complemento (POST)
app.post('/ocorrencia/:ocorrenciaId/complemento/:id/editar', upload.single('arquivo'), (req, res) => {
  const { ocorrenciaId, id } = req.params;
  const { descricao, data, hora, local, oldArquivo, imagemAnotada } = req.body;
  let arquivo = oldArquivo;
  if (imagemAnotada) {
    const matches = imagemAnotada.match(/^data:image\/png;base64,(.+)$/);
    if (matches) {
      const base64Data = matches[1];
      const filename = `complemento_${Date.now()}.png`;
      const dest = path.join(__dirname, '..', 'uploads', filename);
      fs.writeFileSync(dest, base64Data, 'base64');
      arquivo = filename;
    }
  } else if (req.file) {
    arquivo = req.file.filename;
  }
  db.run(
    'UPDATE complementos_ocorrencia SET descricao = ?, data = ?, hora = ?, local = ?, arquivo = ? WHERE id = ?',
    [descricao, data, hora, local, arquivo, id],
    err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/detalhes-ocorrencia/' + ocorrenciaId);
    }
  );
});


// Media routes
const uploadMedia = multer({ dest: path.join(__dirname, '../uploads') });
app.get('/ocorrencia/:ocorrenciaId/midias', (req, res) => {
  const { ocorrenciaId } = req.params;
  db.all('SELECT * FROM midias_ocorrencia WHERE ocorrencia_id = ?', [ocorrenciaId], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('ocorrencias/midias', { ocorrenciaId, midias: rows });
  });
});
app.post('/ocorrencia/:ocorrenciaId/midias', uploadMedia.array('midias', 10), (req, res) => {
  const { ocorrenciaId } = req.params;
  const stmt = db.prepare('INSERT INTO midias_ocorrencia (ocorrencia_id, filename, type) VALUES (?, ?, ?)');
  req.files.forEach(file => {
    const type = file.mimetype.startsWith('video') ? 'video' : 'audio';
    stmt.run(ocorrenciaId, file.filename, type);
  });
  stmt.finalize();
  res.redirect(`/ocorrencia/${ocorrenciaId}/midias`);
});

app.use('/acoes-conjuntas', (req, res, next) => {
  console.log(`→ Chegou em /acoes-conjuntas: ${req.method} ${req.originalUrl}`);
  next();
});

const acoesConjuntasRoutes = require('./routes/acoesConjuntas');
app.use('/acoes-conjuntas', acoesConjuntasRoutes);

// ← error‐handler vem logo abaixo
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Ocorreu um erro interno. Veja o console do servidor.');
});





app.get('/ocorrencia/:id/reabrir', (req, res) => {
  const id = req.params.id;
  res.render('ocorrencia/reabrir', { id });
});

app.post('/ocorrencia/:id/reabrir', (req, res) => {
  const id = req.params.id;
  const motivo = req.body.motivo_reabertura;

  db.run(`UPDATE ocorrencias SET encerrada = 0, motivo_reabertura = ? WHERE id = ?`, [motivo, id], (err) => {
    if (err) return res.status(500).send('Erro ao reabrir ocorrência');

    // REMOVE A LIBERAÇÃO PARA ÓRGÃOS EXTERNOS
    db.run(`DELETE FROM ocorrencias_liberadas WHERE ocorrencia_id = ?`, [id], (err2) => {
      if (err2) return res.status(500).send('Erro ao remover liberação externa');

      res.redirect('/ocorrencias-encerradas');
    });
  });
});


app.get('/ocorrencia/:id/encerrar', (req, res) => {
  const id = req.params.id;
  res.render('ocorrencia/encerrar', { id });
});

app.post('/ocorrencia/:id/encerrar', (req, res) => {
  const id = req.params.id;
  const { motivo_encerramento } = req.body;

  db.run('UPDATE ocorrencias SET encerrada = 1, motivo_encerramento = ? WHERE id = ?',
    [motivo_encerramento, id],
    function (err) {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Erro ao encerrar a ocorrência.');
      }
      res.redirect('/ocorrencias');
    }
  );
});

const async = require('async'); // certifique-se que o pacote está instalado (npm install async)

app.get('/detalhes-ocorrencia/:id', (req, res) => {
  const id = req.params.id;

  db.get(`
    SELECT o.*, c.cidade AS cidade_nome, c.logo AS cidade_logo
    FROM ocorrencias o
    LEFT JOIN cidades c ON c.id = o.cidade_id
    WHERE o.id = ?
  `, [id], (err, ocorrencia) => {
    if (err) return res.status(500).send('Erro ao buscar ocorrência.');
    if (!ocorrencia) return res.status(404).send('Ocorrência não encontrada.');

    db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err2, veiculos) => {
      if (err2) return res.status(500).send('Erro ao buscar veículos.');

      db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err3, envolvidos) => {
        if (err3) return res.status(500).send('Erro ao buscar envolvidos.');

        db.all(`
             SELECT co.*, c.cidade AS cidade_nome
            FROM complementos_ocorrencia co
              LEFT JOIN cidades c ON c.id = co.cidade_id
           WHERE co.ocorrencia_id = ?
             ORDER BY co.ordem ASC
            `, [id], (err4, complementos) => {
          if (err4) return res.status(500).send('Erro ao buscar complementos.');

          // 🔽 Se houver fatos, carregamos seus veículos e envolvidos específicos
          const carregarDadosFato = (comp, callback) => {
            if (comp.tipo !== 'fato') return callback(); // pula se não for fato

            db.all('SELECT * FROM veiculos_fato WHERE fato_id = ?', [comp.id], (errV, veiculosFato) => {
              if (errV) return callback(errV);
              comp.veiculosFato = veiculosFato;

              db.all('SELECT * FROM envolvidos_fato WHERE fato_id = ?', [comp.id], (errE, envolvidosFato) => {
                if (errE) return callback(errE);
                comp.envolvidosFato = envolvidosFato;

                callback();
              });
            });
          };



          async.eachSeries(complementos, carregarDadosFato, (errFinal) => {
            if (errFinal) return res.status(500).send('Erro ao carregar dados dos fatos.');

            // ✅ Tudo carregado, renderiza
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
});


app.get('/pesquisa', (req, res) => {
  const { termo } = req.query;

  if (!termo) {
    return res.render('ocorrencias/pesquisa', { resultados: [], termo: '' });
  }

  const likeTerm = `%${termo}%`;
  const query = `
    SELECT DISTINCT o.*
    FROM ocorrencias o
    LEFT JOIN veiculos v ON v.ocorrencia_id = o.id
    LEFT JOIN envolvidos_ocorrencia e ON e.ocorrencia_id = o.id
    WHERE
      o.protocolo LIKE ?
      OR o.local LIKE ?
      OR o.tipo_local LIKE ?
      OR o.natureza LIKE ?
      OR o.descricao LIKE ?
      OR o.veiculos LIKE ?
      OR o.armas LIKE ?
      OR v.marca_modelo LIKE ?
      OR v.cor LIKE ?
      OR v.placa LIKE ?
      OR e.nome LIKE ?
      OR e.cpf LIKE ?
      OR e.telefone LIKE ?
      OR e.endereco LIKE ?
  `;
  const params = Array(14).fill(likeTerm);

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('ocorrencias/pesquisa', { resultados: rows, termo });
  });
});

app.get('/painel', (req, res) => {
  let { cidade_id, data_de, data_ate, natureza, status, tipo_local, tipo_envolvido } = req.query;
  const params = [];
  const filtros = [];

  // Se nenhum data_de/data_ate for passado, ajusta para início e fim do mês atual
  if (!data_de && !data_ate) {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    data_de = primeiroDiaMes.toISOString().slice(0, 10);
    data_ate = ultimoDiaMes.toISOString().slice(0, 10);
  }

  if (cidade_id) filtros.push('o.cidade_id = ?'), params.push(cidade_id);
  if (data_de) filtros.push('date(o.data_hora_fato) >= date(?)'), params.push(data_de);
  if (data_ate) filtros.push('date(o.data_hora_fato) <= date(?)'), params.push(data_ate);
  if (natureza) filtros.push('o.natureza LIKE ?'), params.push(`%${natureza}%`);
  if (status === 'abertas') filtros.push('o.encerrada = 0');
  else if (status === 'encerradas') filtros.push('o.encerrada = 1');
  else if (status === 'reabertas') filtros.push('o.motivo_reabertura IS NOT NULL');
  if (tipo_local) filtros.push('o.tipo_local LIKE ?'), params.push(`%${tipo_local}%`);
  if (tipo_envolvido) {
    filtros.push(`EXISTS (
      SELECT 1 FROM envolvidos_ocorrencia eo
      WHERE eo.ocorrencia_id = o.id AND eo.tipo = ?
    )`);
    params.push(tipo_envolvido);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const dados = {};

  db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN encerrada = 0 THEN 1 ELSE 0 END) as abertas,
      SUM(CASE WHEN encerrada = 1 THEN 1 ELSE 0 END) as encerradas,
      SUM(CASE WHEN motivo_reabertura IS NOT NULL THEN 1 ELSE 0 END) as reabertas
    FROM ocorrencias o ${where}
  `, params, (err, stats) => {
    if (err) return res.status(500).send("Erro ao buscar estatísticas gerais");
    dados.stats = stats;

    // Tendência
    const now = new Date();
    const anoMesAtual = now.toISOString().slice(0, 7);
    const mesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const anoMesAnterior = mesAnterior.toISOString().slice(0, 7);

    db.all(`
      SELECT 
        strftime('%Y-%m', data_hora_fato) AS mes,
        SUM(CASE WHEN encerrada = 0 THEN 1 ELSE 0 END) AS abertas,
        SUM(CASE WHEN encerrada = 1 THEN 1 ELSE 0 END) AS encerradas,
        SUM(CASE WHEN motivo_reabertura IS NOT NULL THEN 1 ELSE 0 END) AS reabertas,
        COUNT(*) AS total
      FROM ocorrencias
      WHERE mes IN (?, ?)
      GROUP BY mes
    `, [anoMesAnterior, anoMesAtual], (err6, rowsTendencia) => {
      if (err6) return res.status(500).send("Erro ao calcular tendência");

      const t = { atual: {}, anterior: {} };
      for (const row of rowsTendencia) {
        if (row.mes === anoMesAtual) t.atual = row;
        if (row.mes === anoMesAnterior) t.anterior = row;
      }

      const calc = (a, b) => {
        if (b === 0 && a > 0) return 100;
        if (!b || b === undefined) return null;
        return Math.round(((a - b) / b) * 100);
      };

      dados.tendencia = {
        total: calc(t.atual.total, t.anterior.total),
        abertas: calc(t.atual.abertas, t.anterior.abertas),
        encerradas: calc(t.atual.encerradas, t.anterior.encerradas),
        reabertas: calc(t.atual.reabertas || 0, t.anterior.reabertas || 0)
      };

      // Consultas adicionais
      db.all('SELECT * FROM cidades ORDER BY cidade', (err9, cidadesList) => {
        if (err9) return res.status(500).send(err9.message);
        dados.cidades = cidadesList.length;

        db.all('SELECT * FROM usuarios', (err10, usuarios) => {
          if (err10) return res.status(500).send(err10.message);
          dados.usuarios = usuarios.length;

          db.all('SELECT * FROM solicitacoes', (err11, solicitacoes) => {
            if (err11) return res.status(500).send(err11.message);
            dados.solicitacoes = {
              total: solicitacoes.length,
              respondidas: solicitacoes.filter(s => s.resposta !== null && s.resposta !== '').length
            };

            db.all(`
              SELECT c.cidade AS label, COUNT(*) AS count
              FROM ocorrencias o
              LEFT JOIN cidades c ON c.id = o.cidade_id
              WHERE date(o.data_hora_fato) BETWEEN date(?) AND date(?)
              GROUP BY c.cidade
              ORDER BY count DESC
              LIMIT 5
            `, [data_de, data_ate], (err2, cities) => {
              if (err2) return res.status(500).send(err2.message);
              dados.cities = cities;

              db.all(`
                SELECT o.natureza AS label, COUNT(*) AS count
                FROM ocorrencias o
                WHERE date(o.data_hora_fato) BETWEEN date(?) AND date(?)
                GROUP BY o.natureza
                ORDER BY count DESC
                LIMIT 5
              `, [data_de, data_ate], (err3, nats) => {
                if (err3) return res.status(500).send(err3.message);
                dados.naturezas = nats;

                db.all(`
                  SELECT u.nome_completo AS label, COUNT(*) AS count
                  FROM ocorrencias o
                  JOIN usuarios u ON u.id = o.usuario_id
                  WHERE date(o.data_hora_fato) BETWEEN date(?) AND date(?)
                  GROUP BY u.nome_completo
                  ORDER BY count DESC
                  LIMIT 5
                `, [data_de, data_ate], (err4, porUsuario) => {
                  if (err4) return res.status(500).send(err4.message);
                  dados.porUsuario = porUsuario;

                  db.all(`
                    SELECT c.cidade AS label, COUNT(*) AS count
                    FROM ocorrencias o
                    JOIN cidades c ON c.id = o.cidade_id
                    JOIN ocorrencias_liberadas ol ON ol.ocorrencia_id = o.id
                    WHERE date(o.data_hora_fato) BETWEEN date(?) AND date(?)
                    GROUP BY c.cidade
                    ORDER BY count DESC
                    LIMIT 5
                  `, [data_de, data_ate], (err5, liberadasPorCidade) => {
                    if (err5) return res.status(500).send(err5.message);
                    dados.liberadasPorCidade = liberadasPorCidade;

                    db.all(`
                      SELECT ue.orgao, COUNT(*) AS total
                      FROM solicitacoes s
                      JOIN usuarios_externos ue ON ue.id = s.usuario_externo_id
                      GROUP BY ue.orgao
                    `, (err13, porOrgao) => {
                      if (err13) return res.status(500).send(err13.message);
                      dados.porOrgao = porOrgao;

                      db.all(`
                        SELECT c.cidade, COUNT(*) AS total
                        FROM solicitacoes s
                        JOIN usuarios_externos ue ON ue.id = s.usuario_externo_id
                        JOIN cidades c ON c.id = ue.cidade_id
                        GROUP BY c.cidade
                      `, (err14, porCidadeSolic) => {
                        if (err14) return res.status(500).send(err14.message);
                        dados.porCidadeSolic = porCidadeSolic;

                        db.all(`
                          SELECT o.protocolo, o.data_hora_fato, o.status, c.cidade, u.nome_completo AS usuario
                          FROM ocorrencias o
                          LEFT JOIN cidades c ON c.id = o.cidade_id
                          LEFT JOIN usuarios u ON u.id = o.usuario_id
                          ORDER BY o.data_hora_fato DESC
                          LIMIT 5
                        `, (err12, recentes) => {
                          if (err12) return res.status(500).send(err12.message);
                          dados.recentes = recentes;

                          db.all(`
                            SELECT c.cidade, COUNT(*) AS total
                            FROM ocorrencias o
                            JOIN cidades c ON c.id = o.cidade_id
                            WHERE o.encerrada = 1
                            GROUP BY o.cidade_id
                          `, (err15, encerradasPorCidade) => {
                            if (err15) return res.status(500).send(err15.message);
                            dados.encerradasPorCidade = encerradasPorCidade;

                            // 🔴 Conte as ocorrências liberadas
                            db.get(`
                              SELECT COUNT(DISTINCT ocorrencia_id) AS total
                              FROM ocorrencias_liberadas
                            `, (err16, rowLiberadas) => {
                              if (err16) return res.status(500).send(err16.message);
                              dados.liberadas = rowLiberadas.total || 0;

                              // ✅ Renderiza a view final
                              res.render('painel/painel', {
                                dados,
                                cidades: cidadesList,
                                query: req.query
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
//Chama nova solicitação

//const solicitacoesRoutes = require('./routes/solicitacoes');
//app.use('/solicitacoes', solicitacoesRoutes(db));
app.use(usuariosExternosRouter(db));

const solicitacoesExternas = require('./routes/externo/solicitacoes');
app.use('/externo/solicitacoes', solicitacoesExternas(db));








// ------ ROTA PDF MODULARIZADA ------
app.get('/detalhes-ocorrencia/:id/pdf', (req, res) => {
  const id = req.params.id;

  db.get(`
    SELECT o.*, c.cidade AS cidade_nome, c.logo AS cidade_logo, c.corporacao AS corporacao, o.data_hora_registro
    FROM ocorrencias o
    LEFT JOIN cidades c ON c.id = o.cidade_id
    WHERE o.id = ?
  `, [id], (err, ocorrencia) => {
    if (err || !ocorrencia) {
      console.error(err || 'Ocorrência não encontrada');
      return res.status(500).send('Erro ao buscar ocorrência.');
    }

    db.all('SELECT * FROM veiculos WHERE ocorrencia_id = ?', [id], (err2, veiculos) => {
      if (err2) return res.status(500).send('Erro ao buscar veículos.');

      db.all('SELECT * FROM envolvidos_ocorrencia WHERE ocorrencia_id = ?', [id], (err3, envolvidos) => {
        if (err3) return res.status(500).send('Erro ao buscar envolvidos.');

        db.all(`
          SELECT co.*, c.cidade AS cidade_nome
          FROM complementos_ocorrencia co
          LEFT JOIN cidades c ON c.id = co.cidade_id
           WHERE co.ocorrencia_id = ?
          ORDER BY co.ordem ASC
          `,   [id], (err4, complementos) => {
          if (err4) return res.status(500).send('Erro ao buscar complementos.');

          // Divide as armas que vêm como texto único separado por vírgula
          const armas = ocorrencia.armas
            ? ocorrencia.armas.split(',').map(a => a.trim()).filter(Boolean)
            : [];

          const gerarRelatorio = require('./services/pdfService');
          gerarRelatorio(ocorrencia, complementos, req.session.user, res, veiculos, envolvidos, armas);
        });
      });
    });
  });
});

// Editar Complemento (GET)
app.get('/ocorrencia/:id/complemento/:idComplemento/editar', (req, res) => {
  const ocorrenciaId = req.params.id;
  const complementoId = req.params.idComplemento;

  db.get('SELECT * FROM complementos_ocorrencia WHERE id = ?', [complementoId], (err, complemento) => {
    if (err || !complemento) {
      console.error("Erro ao buscar complemento:", err);
      return res.status(500).send('Erro ao buscar complemento');
    }

    db.get('SELECT * FROM ocorrencias WHERE id = ?', [ocorrenciaId], (err2, ocorrenciaRaw) => {
      if (err2 || !ocorrenciaRaw) {
        console.error("Erro ao buscar ocorrência:", err2);
        return res.status(500).send('Erro ao buscar ocorrência');
      }

      const parseCampo = campo =>
        campo ? campo.split(/\n|,/).map(v => v.trim()).filter(Boolean) : [];

      const ocorrencia = {
        ...ocorrenciaRaw,
        veiculos: parseCampo(ocorrenciaRaw.veiculos),
        envolvidos: parseCampo(ocorrenciaRaw.envolvidos),
        armas: parseCampo(ocorrenciaRaw.armas)
      };

      console.log(">>> ocorrencia enviada para EJS:", ocorrencia);
      res.render('ocorrencias/formComplemento', {
        complemento,
        ocorrencia
      });
    });
  });
});
// });
//});






// 🔃 Mover complemento para cima ou para baixo
app.post('/ocorrencia/:id/complemento/:comp_id/mover', (req, res) => {
  const { id, comp_id } = req.params;
  const direcao = req.query.direcao;

  db.get('SELECT * FROM complementos_ocorrencia WHERE id = ?', [comp_id], (err, atual) => {
    if (err || !atual) {
      console.error('Erro ao buscar complemento:', err);
      return res.status(400).send("Complemento não encontrado.");
    }

    const operador = direcao === 'up' ? '<' : '>';
    const ordemSQL = direcao === 'up' ? 'DESC' : 'ASC';

    db.get(
      `SELECT * FROM complementos_ocorrencia 
       WHERE ocorrencia_id = ? AND ordem ${operador} ?
       ORDER BY ordem ${ordemSQL} LIMIT 1`,
      [id, atual.ordem],
      (err2, vizinho) => {
        if (err2 || !vizinho) {
          console.log("Nenhum item para trocar posição.");
          return res.redirect(`/detalhes-ocorrencia/${id}`);
        }

        db.run('UPDATE complementos_ocorrencia SET ordem = ? WHERE id = ?', [vizinho.ordem, atual.id], (err3) => {
          if (err3) return res.status(500).send("Erro ao atualizar ordem.");

          db.run('UPDATE complementos_ocorrencia SET ordem = ? WHERE id = ?', [atual.ordem, vizinho.id], (err4) => {
            if (err4) return res.status(500).send("Erro ao atualizar ordem.");
            return res.redirect(`/detalhes-ocorrencia/${id}`);
          });
        });
      }
    );
  });
});

// Cadastro de novo fato dentro da mesma ocorrencia 

app.get('/ocorrencia/:id/fato', (req, res) => {
  const ocorrenciaId = req.params.id;

  db.get('SELECT * FROM ocorrencias WHERE id = ?', [ocorrenciaId], (err, ocorrencia) => {
    if (err) return res.status(500).send("Erro ao buscar ocorrência.");

    db.all('SELECT * FROM cidades ORDER BY cidade', [], (err2, cidades) => {
      if (err2) return res.status(500).send("Erro ao carregar cidades.");

      res.render('ocorrencias/cadastroFato', {
        ocorrencia,
        cidades
      });
    });
  });
});



app.post('/ocorrencia/:id/fato', upload.single('documento'), (req, res) => {
  const ocorrenciaId = parseInt(req.params.id, 10);
  const { data_hora, local, tipo_local, natureza, descricao, armas, cidade_id } = req.body;
  const documento = req.file ? req.file.filename : null;

  // ✅ Extrai data e hora separadamente
  const data = (data_hora || '').slice(0, 10);     // YYYY-MM-DD
  const hora = (data_hora || '').slice(11, 16);    // HH:MM

  const veicMarcas = [].concat(req.body['veiculos[][marca_modelo]'] || []);
  const veicCores = [].concat(req.body['veiculos[][cor]'] || []);
  const veicPlacas = [].concat(req.body['veiculos[][placa]'] || []);

  const tipos = [].concat(req.body['envolvidos[][tipo]'] || []);
  const nomes = [].concat(req.body['envolvidos[][nome]'] || []);
  const cpfs = [].concat(req.body['envolvidos[][cpf]'] || []);
  const telefones = [].concat(req.body['envolvidos[][telefone]'] || []);
  const enderecos = [].concat(req.body['envolvidos[][endereco]'] || []);

  const envolvidos = tipos.map((_, i) => ({
    tipo: tipos[i] || '----',
    nome: nomes[i] || '----',
    cpf: cpfs[i] || '----',
    telefone: telefones[i] || '----',
    endereco: enderecos[i] || '----'
  }));

  const armasStr = (armas || '').split(',').map(a => a.trim()).filter(Boolean).join(', ') || '----';

  db.get(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS nova_ordem FROM complementos_ocorrencia WHERE ocorrencia_id = ?',
    [ocorrenciaId],
    (err, row) => {
      if (err) return res.status(500).send("Erro ao calcular ordem");

      const novaOrdem = row.nova_ordem;

      db.run(
        `INSERT INTO complementos_ocorrencia 
        (ocorrencia_id, data, hora, data_hora, local, tipo_local, natureza, descricao, armas, documento, ordem, tipo, cidade_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fato', ?)`,
        [ocorrenciaId, data, hora, data_hora, local, tipo_local, natureza, descricao, armasStr, documento, novaOrdem, cidade_id],

        function (err2) {
          if (err2) {
            console.error("Erro ao salvar fato:", err2.message);
            return res.status(500).send("Erro ao salvar fato");
          }

          const fatoId = this.lastID;

          const stmtV = db.prepare(`INSERT INTO veiculos_fato (fato_id, marca_modelo, cor, placa) VALUES (?, ?, ?, ?)`);
          for (let i = 0; i < veicMarcas.length; i++) {
            stmtV.run(
              fatoId,
              veicMarcas[i] || '----',
              veicCores[i] || '----',
              veicPlacas[i] || '----'
            );
          }
          stmtV.finalize(err3 => {
            if (err3) {
              console.error("Erro ao salvar veículos do fato:", err3.message);
              return res.status(500).send("Erro ao salvar veículos");
            }

            const stmtE = db.prepare(`INSERT INTO envolvidos_fato (fato_id, tipo, nome, cpf, telefone, endereco) VALUES (?, ?, ?, ?, ?, ?)`);
            envolvidos.forEach(ev => {
              stmtE.run(fatoId, ev.tipo, ev.nome, ev.cpf, ev.telefone, ev.endereco);
            });
            stmtE.finalize(err4 => {
              if (err4) {
                console.error("Erro ao salvar envolvidos do fato:", err4.message);
                return res.status(500).send("Erro ao salvar envolvidos");
              }

              res.redirect(`/detalhes-ocorrencia/${ocorrenciaId}`);
            });
          });
        }
      );
    }
  );
});


// editar fato 


app.get('/ocorrencia/:id/fato/:fatoId/editar', (req, res) => {
  const ocorrenciaId = req.params.id;
  const fatoId = req.params.fatoId;

  db.get('SELECT * FROM ocorrencias WHERE id = ?', [ocorrenciaId], (err1, ocorrencia) => {
    if (err1 || !ocorrencia) return res.status(500).send('Ocorrência não encontrada');

    db.get('SELECT * FROM complementos_ocorrencia WHERE id = ? AND tipo = "fato"', [fatoId], (err2, fato) => {
      if (err2 || !fato) return res.status(500).send('Fato não encontrado');

      db.all('SELECT * FROM veiculos_fato WHERE fato_id = ?', [fatoId], (err3, veiculosFato) => {
        if (err3) return res.status(500).send(err3.message);

        db.all('SELECT * FROM envolvidos_fato WHERE fato_id = ?', [fatoId], (err4, envolvidosFato) => {
          if (err4) return res.status(500).send(err4.message);

          db.all('SELECT * FROM cidades ORDER BY cidade', [], (err5, cidades) => {
            if (err5) return res.status(500).send(err5.message);

            res.render('ocorrencias/editarFato', {
              ocorrencia,
              fato,
              veiculosFato,
              envolvidosFato,
              cidades
            });
          });
        });
      });
    });
  });
});




app.post('/ocorrencia/:ocorrenciaId/fato/:id/editar', upload.single('documento'), (req, res) => {
  const { ocorrenciaId, id } = req.params;
  const { data_hora, local, tipo_local, natureza, descricao, armas } = req.body;
  const documento = req.file ? req.file.filename : req.body.documento_antigo || null;

  const armasStr = (armas || '').split(',').map(a => a.trim()).filter(Boolean).join(', ') || '----';

  const veicMarcas = [].concat(req.body['veiculos[][marca_modelo]'] || []);
  const veicCores = [].concat(req.body['veiculos[][cor]'] || []);
  const veicPlacas = [].concat(req.body['veiculos[][placa]'] || []);

  const tipos = [].concat(req.body['envolvidos[][tipo]'] || []);
  const nomes = [].concat(req.body['envolvidos[][nome]'] || []);
  const cpfs = [].concat(req.body['envolvidos[][cpf]'] || []);
  const telefones = [].concat(req.body['envolvidos[][telefone]'] || []);
  const enderecos = [].concat(req.body['envolvidos[][endereco]'] || []);

  const envolvidos = tipos.map((_, i) => ({
    tipo: tipos[i] || '----',
    nome: nomes[i] || '----',
    cpf: cpfs[i] || '----',
    telefone: telefones[i] || '----',
    endereco: enderecos[i] || '----'
  }));

  db.run(
    `UPDATE complementos_ocorrencia SET
      data_hora = ?, local = ?, tipo_local = ?, natureza = ?, descricao = ?, armas = ?, documento = ?
     WHERE id = ?`,
    [data_hora, local, tipo_local, natureza, descricao, armasStr, documento, id],
    function (err) {
      if (err) return res.status(500).send("Erro ao atualizar fato");

      db.run('DELETE FROM veiculos_fato WHERE fato_id = ?', [id], err2 => {
        if (err2) return res.status(500).send("Erro ao limpar veículos");

        const stmtV = db.prepare(`INSERT INTO veiculos_fato (fato_id, marca_modelo, cor, placa) VALUES (?, ?, ?, ?)`);
        for (let i = 0; i < veicMarcas.length; i++) {
          stmtV.run(id, veicMarcas[i] || '----', veicCores[i] || '----', veicPlacas[i] || '----');
        }
        stmtV.finalize();

        db.run('DELETE FROM envolvidos_fato WHERE fato_id = ?', [id], err3 => {
          if (err3) return res.status(500).send("Erro ao limpar envolvidos");

          const stmtE = db.prepare(`INSERT INTO envolvidos_fato (fato_id, tipo, nome, cpf, telefone, endereco) VALUES (?, ?, ?, ?, ?, ?)`);
          envolvidos.forEach(ev => {
            stmtE.run(id, ev.tipo, ev.nome, ev.cpf, ev.telefone, ev.endereco);
          });
          stmtE.finalize();

          res.redirect(`/detalhes-ocorrencia/${ocorrenciaId}`);
        });
      });
    }
  );
});



app.listen(PORT, () => console.log(`Server running on port ${PORT}`));