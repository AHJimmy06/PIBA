import React from 'react';
import { Separator } from '@/presentation/components/ui/separator';

interface ChordSheetProps {
  content: string;
  showChords: boolean;
  size?: 'normal' | 'compact';
}

/**
 * Componente que renderiza letras con acordes encima (formato ChordPro).
 * Soporta modo normal (para ensayos) y modo compacto (para modales/detalle).
 */
export const ChordSheet: React.FC<ChordSheetProps> = ({ content, showChords, size = 'normal' }) => {
  const lines = content.split('\n').filter(l => l.trim() !== "" || l === "");

  // Lógica de Auto-ajuste Estabilizada
  const getFontSize = () => {
    if (size === 'compact') return { chord: 'text-lg', lyrics: 'text-xl', gap: 'min-h-[2.5rem]', height: 'h-6', offset: 'mt-6' };

    const maxLineLength = Math.max(...lines.map(l => l.replace(/\[.*?\]/g, '').length));
    const lineCount = lines.length;

    // Escalamiento hacia abajo solo si es necesario (Baseline Size)
    if (maxLineLength > 55 || lineCount > 10) {
      return {
        chord: 'text-lg md:text-xl lg:text-2xl',
        lyrics: 'text-xl md:text-2xl lg:text-3xl',
        gap: 'min-h-[3rem]',
        height: 'h-8',
        offset: 'mt-8'
      };
    }

    // TAMAÑO ESTÁNDAR (CAP) - Evita que se haga gigante si hay poco texto
    return {
        chord: 'text-xl md:text-2xl lg:text-3xl',
        lyrics: 'text-2xl md:text-4xl lg:text-5xl',
        gap: 'min-h-[4rem]',
        height: 'h-10',
        offset: 'mt-12'
    };
  };

  const styles = getFontSize();
  const chordSize = styles.chord;
  const lyricsSize = styles.lyrics;
  const containerGap = styles.gap;
  const chordHeight = styles.height;
  const marginOffset = styles.offset;

  const renderLine = (line: string) => {
    // Detección de etiquetas de sección (ej: [CORO], [PUENTE], etc.)
    const sectionMatch = line.match(/^\[(CORO|PUENTE|VERSO|INTRO|ESTRIBILLO|FINAL|INSTRUMENTAL|SOLO|PIANO|GUITARRA).*?\]$/i);

    if (sectionMatch) {
      const sectionName = sectionMatch[1].toUpperCase();
      const colorClass =
        sectionName === 'CORO' || sectionName === 'ESTRIBILLO' ? 'bg-primary/20 text-primary border-primary/30' :
        sectionName === 'PUENTE' ? 'bg-amber-500/20 text-amber-500 border-amber-500/30' :
        sectionName === 'INTRO' || sectionName === 'FINAL' ? 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30' :
        'bg-blue-500/20 text-blue-500 border-blue-500/30';

      return (
        <div className="flex items-center gap-4 py-4 my-2">
            <div className={`px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-[0.2em] ${colorClass} shadow-lg backdrop-blur-sm`}>
                {sectionName}
            </div>
            <Separator className="flex-1 bg-border" />
        </div>
      );
    }

    const parts = line.split(/(\[.*?\])/g);
    let lastChord = "";

    return (
      <div className={`flex flex-wrap items-end justify-center ${containerGap} transition-all duration-300`}>
        {parts.map((part, i) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            lastChord = part.slice(1, -1);
            return null;
          }

          const currentChord = lastChord;
          lastChord = "";

          return (
            <div key={i} className="relative flex flex-col items-center mr-[0.2em] group">
              {showChords && currentChord && (
                <span className={`text-primary font-black ${chordSize} font-mono ${chordHeight} mb-1 select-none drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] leading-none animate-in fade-in zoom-in-75 duration-300`}>
                  {currentChord}
                </span>
              )}
              <span className={`text-foreground ${lyricsSize} font-bold whitespace-pre-wrap tracking-tight drop-shadow-sm text-center ${!currentChord && showChords ? marginOffset : ''}`}>
                {part || (currentChord ? "   " : "")}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="chord-sheet w-full flex flex-col items-center justify-center text-center">
      <div className="w-full max-w-7xl space-y-4 md:space-y-8">
        {lines.map((line, idx) => (
          <div key={idx} className="leading-none w-full flex justify-center">
            {line.trim() === "" ? <div className="h-8 md:h-12" /> : renderLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
};
