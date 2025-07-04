
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');

module.exports = function gerarRelatorio(ocorrencia, complementos, res) {
  const doc = new PDFDocument();
  const filename = `relatorio_ocorrencia_${ocorrencia.protocolo}.pdf`;
  res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-type', 'application/pdf');
  doc.pipe(res);

  doc.fontSize(20).text('Relatório de Ocorrência', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`Protocolo: ${ocorrencia.protocolo}`);
  doc.text(`Data: ${ocorrencia.data} ${ocorrencia.hora}`);
  doc.text(`Cidade: ${ocorrencia.cidade}`);
  doc.text(`Local: ${ocorrencia.local}`);
  doc.text(`Responsável: ${ocorrencia.responsavel}`);
  doc.text(`Resumo: ${ocorrencia.resumo}`);
  doc.moveDown();

  if (complementos.length > 0) {
    complementos.forEach((comp, index) => {
      doc.addPage();
      doc.fontSize(14).fillColor('#000').text(`──────────── INFORMAÇÃO COMPLEMENTAR ${index + 1} ────────────`, { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#000').text('📌 Descrição:', { continued: true }).fillColor('#333').text(` ${comp.descricao}`);
      doc.fontSize(12).fillColor('#000').text('📅 Data:', { continued: true }).fillColor('#333').text(` ${comp.data}`, { continued: true });
      doc.fillColor('#000').text('   🕒 Hora:', { continued: true }).fillColor('#333').text(` ${comp.hora}`);
      doc.moveDown(1);
      if (comp.arquivo) {
        const imagePath = path.join(__dirname, '..', '..', 'uploads', comp.arquivo);
        if (fs.existsSync(imagePath)) {
          try {
            const dimensions = sizeOf(imagePath);
            const pageWidth = doc.page.width - 80;
            const pageHeight = doc.page.height - 120;
            const scale = Math.min(pageWidth / dimensions.width, pageHeight / dimensions.height);
            const scaledWidth = dimensions.width * scale;
            const scaledHeight = dimensions.height * scale;
            const x = (doc.page.width - scaledWidth) / 2;
            const y = doc.y + 10;
            doc.image(imagePath, x, y, {
              width: scaledWidth,
              height: scaledHeight
            });
          } catch (e) {
            console.error('Erro ao adicionar imagem do complemento:', e);
          }
        }
      }
      doc.moveDown(2);
      doc.fillColor('#000').text('──────────────────────────────────────────────', { align: 'center' });
    });
  }

  doc.end();
};
