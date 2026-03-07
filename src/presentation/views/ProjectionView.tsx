import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import type { Rehearsal } from '@/core/domain/entities/Rehearsal';
import { ChordSheet } from '../components/rehearsal/ChordSheet';

interface SyncMessage {
  songId?: string;
  blockIndex?: number;
  type: 'CHANGE_SONG' | 'CHANGE_BLOCK' | 'REQUEST_SYNC' | 'SYNC_RESPONSE';
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

  useEffect(() => {
    const fetchRehearsal = async () => {
      if (!rehearsalId) return;
      try {
        const data = await rehearsalRepository.getById(rehearsalId);
        setRehearsal(data);
      } catch (e) {
        console.error("Error loading projection data", e);
      }
    };
    fetchRehearsal();
  }, [rehearsalId, rehearsalRepository]);

  useEffect(() => {
    if (!rehearsalId || !rehearsal) return;
    
    const unsubscribe = syncService.subscribe<SyncMessage>(`rehearsal-${rehearsalId}`, (msg) => {
      if (msg.type === 'CHANGE_SONG' || msg.type === 'SYNC_RESPONSE') {
        const index = rehearsal.songs.findIndex(s => s.songId === msg.songId);
        if (index !== -1) {
          setCurrentSongIndex(index);
          setCurrentBlockIndex(msg.blockIndex || 0);
        }
      }
      
      if (msg.type === 'CHANGE_BLOCK') {
        setCurrentBlockIndex(msg.blockIndex || 0);
      }
    });

    // Petición inicial de sincronización
    syncService.publish(`rehearsal-${rehearsalId}`, { type: 'REQUEST_SYNC' });

    return () => unsubscribe();
  }, [rehearsalId, syncService, rehearsal]);

  const currentRS = rehearsal?.songs[currentSongIndex];
  const songContent = currentRS?.songDetails?.lyrics || '';
  
  // Dividimos en bloques igual que en la vista de ensayo
  const blocks = songContent.split('\n\n').filter(b => b.trim() !== '');
  const currentBlock = blocks[currentBlockIndex] || '';

  return (
    <div className="h-screen w-screen bg-black flex items-center justify-center p-16 overflow-hidden cursor-none">
      <div className="w-full animate-in fade-in duration-700">
        {/* En proyección nunca mostramos acordes */}
        <ChordSheet 
          content={currentBlock} 
          showChords={false} 
        />
      </div>
      
      <div className="absolute bottom-4 right-4 opacity-5 text-[8px] text-white uppercase font-mono">
        PIBA LIVE | {rehearsalId?.slice(0, 8)}
      </div>
    </div>
  );
};
