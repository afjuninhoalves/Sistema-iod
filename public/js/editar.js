
document.addEventListener("DOMContentLoaded", function () {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const container = document.querySelector("#canvasContainer") || document.body;
  canvas.width = 1280;
  canvas.height = 720;
  container.appendChild(canvas);

  const img = new Image();
  img.src = document.getElementById("imgRef").dataset.src;
  img.onload = () => ctx.drawImage(img, 0, 0);

  let arrows = [];
  let currentType = null;
  let counters = { veiculo: 1, envolvido: 1, arma: 1 };

  function drawArrows() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    arrows.forEach(({ x, y, angle, type, label }) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = { veiculo: "green", envolvido: "blue", arma: "red" }[type];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-10, -20);
      ctx.lineTo(10, -20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "black";
      ctx.font = "16px Arial";
      ctx.fillText(label, x + 5, y - 5);
    });
  }

  canvas.addEventListener("click", function (e) {
    if (!currentType) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const angle = 0;
    const label = `${capitalize(currentType)} ${String(counters[currentType]).padStart(2, '0')}`;
    counters[currentType]++;
    arrows.push({ x, y, angle, type: currentType, label });
    drawArrows();
  });

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  document.getElementById("btnVeiculo").addEventListener("click", () => {
    currentType = "veiculo";
  });
  document.getElementById("btnEnvolvido").addEventListener("click", () => {
    currentType = "envolvido";
  });
  document.getElementById("btnArma").addEventListener("click", () => {
    currentType = "arma";
  });

  drawArrows();
});
