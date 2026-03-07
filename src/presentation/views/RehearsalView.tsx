import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import type { Rehearsal, RehearsalStatus } from '@/core/domain/entities/Rehearsal';
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Play,
  Pause,
  Music2,
  Type,
  MonitorPlay,
  Edit3,
  Save,
  X,
  Zap,
  Archive,
  Layout
} from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';
import { ChordSheet } from '../components/rehearsal/ChordSheet';
import { Textarea } from '@/presentation/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';

const COMMON_CHORDS = ["C", "D", "E", "F", "G", "A", "B", "Cm", "Dm", "Em", "Am", "Bm", "Bb", "Eb", "F#", "G#", "C7", "D7", "G7"];

interface SyncMessage {
  songId?: string;
  blockIndex?: number;
  type: 'CHANGE_SONG' | 'CHANGE_BLOCK' | 'REQUEST_SYNC' | 'SYNC_RESPONSE';
}

export const RehearsalView: React.FC = () => {
  const { rehearsalId } = useParams<{ rehearsalId: string }>();
  const navigate = useNavigate();
  const { rehearsalRepository, syncService, startRehearsal, windowService, updateCustomChords, updateRehearsalStatus } = useDependencies();
  const { user } = useAuth();

  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0); // Nueva diapositiva
  const [viewMode, setViewMode] = useState<'SCROLL' | 'SLIDES'>('SLIDES');
  
  const [loading, setLoading] = useState(true);
  const [isLeader, setIsLeader] = useState(false);
  const [showChords, setShowChords] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedLyrics, setEditedLyrics] = useState('');
  const [savingChords, setSavingChords] = useState(false);
  const [activeCursorPos, setActiveCursorPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentSongIndexRef = useRef(currentSongIndex);
  const currentBlockIndexRef = useRef(currentBlockIndex);

  useEffect(() => {
    currentSongIndexRef.current = currentSongIndex;
    currentBlockIndexRef.current = currentBlockIndex;
  }, [currentSongIndex, currentBlockIndex]);

  if (!user) return <Navigate to="/" replace />;

  const fetchRehearsal = useCallback(async () => {
    if (!rehearsalId) return;
    try {
      const data = await rehearsalRepository.getById(rehearsalId);
      setRehearsal(data);
      setIsLeader(data?.leaderId === user.id);
    } catch (error) {
      console.error('Error loading rehearsal:', error);
    } finally {
      setLoading(false);
    }
  }, [rehearsalId, rehearsalRepository, user.id]);

  useEffect(() => {
    fetchRehearsal();
  }, [fetchRehearsal]);

  // Lógica de Sincronización Avanzada (Canciones y Bloques)
  useEffect(() => {
    if (!rehearsalId) return;
    const channelName = `rehearsal-${rehearsalId}`;

    const unsubscribe = syncService.subscribe<SyncMessage>(channelName, (msg) => {
      if (!isLeader && rehearsal) {
        if (msg.type === 'CHANGE_SONG' || msg.type === 'SYNC_RESPONSE') {
          const index = rehearsal.songs.findIndex(s => s.songId === msg.songId);
          if (index !== -1) {
            setCurrentSongIndex(index);
            setCurrentBlockIndex(msg.blockIndex || 0);
            setIsEditing(false);
          }
        }
        if (msg.type === 'CHANGE_BLOCK') {
          setCurrentBlockIndex(msg.blockIndex || 0);
        }
      }

      if (isLeader && msg.type === 'REQUEST_SYNC' && rehearsal) {
        syncService.publish(channelName, {
          type: 'SYNC_RESPONSE',
          songId: rehearsal.songs[currentSongIndexRef.current].songId,
          blockIndex: currentBlockIndexRef.current
        });
      }
    });

    if (!isLeader && !loading && rehearsal) {
        syncService.publish(channelName, { type: 'REQUEST_SYNC' });
    }

    return () => unsubscribe();
  }, [rehearsalId, syncService, isLeader, loading, rehearsal]);

  // Lógica de Bloques (Diapositivas)
  const currentRS = rehearsal?.songs[currentSongIndex];
  const instrument = user.defaultInstrument || 'General';
  const customVersion = currentRS?.adjustedChords.find(ac => ac.instrument === instrument);
  const fullContent = customVersion?.customChords || currentRS?.songDetails?.lyrics || '';
  
  // Dividimos la letra en bloques (estrofas) usando el doble salto de línea
  const blocks = fullContent.split('\n\n').filter(b => b.trim() !== '');

  const changeSong = useCallback((index: number) => {
    if (!rehearsal) return;
    const newIndex = Math.max(0, Math.min(index, rehearsal.songs.length - 1));
    setCurrentSongIndex(newIndex);
    setCurrentBlockIndex(0); // Reiniciar a primera diapositiva
    setIsEditing(false);

    if (isLeader) {
      syncService.publish(`rehearsal-${rehearsalId}`, {
        songId: rehearsal.songs[newIndex].songId,
        blockIndex: 0,
        type: 'CHANGE_SONG'
      });
    }
  }, [rehearsal, isLeader, syncService, rehearsalId]);

  const changeBlock = useCallback((index: number) => {
    const newBlockIndex = Math.max(0, Math.min(index, blocks.length - 1));
    setCurrentBlockIndex(newBlockIndex);

    if (isLeader) {
      syncService.publish(`rehearsal-${rehearsalId}`, {
        blockIndex: newBlockIndex,
        type: 'CHANGE_BLOCK'
      });
    }
  }, [isLeader, syncService, rehearsalId, blocks.length]);

  // Handlers de teclado para navegación rápida
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        if (currentBlockIndex < blocks.length - 1) changeBlock(currentBlockIndex + 1);
        else if (currentSongIndex < (rehearsal?.songs.length || 0) - 1) changeSong(currentSongIndex + 1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentBlockIndex > 0) changeBlock(currentBlockIndex - 1);
        else if (currentSongIndex > 0) changeSong(currentSongIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, currentBlockIndex, blocks.length, currentSongIndex, rehearsal, changeBlock, changeSong]);

  const handleUpdateStatus = async (status: RehearsalStatus) => {
    if (!rehearsalId) return;
    try {
      await updateRehearsalStatus.execute(rehearsalId, user.id, status);
      await fetchRehearsal();
      if (status === 'COMPLETED') navigate('/dashboard');
    } catch (e) { alert("Error al cambiar el estado."); }
  };

  const handleStart = async () => {
    if (!rehearsalId) return;
    try {
      await startRehearsal.execute(rehearsalId, user.id);
      await fetchRehearsal();
    } catch (e) { alert("Error al iniciar."); }
  };

  const handleOpenProjection = () => {
    if (!rehearsalId) return;
    windowService.openFullscreenWindow(`/projection/${rehearsalId}`, 'PIBA_PROJECTION');
  };

  const insertChord = (chord: string) => {
    if (activeCursorPos === null) return;
    const before = editedLyrics.substring(0, activeCursorPos);
    const after = editedLyrics.substring(activeCursorPos);
    setEditedLyrics(`${before}[${chord}]${after}`);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    setActiveCursorPos(e.currentTarget.selectionStart);
  };

  const startEditing = () => {
    setEditedLyrics(fullContent);
    setIsEditing(true);
    setActiveCursorPos(null);
  };

  const saveMyChords = async () => {
    if (!rehearsalId || !currentRS) return;
    setSavingChords(true);
    try {
      await updateCustomChords.execute(rehearsalId, currentRS.songId, instrument, editedLyrics);
      await fetchRehearsal();
      setIsEditing(false);
    } catch (e) { alert("Error al guardar tus acordes."); }
    finally { setSavingChords(false); }
  };

  if (loading) return (
    <div className="h-screen bg-[#09090b] flex items-center justify-center">
      <div className="text-zinc-500 animate-pulse font-medium tracking-widest uppercase text-xs">Sincronizando sistema...</div>
    </div>
  );

  if (!rehearsal) return (
    <div className="h-screen bg-[#09090b] flex flex-col items-center justify-center space-y-4 text-white">
      <div className="text-red-500 font-bold">Ensayo no encontrado</div>
      <Button variant="outline" onClick={() => navigate('/dashboard')} className="border-white/10">Volver</Button>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#09090b] overflow-hidden text-zinc-300 font-sans">
      {/* Sidebar: Repertorio y Mini-Slides */}
      <aside className="w-80 border-r border-white/5 bg-[#0f0f1a] flex flex-col shadow-2xl z-20">
        <div className="p-6 border-b border-white/5 flex items-center gap-4 text-left">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="hover:bg-white/5 rounded-full text-zinc-400">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="truncate">
            <h2 className="font-bold text-white truncate text-sm uppercase tracking-tighter">Panel de Control</h2>
            <div className="flex items-center gap-2 text-left">
               <div className={`h-1.5 w-1.5 rounded-full ${rehearsal.status === 'IN_PROGRESS' ? 'bg-red-500 animate-pulse' : rehearsal.status === 'READY' ? 'bg-primary' : 'bg-zinc-600'}`} />
               <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{rehearsal.status}</p>
            </div>
          </div>
        </div>
        
        {/* Navegación de Repertorio o Selector de Diapositivas */}
        {!isEditing ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                <section>
                    <p className="px-2 text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4 text-left font-mono">Diapositivas</p>
                    <div className="space-y-2">
                        {blocks.map((block, idx) => (
                            <button
                                key={idx}
                                onClick={() => isLeader && changeBlock(idx)}
                                className={`w-full text-left p-3 rounded-xl transition-all border ${
                                    idx === currentBlockIndex 
                                    ? 'bg-primary/20 border-primary text-primary shadow-lg' 
                                    : 'bg-white/[0.02] border-transparent text-zinc-500 hover:bg-white/5'
                                }`}
                            >
                                <p className="text-[10px] font-bold line-clamp-2 leading-relaxed">
                                    {block.replace(/\[.*?\]/g, '').trim()}
                                </p>
                            </button>
                        ))}
                    </div>
                </section>

                <section>
                    <p className="px-2 text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4 text-left font-mono">Canciones</p>
                    <div className="space-y-2">
                        {rehearsal.songs.map((rs, index) => (
                            <button
                                key={rs.songId}
                                onClick={() => isLeader && changeSong(index)}
                                className={`w-full text-left p-3 rounded-xl transition-all border ${
                                    index === currentSongIndex 
                                    ? 'bg-zinc-800 border-zinc-700 text-white' 
                                    : 'bg-transparent border-transparent text-zinc-600 hover:bg-white/5'
                                }`}
                            >
                                <p className="font-bold truncate text-xs">{rs.songDetails?.title}</p>
                            </button>
                        ))}
                    </div>
                </section>
            </div>
        ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <Card className="border-primary/20 bg-primary/5 rounded-2xl">
                    <CardHeader className="py-4 border-b border-white/5 text-left">
                        <CardTitle className="text-primary text-[10px] uppercase font-black tracking-widest">Selector de Acordes</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 grid grid-cols-4 gap-2">
                        {COMMON_CHORDS.map(chord => (
                            <Button key={chord} size="sm" variant="outline" onClick={() => insertChord(chord)} className="bg-white/5 border-white/10 text-white hover:bg-primary h-10 font-bold font-mono text-xs">{chord}</Button>
                        ))}
                    </CardContent>
                </Card>
            </div>
        )}

        {/* Panel Líder */}
        {isLeader && !isEditing && (
          <div className="p-6 bg-white/[0.02] border-t border-white/5 space-y-4">
            {rehearsal.status === 'PENDING' || rehearsal.status === 'PAUSED' || rehearsal.status === 'READY' ? (
              <Button onClick={handleStart} className="w-full bg-primary hover:bg-primary/90 text-white font-black h-12 rounded-xl shadow-lg shadow-primary/20">
                <Play className="h-4 w-4 mr-2 fill-current" /> 
                {rehearsal.status === 'PAUSED' ? 'REANUDAR' : rehearsal.status === 'READY' ? 'INICIAR ALABANZA' : 'EMPEZAR ENSAYO'}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" onClick={() => handleUpdateStatus('PAUSED')} className="border-white/10 text-white hover:bg-white/5 h-12 rounded-xl font-bold"><Pause className="h-4 w-4 mr-2" /> PAUSAR</Button>
                    <Button onClick={() => handleUpdateStatus('READY')} className="bg-primary hover:bg-primary/90 text-white font-black h-12 rounded-xl shadow-lg shadow-primary/20"><Zap className="h-4 w-4 mr-2 fill-current" /> LISTO</Button>
                </div>
                <Button variant="ghost" onClick={() => handleUpdateStatus('COMPLETED')} className="text-zinc-600 hover:text-zinc-400 text-[10px] font-black uppercase tracking-widest mt-2"><Archive className="h-3 w-3 mr-2" /> Finalizar y Archivar</Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Visor Principal (Slides o Scroll) */}
      <main className="flex-1 flex flex-col relative bg-[#09090b]">
        <header className="h-24 px-10 flex justify-between items-center bg-[#09090b] border-b border-white/5 backdrop-blur-xl z-10">
          <div className="flex items-center gap-5">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
               <Music2 className="h-6 w-6 text-primary" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-black text-white tracking-tight leading-none mb-1">{currentRS?.songDetails?.title}</h1>
              <div className="flex items-center gap-3">
                 <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px] font-bold tracking-widest uppercase">
                    {customVersion ? `VERSION PERSONALIZADA` : `TONO ORIGINAL: ${currentRS?.songDetails?.baseChords}`}
                 </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             {!isEditing ? (
                <>
                    <Button 
                        variant="outline" 
                        onClick={() => setViewMode(viewMode === 'SCROLL' ? 'SLIDES' : 'SCROLL')}
                        className={`rounded-xl h-11 px-5 font-bold border-white/10 bg-white/5 text-zinc-400 hover:text-white transition-all ${viewMode === 'SLIDES' ? 'bg-zinc-800 border-zinc-600 text-white' : ''}`}
                    >
                        <Layout className="h-4 w-4 mr-2" /> {viewMode === 'SLIDES' ? 'MODO DIAPOSITIVA' : 'MODO LECTURA'}
                    </Button>
                    <Button variant="outline" onClick={startEditing} className="rounded-xl h-11 px-5 font-bold border-white/10 bg-white/5 text-zinc-400 hover:text-white"><Edit3 className="h-4 w-4 mr-2 text-primary" /> AJUSTAR ACORDES</Button>
                </>
             ) : (
                <div className="flex gap-2">
                    <Button onClick={saveMyChords} disabled={savingChords} className="bg-green-600 hover:bg-green-500 text-white rounded-xl h-11 px-5 font-bold"><Save className="h-4 w-4 mr-2" /> GUARDAR</Button>
                    <Button variant="ghost" onClick={() => setIsEditing(false)} className="text-zinc-500 hover:text-white h-11 w-11 p-0 rounded-full"><X className="h-5 w-5" /></Button>
                </div>
             )}

             {isLeader && !isEditing && (
               <Button variant="outline" onClick={handleOpenProjection} className="rounded-xl h-11 px-5 font-bold border-white/10 bg-white/5 text-zinc-400 hover:text-white"><MonitorPlay className="h-4 w-4 mr-2 text-primary" /> PROYECTAR</Button>
             )}

             {!isEditing && (
                <Button variant="outline" size="sm" onClick={() => setShowChords(!showChords)} className={`rounded-xl h-11 px-5 font-bold border-white/10 transition-all ${showChords ? 'bg-primary text-white border-primary' : 'bg-white/5 text-zinc-500 hover:text-white'}`}><Type className="h-4 w-4 mr-2" /> ACORDES</Button>
             )}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 md:p-20 scrollbar-hide select-none flex items-center justify-center">
          {isEditing ? (
            <div className="max-w-4xl mx-auto w-full h-full flex flex-col space-y-4">
                <Textarea 
                    ref={textareaRef}
                    value={editedLyrics}
                    onChange={(e) => setEditedLyrics(e.target.value)}
                    onClick={handleTextareaClick}
                    className="flex-1 min-h-[500px] bg-white/[0.02] border-white/10 text-white p-8 font-mono text-xl leading-relaxed rounded-3xl"
                />
            </div>
          ) : (
            <div className="w-full max-w-5xl animate-in fade-in zoom-in-95 duration-500">
                {viewMode === 'SLIDES' ? (
                    <ChordSheet content={blocks[currentBlockIndex] || ''} showChords={showChords} />
                ) : (
                    <ChordSheet content={fullContent} showChords={showChords} />
                )}
            </div>
          )}
        </div>

        {/* Floating Navigator */}
        {!isEditing && (
            <footer className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-8 bg-[#18181b]/80 backdrop-blur-3xl px-8 py-4 rounded-[2.5rem] border border-white/10 shadow-2xl ring-1 ring-white/5">
                <Button variant="ghost" size="icon" disabled={currentSongIndex === 0 && currentBlockIndex === 0} onClick={() => currentBlockIndex > 0 ? changeBlock(currentBlockIndex - 1) : changeSong(currentSongIndex - 1)} className="text-white hover:bg-white/10 rounded-2xl h-14 w-14 transition-all"><ChevronLeft className="h-10 w-10" /></Button>
                
                <div className="flex flex-col items-center min-w-[120px]">
                    <span className="text-[10px] text-primary font-black uppercase tracking-[0.3em] mb-1">DIAPOSITIVA</span>
                    <span className="text-2xl font-black text-white font-mono">
                        {String(currentBlockIndex + 1).padStart(2, '0')} <span className="text-zinc-700 mx-1">/</span> {String(blocks.length).padStart(2, '0')}
                    </span>
                </div>

                <Button variant="ghost" size="icon" disabled={currentSongIndex === rehearsal.songs.length - 1 && currentBlockIndex === blocks.length - 1} onClick={() => currentBlockIndex < blocks.length - 1 ? changeBlock(currentBlockIndex + 1) : changeSong(currentSongIndex + 1)} className="text-white hover:bg-white/10 rounded-2xl h-14 w-14 transition-all"><ChevronRight className="h-10 w-10" /></Button>
            </footer>
        )}
      </main>
    </div>
  );
};
