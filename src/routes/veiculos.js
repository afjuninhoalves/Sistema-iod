
const express = require('express');
const router = express.Router();
const db = require('../database');

// Inserir múltiplos veículos por ocorrência
router.post('/cadastrar/:ocorrencia_id', (req, res) => {
    const { ocorrencia_id } = req.params;
    const { veiculos } = req.body;

    // Remover veículos antigos
    db.run("DELETE FROM veiculos WHERE ocorrencia_id = ?", [ocorrencia_id], err => {
        if (err) {
            console.error(err);
            return res.status(500).send("Erro ao limpar veículos antigos");
        }

        // Inserir novos veículos
        const stmt = db.prepare("INSERT INTO veiculos (ocorrencia_id, marca_modelo, cor, placa) VALUES (?, ?, ?, ?)");
        veiculos.forEach(v => {
            const marcaModelo = v.marca_modelo || '----';
            const cor = v.cor || '----';
            const placa = v.placa || '----';
            stmt.run([ocorrencia_id, marcaModelo, cor, placa]);
        });
        stmt.finalize();

        res.sendStatus(200);
    });
});

module.exports = router;
