import { stripHtml } from "./content.service";

export interface SpellIssue {
  message: string;
  excerpt: string;
  suggestion: string;
  rule: string;
  severity: "error" | "warning" | "style";
  offset: number;
  length: number;
}

export interface SpellReport {
  score: number;
  engine: string;
  issues: SpellIssue[];
  checkedAt: Date;
}

interface Rule {
  id: string;
  pattern: RegExp;
  message: string;
  suggestion: (match: RegExpExecArray) => string;
  severity: "error" | "warning" | "style";
}

/**
 * Offline Spanish proofreading rules. They cover the mistakes a newsroom
 * actually ships: missing opening marks, duplicated words, common
 * homophone confusions, spacing around punctuation and stray capitals.
 */
const RULES: Rule[] = [
  {
    id: "repeated-word",
    pattern: /\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\s+\1\b/gi,
    message: "Palabra repetida",
    suggestion: (m) => m[1],
    severity: "error",
  },
  {
    id: "double-space",
    pattern: /[^\S\n]{2,}/g,
    message: "Espacio doble",
    suggestion: () => " ",
    severity: "style",
  },
  {
    id: "space-before-punctuation",
    pattern: /\s+([,.;:!?])/g,
    message: "Espacio antes de signo de puntuación",
    suggestion: (m) => m[1],
    severity: "warning",
  },
  {
    id: "missing-space-after-punctuation",
    pattern: /([,;:])(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g,
    message: "Falta espacio después del signo",
    suggestion: (m) => `${m[1]} `,
    severity: "warning",
  },
  {
    id: "missing-opening-question",
    pattern: /(^|[.!?\n]\s*)(?!¿)([^.!?\n]{3,120}\?)/g,
    message: "Falta el signo de apertura ¿",
    suggestion: (m) => `${m[1]}¿${m[2]}`,
    severity: "error",
  },
  {
    id: "missing-opening-exclamation",
    pattern: /(^|[.?\n]\s*)(?!¡)([^.!?\n]{3,120}!)/g,
    message: "Falta el signo de apertura ¡",
    suggestion: (m) => `${m[1]}¡${m[2]}`,
    severity: "error",
  },
  {
    id: "haber-a-ver",
    pattern: /\bhaber\s+si\b/gi,
    message: "«haber si» debería ser «a ver si»",
    suggestion: () => "a ver si",
    severity: "error",
  },
  {
    id: "porque-interrogativo",
    pattern: /¿\s*porque\b/gi,
    message: "En pregunta se escribe «por qué»",
    suggestion: () => "¿por qué",
    severity: "error",
  },
  {
    id: "osea",
    pattern: /\bosea\b/gi,
    message: "«osea» debería ser «o sea»",
    suggestion: () => "o sea",
    severity: "error",
  },
  {
    id: "sino-si-no",
    pattern: /\bsi\s+no\s+que\b/gi,
    message: "«si no que» debería ser «sino que»",
    suggestion: () => "sino que",
    severity: "warning",
  },
  {
    id: "aún-aun",
    pattern: /\baun\s+asi\b/gi,
    message: "«aun asi» debería ser «aun así»",
    suggestion: () => "aun así",
    severity: "warning",
  },
  {
    id: "sin-tilde-comunes",
    pattern: /\b(mas|mi|tu|el|si|se|de|te)\s+(?=mismo|misma)\b/g,
    message: "Revisa la tilde diacrítica",
    suggestion: (m) => m[1],
    severity: "style",
  },
  {
    id: "dequeismo",
    pattern: /\b(pienso|creo|opino|considero|dijo|afirmo|afirmó)\s+de\s+que\b/gi,
    message: "Posible dequeísmo",
    suggestion: (m) => `${m[1]} que`,
    severity: "warning",
  },
  {
    id: "numero-sin-espacio",
    pattern: /\b(\d+)(%|USD|km|kg|m2)\b/g,
    message: "Falta espacio entre cifra y unidad",
    suggestion: (m) => `${m[1]} ${m[2]}`,
    severity: "style",
  },
  {
    id: "triple-punto",
    pattern: /\.{4,}/g,
    message: "Usa puntos suspensivos (…) de tres puntos",
    suggestion: () => "...",
    severity: "style",
  },
  {
    id: "lowercase-after-period",
    pattern: /[.!?]\s+([a-záéíóúüñ])/g,
    message: "Minúscula después de punto",
    suggestion: (m) => m[1].toUpperCase(),
    severity: "warning",
  },
];

const COMMON_MISSPELLINGS: Record<string, string> = {
  aser: "hacer",
  asia: "hacia",
  ay: "hay",
  echo: "hecho",
  vaya: "valla",
  halla: "haya",
  travez: "través",
  atravez: "a través",
  enserio: "en serio",
  apesar: "a pesar",
  dealgun: "de algún",
  porfavor: "por favor",
  talvez: "tal vez",
  sinembargo: "sin embargo",
  demas: "demás",
  esque: "es que",
  aveces: "a veces",
  encima: "encima",
  conmigo: "conmigo",
  desicion: "decisión",
  desiciones: "decisiones",
  govierno: "gobierno",
  jueves: "jueves",
  privilegio: "privilegio",
  exhorbitante: "exorbitante",
  expontaneo: "espontáneo",
  concientizar: "concienciar",
  hechar: "echar",
  haiga: "haya",
  nadien: "nadie",
  cercano: "cercano",
};

function excerptAround(text: string, offset: number, length: number) {
  const start = Math.max(0, offset - 32);
  const end = Math.min(text.length, offset + length + 32);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

export function proofread(input: string): SpellReport {
  const text = stripHtml(input, { collapseSpaces: false });
  const issues: SpellIssue[] = [];

  if (!text) {
    return { score: 100, engine: "otr-es-rules", issues: [], checkedAt: new Date() };
  }

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let guard = 0;

    while ((match = rule.pattern.exec(text)) !== null && guard < 200) {
      guard += 1;
      if (match[0].length === 0) {
        rule.pattern.lastIndex += 1;
        continue;
      }

      issues.push({
        message: rule.message,
        excerpt: excerptAround(text, match.index, match[0].length),
        suggestion: rule.suggestion(match),
        rule: rule.id,
        severity: rule.severity,
        offset: match.index,
        length: match[0].length,
      });
    }
  }

  const wordPattern = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/g;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = wordPattern.exec(text)) !== null) {
    const lower = wordMatch[0].toLowerCase();
    const fix = COMMON_MISSPELLINGS[lower];
    if (fix && fix !== lower) {
      issues.push({
        message: `Posible error ortográfico: «${wordMatch[0]}»`,
        excerpt: excerptAround(text, wordMatch.index, wordMatch[0].length),
        suggestion: fix,
        rule: "diccionario",
        severity: "error",
        offset: wordMatch.index,
        length: wordMatch[0].length,
      });
    }
  }

  issues.sort((a, b) => a.offset - b.offset);

  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const weight = issues.reduce((total, issue) => total + (issue.severity === "error" ? 3 : issue.severity === "warning" ? 2 : 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - (weight / words) * 100)));

  return {
    score,
    engine: "otr-es-rules",
    issues: issues.slice(0, 120),
    checkedAt: new Date(),
  };
}
