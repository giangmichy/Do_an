export function drawBoundingBoxes(
  imageData: string,
  boxes: Array<{
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    label?: string;
    model?: string;
    score?: number;
    confidence?: number;
  }>,
  colors?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Default colors for different models
      const defaultColors: Record<string, string> = {
        co3soc: "#FF0000", // Red (đỏ)
        duongluoibo: "#00FF00", // Green (xanh lá)
        vnmap: "#0000FF", // Blue (xanh dương)
        ...colors,
      };

      // Draw bounding boxes
      boxes.forEach((box) => {
        // Support multiple coordinate formats
        const x1 = box.x1 ?? box.x ?? 0;
        const y1 = box.y1 ?? box.y ?? 0;
        const x2 =
          box.x2 ??
          (box.x !== undefined && box.width !== undefined
            ? box.x + box.width
            : x1);
        const y2 =
          box.y2 ??
          (box.y !== undefined && box.height !== undefined
            ? box.y + box.height
            : y1);
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        const modelName = box.model || box.label || "Object";
        const color = defaultColors[modelName] || "#ff3b30";
        const lineWidth = 3;

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x1, y1, boxWidth, boxHeight);

        // Draw label
        const score = box.score ?? box.confidence ?? 0;
        const label = `${modelName} ${(score * 100).toFixed(0)}%`;
        const fontSize = 14;
        ctx.font = `bold ${fontSize}px Arial`;
        const textWidth = ctx.measureText(label).width;

        // Label background
        ctx.fillStyle = color;
        ctx.fillRect(x1, y1 - fontSize - 8, textWidth + 10, fontSize + 8);

        // Label text
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, x1 + 5, y1 - 6);
      });

      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageData;
  });
}
