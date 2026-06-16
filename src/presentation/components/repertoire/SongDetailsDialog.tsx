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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/presentation/components/ui/dialog';

interface Props {
  song: Song;
  onClose: () => void;
}

/**
 * Modal de detalle de canción para previsualización rápida en el repertorio.
 */
export const SongDetailsDialog: React.FC<Props> = ({ song, onClose }) => {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">
        <DialogHeader className="p-6 border-b border-border flex justify-between items-center bg-accent/50">
          <div className="flex items-center gap-5">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <Music2 className="h-7 w-7 text-primary" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-3xl font-black text-foreground tracking-tight leading-tight">{song.title}</DialogTitle>
              <DialogDescription className="font-medium flex items-center gap-2 mt-1 text-muted-foreground">
                <UserIcon className="h-4 w-4 text-muted-foreground" /> {song.author}
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full text-muted-foreground hover:text-foreground hover:bg-accent h-12 w-12"
          >
            <X className="h-8 w-8" />
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-10 md:p-16 custom-scrollbar bg-background">
          <div className="max-w-3xl mx-auto">
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-muted-foreground uppercase text-[10px] font-black tracking-[0.3em] mb-8">
                <Type className="h-4 w-4" /> VISTA PREVIA DEL REPERTORIO
              </div>
              <ChordSheet content={song.lyrics} showChords={true} size="compact" />
            </section>
          </div>
        </div>

        <DialogFooter className="p-6 border-t border-border bg-accent/50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Tono Base:</span>
            <span className="px-3 py-1 bg-input text-primary rounded-lg font-mono font-bold text-xs">{song.baseChords}</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">PIBA - Plataforma de Alabanza</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
