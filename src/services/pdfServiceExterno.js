const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function gerarRelatorio(ocorrencia, complementos, user, res, veiculosLista = [], envolvidosLista = [], armasLista = []) {
  const doc = new PDFDocument({ margin: 40, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=ocorrencia_${ocorrencia.protocolo}.pdf`
  );
  doc.pipe(res);

  const uploadBase = path.join(__dirname, '../../uploads');
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const cimLogo = path.join(__dirname, '../../public/images/cim_logo.jpg');
  if (fs.existsSync(cimLogo)) {
    doc.image(cimLogo, 40, 30, { width: 80 });
  }

  if (ocorrencia.cidade_logo) {
    const cityLogo = path.join(uploadBase, ocorrencia.cidade_logo);

    // 🔧 Ajuste para evitar erro caso a logo da cidade não exista
    if (fs.existsSync(cityLogo)) {
      doc.image(cityLogo, doc.page.width - 120, 30, { width: 80 });
    } else {
      const logoPadrao = path.join(__dirname, '../../public/images/logo_padrao.jpg');
      if (fs.existsSync(logoPadrao)) {
        doc.image(logoPadrao, doc.page.width - 120, 30, { width: 80 });
      }
    }
  }

  doc.moveDown(3)
    .font('Helvetica-Bold').fontSize(20).text('Estudo de Caso para Ação Preventiva', { align: 'center' })
    //.moveDown(0.5).fontSize(18).text('I.O.D.', { align: 'center' })
    .moveDown(0.5).fontSize(14).text('Sistema de Inteligência Operacional Digital ', { align: 'center' })
    .moveDown(0.5).text(ocorrencia.corporacao || '—', { align: 'center' });

  const bannerW = doc.page.width - 80;
  const bannerX = 40;
  const bannerY = doc.y;
  doc.save()
    .rect(bannerX, bannerY, bannerW, 25).fill('#FF0000')
    .fillColor('#FFFFFF').fontSize(12)
    .text('INFORMAÇÃO RESERVADA', bannerX, bannerY + 6, { width: bannerW, align: 'center' })
    .restore().fillColor('#000000');

  doc.moveDown(2);
  const labels = [
    'Protocolo', 'Data/Hora Registro', 'Data/Hora Fato',
    'Cidade', 'Local', 'Tipo Local', 'Natureza', 'Descrição'
  ];
  const values = [
    ocorrencia.protocolo,
    ocorrencia.data_hora_registro,
    ocorrencia.data_hora_fato,
    ocorrencia.cidade_nome || '—',
    ocorrencia.local || '—',
    ocorrencia.tipo_local || '—',
    ocorrencia.natureza || '—',
    ocorrencia.descricao || '—'
  ];
  // Corrige caracteres especiais e quebras de linha estranhas na Descrição
  values[7] = values[7].replace(/\r\n|\r/g, '\n').replace(/[^\x20-\x7E\n]/g, '');

  const xLabel = doc.page.margins.left;
  const xValue = xLabel + 120;

  labels.forEach((label, i) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(12).text(label + ':', xLabel, y);

    // Se for a Descrição (index 7), calcula a altura ocupada
    if (i === 7) {
      doc.font('Helvetica').text(values[i], xValue, y, {
        width: pageW - 120, // ⬅️ largura para quebra de linha automática
        align: 'left'
      });
      // Atualiza doc.y para a linha seguinte real
      const alturaDesc = doc.heightOfString(values[i], { width: pageW - 120 });
      doc.y = y + alturaDesc + 4;
    } else {
      doc.font('Helvetica').text(values[i], xValue, y);
      const lineHeight = doc.currentLineHeight();
      doc.y = y + lineHeight + 4;
    }
  });

  doc.moveDown(0.5)
    .strokeColor('#CCCCCC').lineWidth(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();

  if (veiculosLista.length) {
    doc.moveDown().font('Helvetica-Bold').text('Veículos:', { underline: true });
    veiculosLista.forEach((v, i) => {
      doc.font('Helvetica').text(`${i + 1}. ${v.marca_modelo || '—'} / ${v.cor || '—'} / ${v.placa || '—'}`);
    });
  }

  if (envolvidosLista.length) {
    doc.moveDown().font('Helvetica-Bold').text('Envolvidos:', { underline: true });
    envolvidosLista.forEach((e, i) => {
      doc.font('Helvetica').text(`${i + 1}. ${e.tipo || '—'} - ${e.nome || '—'}, CPF: ${e.cpf || '—'}, Tel: ${e.telefone || '—'}, Endereço: ${e.endereco || '—'}`);
    });
  }

  if (armasLista.length) {
    doc.moveDown().font('Helvetica-Bold').text('Armas:', { underline: true });
    armasLista.forEach((a, i) => {
      doc.font('Helvetica').text(`${i + 1}. ${a}`);
    });
  }

  if (complementos && complementos.length) {
    const pageH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    const slotH = pageH / 2;
    let slotOcupado = false;

    for (let i = 0; i < complementos.length; i++) {
      const comp = complementos[i];

      if (!slotOcupado) {
        doc.addPage();
        slotOcupado = true;
      } else {
        slotOcupado = false;
      }

      const row = slotOcupado ? 0 : 1;
      const y0 = doc.page.margins.top + row * slotH;

      const alturaDescricao = doc.heightOfString(comp.descricao || '—', { width: pageW - 140 });
      const alturaTotal = alturaDescricao + 120;

      if (alturaTotal > slotH) {
        doc.addPage();
        slotOcupado = true;
      }

      doc.save().rect(doc.page.margins.left, y0, pageW, slotH)
        .fillOpacity(0.05).fill('#000000').restore().fillOpacity(1);

      doc.font('Helvetica-Bold').fontSize(12).text('Descrição:', doc.page.margins.left + 10, y0 + 10);
      doc.font('Helvetica').text(comp.descricao || '—', 120, y0 + 10, { width: pageW - 140 });

      doc.font('Helvetica-Bold').text('Data/Hora:', doc.page.margins.left + 10, y0 + 30 + alturaDescricao);
      doc.font('Helvetica').text(`${comp.data || ''} ${comp.hora || ''}`, 120, y0 + 30 + alturaDescricao);

      doc.font('Helvetica-Bold').text('Local:', doc.page.margins.left + 10, y0 + 50 + alturaDescricao);
      doc.font('Helvetica').text(comp.local || '—', 120, y0 + 50 + alturaDescricao);

      if (comp.arquivo) {
        const imgPath = path.join(uploadBase, comp.arquivo);
        if (fs.existsSync(imgPath)) {
          doc.image(imgPath,
            doc.page.margins.left + 10,
            y0 + 70 + alturaDescricao,
            { fit: [pageW - 20, slotH - (80 + alturaDescricao)], align: 'center', valign: 'center' }
          );
        }
      }
    }
  }

  doc.addPage();
  const pageH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const midY = doc.page.margins.top + pageH / 2;

  doc.font('Helvetica').fontSize(12)
    .text('Este relatório é confidencial e foi emitido por:',
      doc.page.margins.left, doc.page.margins.top,
      { width: pageW, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(16)
   .text(ocorrencia.corporacao || '—', doc.page.margins.left, midY - 10, { width: pageW, align: 'center' });
  //doc.font('Helvetica').fontSize(14)
    //.text(user.cargo, doc.page.margins.left, midY + 20, { width: pageW, align: 'center' });

  doc.end();
}

module.exports = gerarRelatorio;
