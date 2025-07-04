-- Migration for Ações Conjuntas module
CREATE TABLE IF NOT EXISTS acoes_conjuntas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cidade_responsavel_id INTEGER NOT NULL,
  objetivo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cidade_responsavel_id) REFERENCES cidades(id)
);

CREATE TABLE IF NOT EXISTS acoes_conjuntas_participantes (
  acoes_conjuntas_id INTEGER NOT NULL,
  cidade_id INTEGER NOT NULL,
  PRIMARY KEY (acoes_conjuntas_id, cidade_id),
  FOREIGN KEY (acoes_conjuntas_id) REFERENCES acoes_conjuntas(id),
  FOREIGN KEY (cidade_id) REFERENCES cidades(id)
);

CREATE TABLE IF NOT EXISTS acao_por_cidade (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acoes_conjuntas_id INTEGER NOT NULL,
  cidade_id INTEGER NOT NULL,
  data_hora DATETIME NOT NULL,
  responsavel TEXT NOT NULL,
  descricao TEXT NOT NULL,
  qualificacao_tipo TEXT NOT NULL CHECK(qualificacao_tipo IN ('individuos','informantes')),
  q_nome TEXT,
  q_cpf TEXT,
  q_endereco TEXT,
  q_telefone TEXT,
  q_descricao TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (acoes_conjuntas_id) REFERENCES acoes_conjuntas(id),
  FOREIGN KEY (cidade_id) REFERENCES cidades(id)
);

CREATE TABLE IF NOT EXISTS acao_por_cidade_arquivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acao_por_cidade_id INTEGER NOT NULL,
  arquivo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('audio','video')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (acao_por_cidade_id) REFERENCES acao_por_cidade(id)
);
