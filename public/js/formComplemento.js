document.addEventListener('DOMContentLoaded', () => {
  const img = document.getElementById('preview-img');
  const canvas = document.getElementById('arrow-canvas');
  if (!img || !canvas) return;

  function resizeCanvas() {
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  img.addEventListener('load', resizeCanvas);
  resizeCanvas();

  let selectedArrow = null;
  document.querySelectorAll('.arrow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedArrow = btn.getAttribute('data-dir');
      canvas.style.cursor = 'crosshair';
    });
  });

  canvas.addEventListener('click', e => {
    if (!selectedArrow) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.font = '24px sans-serif';
    ctx.fillStyle = 'red';
    ctx.fillText(selectedArrow, x, y);

    selectedArrow = null;
    canvas.style.cursor = 'default';
  });
});
