import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Transpone acordes dentro de un texto. 
 * Busca patrones tipo [C#m7] y los desplaza n semitonos.
 */
export function transposeChords(text: string, semitones: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Mapeo de bemoles a sostenidos para normalizar
  const flatMap: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
  };

  return text.replace(/\[([A-G][b#]?)(.*?)\]/g, (match, root, suffix) => {
    // 1. Normalizar nota (Bemol -> Sostenido)
    let normalizedRoot = flatMap[root] || root;

    // 2. Encontrar índice actual
    const currentIndex = notes.indexOf(normalizedRoot);
    if (currentIndex === -1) return match; // No es una nota válida

    // 3. Calcular nuevo índice
    let newIndex = (currentIndex + semitones) % 12;
    if (newIndex < 0) newIndex += 12;

    // 4. Reconstruir acorde
    return `[${notes[newIndex]}${suffix}]`;
  });
}
