-- Migration: cria tabela qualificadores para Ações por Cidade
CREATE TABLE IF NOT EXISTS qualificadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acao_por_cidade_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'individuos' ou 'informantes'
  nome TEXT NOT NULL,
  cpf TEXT,
  endereco TEXT,
  telefone TEXT,
  descricao TEXT,
  FOREIGN KEY(acao_por_cidade_id) REFERENCES acao_por_cidade(id)
);
