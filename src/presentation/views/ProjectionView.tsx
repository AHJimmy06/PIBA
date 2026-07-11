import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import type { Rehearsal } from '@/core/domain/entities/Rehearsal';
import { ChordSheet } from '../components/rehearsal/ChordSheet';
import type { TransitionAnimation } from './RehearsalView';

interface SyncMessage {
  songId?: string;
  blockIndex?: number;
  backgroundUrl?: string | null;
  transitionAnimation?: TransitionAnimation;
  type: 'CHANGE_SONG' | 'CHANGE_BLOCK' | 'REQUEST_SYNC' | 'SYNC_RESPONSE' | 'CHANGE_BACKGROUND' | 'CHANGE_ANIMATION';
}

/**
 * Vista de Proyección: Solo muestra el bloque actual (diapositiva)
 * sincronizado con el líder.
 */
export const ProjectionView: React.FC = () => {
  const { rehearsalId } = useParams<{ rehearsalId: string }>();
  const { rehearsalRepository, syncService } = useDependencies();

  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentBackgroundUrl, setCurrentBackgroundUrl] = useState<string | null>(null);
  const [transitionAnimation, setTransitionAnimation] = useState<TransitionAnimation>('slide-bottom');
  const currentBackgroundUrlRef = useRef<string | null>(null);
  const rehearsalRef = useRef<Rehearsal | null>(null);

  useEffect(() => {
    currentBackgroundUrlRef.current = currentBackgroundUrl;
  }, [currentBackgroundUrl]);

  useEffect(() => {
    rehearsalRef.current = rehearsal;
  }, [rehearsal]);

  // Función para obtener las clases de animación según el tipo
  const getAnimationClass = (animation: TransitionAnimation) => {
    switch (animation) {
      case 'fade':
        return 'animate-in fade-in duration-500';
      case 'slide-bottom':
        return 'animate-in fade-in slide-in-from-bottom-4 duration-500';
      case 'slide-top':
        return 'animate-in fade-in slide-in-from-top-4 duration-500';
      case 'slide-left':
        return 'animate-in fade-in slide-in-from-left-4 duration-500';
      case 'zoom':
        return 'animate-in fade-in zoom-in-95 duration-500';
      default:
        return 'animate-in fade-in slide-in-from-bottom-4 duration-500';
    }
  };

  // Sync listener - se configura desde el inicio
  useEffect(() => {
    if (!rehearsalId) return;

    const unsubscribe = syncService.subscribe<SyncMessage>(`rehearsal-${rehearsalId}`, (msg) => {
      const currentRehearsal = rehearsalRef.current;

      if (msg.type === 'CHANGE_SONG' || msg.type === 'SYNC_RESPONSE') {
        if (currentRehearsal && msg.songId) {
          const index = currentRehearsal.songs.findIndex(s => s.songId === msg.songId);
          if (index !== -1) {
            setCurrentSongIndex(index);
            setCurrentBlockIndex(msg.blockIndex || 0);
          }
        }
        if (msg.backgroundUrl !== undefined) {
          setCurrentBackgroundUrl(msg.backgroundUrl);
        }
        if (msg.transitionAnimation) {
          setTransitionAnimation(msg.transitionAnimation);
        }
      }

      if (msg.type === 'CHANGE_BLOCK') {
        setCurrentBlockIndex(msg.blockIndex || 0);
      }

      if (msg.type === 'CHANGE_BACKGROUND') {
        setCurrentBackgroundUrl(msg.backgroundUrl || null);
      }

      if (msg.type === 'CHANGE_ANIMATION' && msg.transitionAnimation) {
        setTransitionAnimation(msg.transitionAnimation);
      }
    });

    return () => unsubscribe();
  }, [rehearsalId, syncService]);

  // Fetch del ensayo y solicitud de sync
  useEffect(() => {
    const fetchRehearsal = async () => {
      if (!rehearsalId) return;
      try {
        const data = await rehearsalRepository.getById(rehearsalId);
        setRehearsal(data);
        // Solicitar sync DESPUÉS de tener los datos
        syncService.publish(`rehearsal-${rehearsalId}`, { type: 'REQUEST_SYNC' });
      } catch (e) {
        console.error("Error loading projection data", e);
      }
    };
    fetchRehearsal();

    // Pedir fullscreen automáticamente al montar
    document.documentElement.requestFullscreen?.().catch(() => {
      // Ignorar errores si fullscreen es rechazado por el browser
    });
  }, [rehearsalId, rehearsalRepository, syncService]);

  const currentRS = rehearsal?.songs[currentSongIndex];
  const songContent = currentRS?.songDetails?.lyrics || '';

  // Dividimos en bloques igual que en la vista de ensayo
  const lyricsBlocks = songContent.split('\n\n').filter(b => b.trim() !== '');
  // Bloques con título al inicio y vacío al final
  const songTitle = currentRS?.songDetails?.title || 'SIN TÍTULO';
  const blocks = [
    songTitle,
    ...lyricsBlocks,
    '',
  ];
  const currentBlock = blocks[currentBlockIndex] || '';

  return (
    <div className="h-screen w-screen flex items-center justify-center p-16 overflow-hidden cursor-none relative">
      {/* Fondo dinámico */}
      {currentBackgroundUrl && (
        <div className="absolute inset-0 z-0">
          <img
            src={currentBackgroundUrl}
            alt="Background"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}

      {/* Sin fondo: negro puro */}
      {!currentBackgroundUrl && (
        <div className="absolute inset-0 bg-black z-0" />
      )}

      <div className="relative z-10 w-full">
        {/* En proyección nunca mostramos acordes - key para re-animar cada cambio */}
        <div
          key={`${currentSongIndex}-${currentBlockIndex}`}
          className={getAnimationClass(transitionAnimation)}
        >
          <ChordSheet
            content={currentBlock}
            showChords={false}
          />
        </div>
      </div>

      <div className="absolute bottom-4 right-4 opacity-30 text-[8px] text-white uppercase font-mono">
        PIBA LIVE | {rehearsalId?.slice(0, 8)}
      </div>
    </div>
  );
};
