(function (root, factory) {
  const Four = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = Four;
  }
  root.Four = Four;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const planes = ["xy", "xz", "xw", "yz", "yw", "zw"];

  // 4D vector
  function vec(x = 0, y = 0, z = 0, w = 0) {
    return [x, y, z, w];
  }

  function add(a, b) {
    return a.map((v, i) => v + b[i]);
  }

  function sub(a, b) {
    return a.map((v, i) => v - b[i]);
  }

  function scale(a, s) {
    return a.map(v => v * s);
  }

  function dot(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0);
  }

  function length(a) {
    return Math.sqrt(dot(a, a));
  }

  // Rotate in any of the six 4D planes
  function rotate(p, angles = {}) {
    const v = p.slice();

    for (const plane of planes) {
      const angle = angles[plane] || 0;
      if (!angle) continue;

      const i = "xyzw".indexOf(plane[0]);
      const j = "xyzw".indexOf(plane[1]);

      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const a = v[i];
      const b = v[j];

      v[i] = a * c - b * s;
      v[j] = a * s + b * c;
    }

    return v;
  }

  // 4D -> 3D perspective projection
  function project4(p, focal = 4) {
    const k = focal / (focal - p[3]);
    return [p[0] * k, p[1] * k, p[2] * k];
  }

  // 3D -> 2D perspective projection
  function project3(p, width, height, distance = 5, zoom = 1) {
    const k = zoom * distance / (distance - p[2]);

    return [
      width / 2 + p[0] * k,
      height / 2 - p[1] * k,
      p[2]
    ];
  }

  // Create a tesseract
  function tesseract(size = 1) {
    const vertices = [];

    for (let i = 0; i < 16; i++) {
      vertices.push([
        (i & 1 ? 1 : -1) * size,
        (i & 2 ? 1 : -1) * size,
        (i & 4 ? 1 : -1) * size,
        (i & 8 ? 1 : -1) * size
      ]);
    }

    const edges = [];
    for (let i = 0; i < 16; i++) {
      for (let b = 0; b < 4; b++) {
        const j = i ^ (1 << b);
        if (i < j) edges.push([i, j]);
      }
    }

    // The 8 cubic boundary cells, represented by square faces
    const faces = [];

    for (let axis = 0; axis < 4; axis++) {
      for (let sign = 0; sign < 2; sign++) {
        const fixed = sign ? 1 : -1;
        const other = [0, 1, 2, 3].filter(i => i !== axis);

        for (let side = 0; side < 3; side++) {
          const a = other[(side + 1) % 3];
          const b = other[(side + 2) % 3];
          const fixedSide = other[side];

          for (let s = 0; s < 2; s++) {
            const sideValue = s ? 1 : -1;
            const face = [];

            for (let u = 0; u < 4; u++) {
              const p = [-1, -1, -1, -1];
              p[axis] = fixed;
              p[fixedSide] = sideValue;
              p[a] = u & 1 ? 1 : -1;
              p[b] = u & 2 ? 1 : -1;

              const index = p.reduce(
                (n, v, i) => n | (v > 0 ? 1 << i : 0), 0
              );

              face.push(index);
            }

            faces.push(face);
          }
        }
      }
    }

    return { vertices, edges, faces };
  }

  // Clip a polygon against dot(normal, point) <= offset
  function clipPolygon(poly, normal, offset) {
    if (!poly.length) return [];

    const out = [];

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];

      const da = dot(a, normal) - offset;
      const db = dot(b, normal) - offset;

      const insideA = da <= 0;
      const insideB = db <= 0;

      if (insideA) out.push(a);

      if (insideA !== insideB) {
        const t = da / (da - db);
        out.push(a.map((v, j) => v + (b[j] - v) * t));
      }
    }

    return out;
  }

  function clipLine(a, b, normal, offset) {
    const da = dot(a, normal) - offset;
    const db = dot(b, normal) - offset;

    if (da > 0 && db > 0) return null;
    if (da <= 0 && db <= 0) return [a, b];

    const t = da / (da - db);
    const p = a.map((v, i) => v + (b[i] - v) * t);

    return da > 0 ? [p, b] : [a, p];
  }

  // Draw a tesseract on a 2D canvas
  function draw(ctx, mesh, options = {}) {
    const {
      width = ctx.canvas.width,
      height = ctx.canvas.height,
      angles = {},
      mode = "wireframe",
      color = "#ffffff",
      fill = "rgba(70,160,255,0.22)",
      lineWidth = 2,
      zoom = 100,
      focal4 = 4,
      distance3 = 5,
      clip = null
    } = options;

    const transformed = mesh.vertices.map(p => rotate(p, angles));

    function clipped(polygon) {
      if (!clip) return polygon;
      return clipPolygon(polygon, clip.normal, clip.offset);
    }

    function screen(p) {
      return project3(
        project4(p, focal4),
        width, height, distance3, zoom
      );
    }

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.fillStyle = fill;

    if (mode === "solid") {
      const polygons = [];

      for (const face of mesh.faces) {
        const poly = clipped(face.map(i => transformed[i]));
        if (poly.length < 3) continue;

        const points = poly.map(screen);
        const depth = points.reduce((s, p) => s + p[2], 0) / points.length;

        polygons.push({ points, depth });
      }

      // Draw farther polygons first
      polygons.sort((a, b) => a.depth - b.depth);

      for (const item of polygons) {
        ctx.beginPath();
        ctx.moveTo(item.points[0][0], item.points[0][1]);

        for (let i = 1; i < item.points.length; i++) {
          ctx.lineTo(item.points[i][0], item.points[i][1]);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      for (const [a, b] of mesh.edges) {
        let line = [transformed[a], transformed[b]];

        if (clip) {
          line = clipLine(line[0], line[1], clip.normal, clip.offset);
          if (!line) continue;
        }

        const p = screen(line[0]);
        const q = screen(line[1]);

        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  return {
    vec,
    add,
    sub,
    scale,
    dot,
    length,
    rotate,
    planes,
    project4,
    project3,
    tesseract,
    clipPolygon,
    clipLine,
    draw
  };
});