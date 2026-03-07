import React from 'react';

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
  const lines = content.split('\n');

  // Ajuste de tamaños según el prop 'size'
  const chordSize = size === 'compact' ? 'text-lg md:text-xl' : 'text-2xl md:text-3xl lg:text-4xl';
  const lyricsSize = size === 'compact' ? 'text-xl md:text-2xl' : 'text-2xl md:text-3xl lg:text-5xl';
  const containerGap = size === 'compact' ? 'min-h-[2.5rem]' : 'min-h-[4.5rem]';
  const chordHeight = size === 'compact' ? 'h-6' : 'h-10';
  const marginOffset = size === 'compact' ? 'mt-6' : 'mt-12';

  const renderLine = (line: string) => {
    const parts = line.split(/(\[.*?\])/g);
    let lastChord = "";

    return (
      <div className={`flex flex-wrap items-end ${containerGap}`}>
        {parts.map((part, i) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            lastChord = part.slice(1, -1);
            return null;
          }

          const currentChord = lastChord;
          lastChord = "";

          return (
            <div key={i} className="relative flex flex-col items-start mr-[0.2em] transition-all">
              {showChords && currentChord && (
                <span className={`text-primary font-black ${chordSize} font-mono ${chordHeight} mb-1 select-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] leading-none`}>
                  {currentChord}
                </span>
              )}
              <span className={`text-white ${lyricsSize} font-bold whitespace-pre-wrap tracking-tight ${!currentChord && showChords ? marginOffset : ''}`}>
                {part || (currentChord ? "   " : "")}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="chord-sheet w-full flex flex-col items-center">
      <div className="w-full max-w-6xl space-y-4 md:space-y-8">
        {lines.map((line, idx) => (
          <div key={idx} className="leading-none">
            {line.trim() === "" ? <div className="h-8 md:h-12" /> : renderLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
};
