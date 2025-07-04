-- migrations/20250509_create_qualificadores.sql

CREATE TABLE IF NOT EXISTS qualificadores (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  acao_por_cidade_id   INTEGER NOT NULL,
  tipo                 TEXT    NOT NULL,  -- 'individuos' ou 'informantes'
  nome                 TEXT    NOT NULL,
  cpf                  TEXT,               -- só para tipo 'individuos'
  endereco             TEXT,               -- só para tipo 'individuos'
  telefone             TEXT    NOT NULL,
  descricao            TEXT    NOT NULL,
  FOREIGN KEY (acao_por_cidade_id)
    REFERENCES acao_por_cidade(id)
    ON DELETE CASCADE
);
