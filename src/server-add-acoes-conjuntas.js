// Adicione estas linhas no seu server.js:
// Após configurar a conexão com o banco (db):
app.locals.db = db;

// Após as outras rotas:
const acoesConjuntasRoutes = require('./routes/acoesConjuntas');
app.use('/acoes-conjuntas', acoesConjuntasRoutes);
