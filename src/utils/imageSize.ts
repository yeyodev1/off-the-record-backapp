/**
 * Lee el tamaño real de una imagen desde sus primeros bytes, sin decodificarla.
 *
 * Hace falta para distinguir una foto de un adorno: el contenido migrado trae
 * glifos y separadores de pocos píxeles incrustados en el texto, y tratarlos
 * como imágenes de cuerpo los estira a pantalla completa.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export function imageSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 24) return null;

  // PNG: firma de 8 bytes y el IHDR con el tamaño en 16..24
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF: "GIF8", tamaño en little-endian en 6..10
  if (buffer.toString("ascii", 0, 4) === "GIF8") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WebP dentro de RIFF
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const tipo = buffer.toString("ascii", 12, 16);
    if (tipo === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (tipo === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (tipo === "VP8X") {
      const ancho = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16));
      const alto = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16));
      return { width: ancho, height: alto };
    }
    return null;
  }

  // JPEG: hay que recorrer los marcadores hasta el SOF, que lleva el tamaño.
  if (buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2;

    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marcador = buffer[offset + 1]!;

      // SOF0..SOF15, saltando los que no describen la trama (C4, C8, CC).
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }

      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }

  return null;
}

/** Umbrales de "esto es un adorno, no una foto". */
export const DECORATIVE_MAX_SIDE = 120;
export const DECORATIVE_MAX_RATIO = 12;

/**
 * Un glifo pequeño, una línea separadora o una tira muy alargada no son
 * contenido: son decoración del maquetador viejo.
 */
export function isDecorative(size: ImageSize | null) {
  if (!size || !size.width || !size.height) return false;

  const menor = Math.min(size.width, size.height);
  const proporcion = Math.max(size.width, size.height) / menor;

  return menor <= DECORATIVE_MAX_SIDE || proporcion >= DECORATIVE_MAX_RATIO;
}
