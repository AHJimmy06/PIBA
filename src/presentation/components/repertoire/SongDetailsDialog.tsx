import React from 'react';
import type { Song } from '@/core/domain/entities/Song';
import { ChordSheet } from '../rehearsal/ChordSheet';
import { 
  X, 
  Music2, 
  User as UserIcon, 
  Type
} from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';

interface Props {
  song: Song;
  onClose: () => void;
}

/**
 * Modal de detalle de canción para previsualización rápida en el repertorio.
 */
export const SongDetailsDialog: React.FC<Props> = ({ song, onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div 
        className="bg-[#0f0f1a] border border-white/10 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <header className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-5">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <Music2 className="h-7 w-7 text-primary" />
            </div>
            <div className="text-left">
              <h2 className="text-3xl font-black text-white tracking-tight leading-tight">{song.title}</h2>
              <p className="text-zinc-400 font-medium flex items-center gap-2 mt-1">
                <UserIcon className="h-4 w-4 text-zinc-600" /> {song.author}
              </p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="rounded-full text-zinc-500 hover:text-white hover:bg-white/10 h-12 w-12"
          >
            <X className="h-8 w-8" />
          </Button>
        </header>

        {/* Letras y Acordes */}
        <div className="flex-1 overflow-y-auto p-10 md:p-16 custom-scrollbar bg-[#09090b]">
            <div className="max-w-3xl mx-auto">
                <section className="space-y-6">
                    <div className="flex items-center gap-3 text-zinc-600 uppercase text-[10px] font-black tracking-[0.3em] mb-8">
                        <Type className="h-4 w-4" /> VISTA PREVIA DEL REPERTORIO
                    </div>
                    <ChordSheet content={song.lyrics} showChords={true} size="compact" />
                </section>
            </div>
        </div>

        {/* Footer */}
        <footer className="p-6 border-t border-white/5 bg-white/[0.02] flex justify-between items-center">
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Tono Base:</span>
                <span className="px-3 py-1 bg-zinc-800 text-primary rounded-lg font-mono font-bold text-xs">{song.baseChords}</span>
            </div>
            <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-tighter">PIBA - Plataforma de Alabanza</p>
        </footer>
      </div>
    </div>
  );
};
