
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');



function setupPainelRoutes(app, db) {




  // 📄 PDF
  app.get('/painel/pdf', (req, res) => {
    const { cidade_id, data_de, data_ate, natureza, status, tipo_local, tipo_envolvido } = req.query;
    const filtros = [];
    const params = [];

    if (cidade_id) { filtros.push('o.cidade_id = ?'); params.push(cidade_id); }
    if (data_de) { filtros.push('date(o.data_hora_fato) >= date(?)'); params.push(data_de); }
    if (data_ate) { filtros.push('date(o.data_hora_fato) <= date(?)'); params.push(data_ate); }
    if (natureza) { filtros.push('o.natureza LIKE ?'); params.push(`%${natureza}%`); }
    if (status === 'abertas') filtros.push('o.encerrada = 0');
    else if (status === 'encerradas') filtros.push('o.encerrada = 1');
    else if (status === 'reabertas') filtros.push('o.motivo_reabertura IS NOT NULL');
    if (tipo_local) { filtros.push('o.tipo_local LIKE ?'); params.push(`%${tipo_local}%`); }
    if (tipo_envolvido) {
      filtros.push(`EXISTS (SELECT 1 FROM envolvidos_ocorrencia eo WHERE eo.ocorrencia_id = o.id AND eo.tipo = ?)`); params.push(tipo_envolvido);
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    db.all(`
      SELECT c.cidade, COUNT(*) as total
      FROM ocorrencias o
      LEFT JOIN cidades c ON c.id = o.cidade_id
      ${where}
      GROUP BY c.cidade
    `, params, (err, porCidade) => {
      if (err) return res.status(500).send('Erro ao gerar PDF');

      db.all(`
        SELECT natureza, COUNT(*) as total
        FROM ocorrencias o
        ${where}
        GROUP BY natureza
      `, params, (err2, porNatureza) => {
        if (err2) return res.status(500).send('Erro ao gerar PDF');

        db.all(`
          SELECT u.nome_completo as usuario, COUNT(*) as total
          FROM ocorrencias o
          LEFT JOIN usuarios u ON u.id = o.usuario_id
          ${where}
          GROUP BY u.nome_completo
        `, params, (err3, porUsuario) => {
          if (err3) return res.status(500).send('Erro ao gerar PDF');

          const doc = new PDFDocument();
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="painel.pdf"');
          doc.pipe(res);

          doc.fontSize(18).text('Relatório do Painel de Ocorrências', { align: 'center' });
          doc.moveDown();

          doc.fontSize(14).text('Ocorrências por Cidade:');
          porCidade.forEach(item => doc.text(`- ${item.cidade}: ${item.total}`));
          doc.moveDown();

          doc.fontSize(14).text('Ocorrências por Natureza:');
          porNatureza.forEach(item => doc.text(`- ${item.natureza}: ${item.total}`));
          doc.moveDown();

          doc.fontSize(14).text('Ocorrências por Usuário:');
          porUsuario.forEach(item => doc.text(`- ${item.usuario}: ${item.total}`));

          doc.end();
        });
      });
    });
  });

  // 📊 Excel
  app.get('/painel/excel', (req, res) => {
    const { cidade_id, data_de, data_ate, natureza, status, tipo_local, tipo_envolvido } = req.query;
    const filtros = [];
    const params = [];

    if (cidade_id) { filtros.push('o.cidade_id = ?'); params.push(cidade_id); }
    if (data_de) { filtros.push('date(o.data_hora_fato) >= date(?)'); params.push(data_de); }
    if (data_ate) { filtros.push('date(o.data_hora_fato) <= date(?)'); params.push(data_ate); }
    if (natureza) { filtros.push('o.natureza LIKE ?'); params.push(`%${natureza}%`); }
    if (status === 'abertas') filtros.push('o.encerrada = 0');
    else if (status === 'encerradas') filtros.push('o.encerrada = 1');
    else if (status === 'reabertas') filtros.push('o.motivo_reabertura IS NOT NULL');
    if (tipo_local) { filtros.push('o.tipo_local LIKE ?'); params.push(`%${tipo_local}%`); }
    if (tipo_envolvido) {
      filtros.push(`EXISTS (SELECT 1 FROM envolvidos_ocorrencia eo WHERE eo.ocorrencia_id = o.id AND eo.tipo = ?)`); params.push(tipo_envolvido);
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Painel');

    sheet.columns = [
      { header: 'Tipo', key: 'tipo', width: 25 },
      { header: 'Nome', key: 'nome', width: 30 },
      { header: 'Total', key: 'total', width: 15 }
    ];

    db.all(`
      SELECT c.cidade AS nome, COUNT(*) as total
      FROM ocorrencias o
      LEFT JOIN cidades c ON c.id = o.cidade_id
      ${where}
      GROUP BY c.cidade
    `, params, (err, porCidade) => {
      if (err) return res.status(500).send('Erro ao gerar Excel');
      porCidade.forEach(row => sheet.addRow({ tipo: 'Cidade', nome: row.nome, total: row.total }));

      db.all(`
        SELECT natureza AS nome, COUNT(*) as total
        FROM ocorrencias o
        ${where}
        GROUP BY natureza
      `, params, (err2, porNatureza) => {
        if (err2) return res.status(500).send('Erro ao gerar Excel');
        porNatureza.forEach(row => sheet.addRow({ tipo: 'Natureza', nome: row.nome, total: row.total }));

        db.all(`
          SELECT u.nome_completo AS nome, COUNT(*) as total
          FROM ocorrencias o
          LEFT JOIN usuarios u ON u.id = o.usuario_id
          ${where}
          GROUP BY u.nome_completo
        `, params, (err3, porUsuario) => {
          if (err3) return res.status(500).send('Erro ao gerar Excel');
          porUsuario.forEach(row => sheet.addRow({ tipo: 'Usuário', nome: row.nome, total: row.total }));

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="painel.xlsx"');
          workbook.xlsx.write(res).then(() => res.end());
        });
      });
    });
  });

 

  }

module.exports = setupPainelRoutes;