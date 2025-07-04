const express     = require('express');
const compression = require('compression');
const morgan      = require('morgan');
const path        = require('path');
const sqlite3     = require('sqlite3').verbose();
const session     = require('express-session');
const bcrypt      = require('bcrypt');
const multer      = require('multer');
const fs          = require('fs');
const logger      = require('./services/logger');
const gerarRelatorio = require('./services/pdfService');
const ocorrenciasRouter = require('./routes/ocorrencias');

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

db.serialize(() => {
  db.all("PRAGMA table_info(ocorrencias)", [], (err, cols) => {
    if (!err && !cols.some(c => c.name === 'cidade_id')) {
      db.run("ALTER TABLE ocorrencias ADD COLUMN cidade_id INTEGER", [], err2 => {
        if (err2 && !/duplicate column/.test(err2.message)) console.error(err2.message);
      });
    }
  });
});

// Authentication routes
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
       req.session.user = {  id: user.id, nome_completo: user.nome_completo, perfil: user.perfil, cargo: user.cargo   };
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
  db.all('SELECT * FROM ocorrencias WHERE encerrada=0 ORDER BY id DESC', [], (err, rows) => {
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
app.post('/cadastro-ocorrencia', upload.single('documento'), (req, res) => {
  const { data_hora_fato, local, tipo_local, natureza, descricao, cidade_id } = req.body;
  const documento = req.file ? req.file.filename : null;

  // Process arrays for veículos, envolvidos e armas
  const veiculosArr = req.body.veiculos
    ? (Array.isArray(req.body.veiculos) ? req.body.veiculos : [req.body.veiculos])
    : [];
  const veiculosStr = veiculosArr.filter(v => v).join(', ') || '----';

  const envolvidosArr = req.body.envolvidos
    ? (Array.isArray(req.body.envolvidos) ? req.body.envolvidos : [req.body.envolvidos])
    : [];
  const envolvidosStr = envolvidosArr.filter(v => v).join(', ') || '----';

  const armasArr = req.body.armas
    ? (Array.isArray(req.body.armas) ? req.body.armas : [req.body.armas])
    : [];
  const armasStr = armasArr.filter(v => v).join(', ') || '----';
  const now = new Date();
  const prefix = now.toISOString().slice(0,16).replace(/[-:T]/g,'');
  db.get('SELECT COUNT(*) AS count FROM ocorrencias WHERE protocolo LIKE ?', [prefix+'%'], (err, row) => {
    const seq = ((row && row.count) || 0) + 1;
    const protocolo = `${prefix}-${seq.toString().padStart(3,'0')}`;
    db.run(
      `INSERT INTO ocorrencias
         (protocolo, data_hora_fato, local, tipo_local, natureza,
          descricao, veiculos, envolvidos, armas, documento, cidade_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [protocolo, data_hora_fato, local, tipo_local, natureza, descricao, veiculosStr, envolvidosStr, armasStr, documento, cidade_id],
      err2 => {
        if (err2) return res.status(500).send(err2.message);
        res.redirect('/ocorrencias');
      }
    );
  });
});

// Edit occurrence (GET)
app.get('/ocorrencia/:id/editar', (req, res) => {
  db.all('SELECT * FROM cidades ORDER BY cidade', [], (err, cidades) => {
    if (err) return res.status(500).send(err.message);
    db.get('SELECT * FROM ocorrencias WHERE id = ?', [req.params.id], (err2, ocorrencia) => {
      if (err2 || !ocorrencia) {
        const msg = err2 ? err2.message : 'Ocorrência não encontrada';
        return res.status(500).send(msg);
      }
      res.render('ocorrencias/editarOcorrencia', { ocorrencia, cidades });
    });
  });
});

// Edit occurrence (POST)
app.post('/ocorrencia/:id/editar', upload.single('documento'), (req, res) => {
  const { data_hora_fato, local, tipo_local, natureza, descricao, cidade_id } = req.body;
  const documento = req.file ? req.file.filename : req.body.oldDocumento;

  // Process arrays for veículos, envolvidos e armas
  const veiculosArr = req.body.veiculos
    ? (Array.isArray(req.body.veiculos) ? req.body.veiculos : [req.body.veiculos])
    : [];
  const veiculosStr = veiculosArr.filter(v => v).join(', ') || '----';

  const envolvidosArr = req.body.envolvidos
    ? (Array.isArray(req.body.envolvidos) ? req.body.envolvidos : [req.body.envolvidos])
    : [];
  const envolvidosStr = envolvidosArr.filter(v => v).join(', ') || '----';

  const armasArr = req.body.armas
    ? (Array.isArray(req.body.armas) ? req.body.armas : [req.body.armas])
    : [];
  const armasStr = armasArr.filter(v => v).join(', ') || '----';
  db.run(
    `UPDATE ocorrencias
        SET data_hora_fato = ?, local = ?, tipo_local = ?, natureza = ?,
            descricao = ?, veiculos = ?, envolvidos = ?, armas = ?, cidade_id = ?, documento = ?
     WHERE id = ?`,
    [data_hora_fato, local, tipo_local, natureza, descricao, veiculosStr, envolvidosStr, armasStr, cidade_id, documento, req.params.id],
    err => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/detalhes-ocorrencia/' + req.params.id);
    }
  );
});

// Details

app.get('/detalhes-ocorrencia/:id', (req, res) => {
    const id = req.params.id;
    db.get(`
        SELECT o.*, c.cidade AS cidade_nome, c.logo AS cidade_logo 
        FROM ocorrencias o
        LEFT JOIN cidades c ON c.id = o.cidade_id
        WHERE o.id = ?
    `, [id], (err, ocorrencia) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Erro ao buscar ocorrência.');
        }
        if (!ocorrencia) {
            return res.status(404).send('Ocorrência não encontrada.');
        }
        db.all('SELECT * FROM complementos_ocorrencia WHERE ocorrencia_id = ?', [id], (err2, complementos) => {
            if (err2) {
                console.error(err2.message);
                return res.status(500).send('Erro ao buscar complementos.');
            }
            res.render('ocorrencias/detalhesOcorrencia', { ocorrencia, complementos });
        });
    });
});

// Start server


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

  // Se o usuário não enviar um novo arquivo, mantemos o logo antigo
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
    res.render('usuario/usuarios', { usuarios });
  });
});

// Relatórios
app.get('/relatorios', (req, res) => {
  const { protocolo, data_from, data_to, local, tipo_local, natureza } = req.query;
  let filters = [], params = [];
  if (protocolo)   { filters.push('protocolo   LIKE ?'); params.push(`%${protocolo}%`); }
  if (data_from)   { filters.push('date(data_hora_fato) >= date(?)'); params.push(data_from); }
  if (data_to)     { filters.push('date(data_hora_fato) <= date(?)'); params.push(data_to); }
  if (local)       { filters.push('local       LIKE ?'); params.push(`%${local}%`); }
  if (tipo_local)  { filters.push('tipo_local  LIKE ?'); params.push(`%${tipo_local}%`); }
  if (natureza)    { filters.push('natureza    LIKE ?'); params.push(`%${natureza}%`); }
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
  db.all('SELECT * FROM ocorrencias WHERE encerrada = 1 ORDER BY id DESC', [], (err, rows) => {
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

// Inserir Complemento (POST)
app.post('/ocorrencia/:ocorrenciaId/complemento', upload.single('arquivo'), (req, res) => {
  const id = req.params.ocorrenciaId;
    // Captura também o Base64 do canvas
    const { descricao, data, hora, local, imagemAnotada } = req.body;
    let arquivo = null;

    // 1) Se colou algo no canvas, decode e salve o Base64 como PNG
    if (imagemAnotada) {
      const matches = imagemAnotada.match(/^data:image\/png;base64,(.+)$/);
      if (matches) {
        const base64Data = matches[1];
        const filename   = `complemento_${Date.now()}.png`;
        const dest       = path.join(__dirname, '..', 'uploads', filename);
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

});
});

  //});
//});


  //});
//});

// GET Formulário de Complemento (Editar)
app.get('/ocorrencia/:ocorrenciaId/complemento/:id/editar', (req, res) => {
  const { ocorrenciaId, id } = req.params;
  db.get('SELECT * FROM complementos_ocorrencia WHERE id = ?', [id], (err, complemento) => {
    if (err || !complemento) return res.status(404).send('Complemento não encontrado.');
    res.render('ocorrencias/formComplemento', { complemento, ocorrenciaId });
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

//const acoesConjuntasRoutes = require('./routes/acoesConjuntas');
//app.use('/acoes-conjuntas', acoesConjuntasRoutes);

// ← error‐handler vem logo abaixo
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Ocorreu um erro interno. Veja o console do servidor.');
});



app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


app.get('/ocorrencia/:id/reabrir', (req, res) => {
    const id = req.params.id;
    res.render('ocorrencia/reabrir', { id });
});

app.post('/ocorrencia/:id/reabrir', (req, res) => {
    const id = req.params.id;
    const { motivo_reabertura } = req.body;

    db.run('UPDATE ocorrencias SET encerrada = 0, motivo_reabertura = ? WHERE id = ?', 
        [motivo_reabertura, id], 
        function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Erro ao reabrir a ocorrência.');
            }
            res.redirect('/ocorrencias-encerradas');
        }
    );
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
        function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Erro ao encerrar a ocorrência.');
            }
            res.redirect('/ocorrencias');
        }
    );
});

// ------ ROTA PDF MODULARIZADA ------
// Rota de PDF modularizada:
app.get('/detalhes-ocorrencia/:id/pdf', (req, res) => {
  const id = req.params.id;
  // Busca dados principais da ocorrência
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
    // Busca complementos
    db.all(
      'SELECT * FROM complementos_ocorrencia WHERE ocorrencia_id = ?',
      [id],
      (err2, complementos) => {
        if (err2) {
          console.error(err2);
          return res.status(500).send('Erro ao buscar complementos.');
        }
        // Chama seu serviço, passando (ocorrencia, complementos, res)
        gerarRelatorio(ocorrencia, complementos, req.session.user, res);
      }
    );
  });
});

// Detalhes de uma Ocorrência
app.get('/ocorrencias/:id', (req, res, next) => {
  const { id } = req.params;
  const db = req.app.locals.db;
  db.get(
    'SELECT * FROM ocorrencias WHERE id = ?',
    [id],
    (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(404).send('Ocorrência não encontrada');
      // renderize o template de detalhe (veja o passo 3)
      res.render('ocorrencias/detalhe', { ocorrencia: row });
    }
  );
});



app.get('/ocorrencia/:id/complemento/:idComplemento/editar', async (req, res) => {
  const ocorrenciaId = req.params.id;
  const complementoId = req.params.idComplemento;

  db.get('SELECT * FROM complementos WHERE id = ?', [complementoId], (err, complemento) => {
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

