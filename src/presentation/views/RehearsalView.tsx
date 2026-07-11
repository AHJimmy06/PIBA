import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import type { Rehearsal, RehearsalStatus } from '@/core/domain/entities/Rehearsal';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Music2,
  Image as ImageIcon,
  Type,
  MonitorPlay,
  Edit3,
  Save,
  X,
  Zap,
  Archive,
  Layout,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw
} from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';
import { ChordSheet } from '../components/rehearsal/ChordSheet';
import { BackgroundManager } from '../components/rehearsal/BackgroundManager';
import { Textarea } from '@/presentation/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { Badge } from '@/presentation/components/ui/badge';
import { transposeChords } from '@/lib/utils';
import type { BackgroundAsset } from '@/core/domain/entities/BackgroundAsset';

const COMMON_CHORDS = ["C", "D", "E", "F", "G", "A", "B", "Cm", "Dm", "Em", "Am", "Bm", "Bb", "Eb", "F#", "G#", "C7", "D7", "G7"];

export type TransitionAnimation = 'fade' | 'slide-bottom' | 'slide-top' | 'slide-left' | 'zoom';

interface SyncMessage {
  songId?: string;
  blockIndex?: number;
  backgroundUrl?: string | null;
  transitionAnimation?: TransitionAnimation;
  type: 'CHANGE_SONG' | 'CHANGE_BLOCK' | 'REQUEST_SYNC' | 'SYNC_RESPONSE' | 'CHANGE_BACKGROUND' | 'CHANGE_ANIMATION';
}

export const RehearsalView: React.FC = () => {
  const { rehearsalId } = useParams<{ rehearsalId: string }>();
  const navigate = useNavigate();
  const { rehearsalRepository, syncService, startRehearsal, windowService, updateCustomChords, updateRehearsalStatus } = useDependencies();
  const { user } = useAuth();

  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'SCROLL' | 'SLIDES'>('SLIDES');

  const [loading, setLoading] = useState(true);
  const [isLeader, setIsLeader] = useState(false);
  const [showChords, setShowChords] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [bpm, setBpm] = useState(70);
  const [isMetronomeActive, setIsMetronomeActive] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editedLyrics, setEditedLyrics] = useState('');
  const [savingChords, setSavingChords] = useState(false);
  const [activeCursorPos, setActiveCursorPos] = useState<number | null>(null);
  const [showBackgroundManager, setShowBackgroundManager] = useState(false);
  const [currentBackgroundUrl, setCurrentBackgroundUrl] = useState<string | null>(null);
  const [slidesExpanded, setSlidesExpanded] = useState(true);
  const [repertoireExpanded, setRepertoireExpanded] = useState(true);
  const [transitionAnimation, setTransitionAnimation] = useState<TransitionAnimation>('slide-bottom');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentSongIndexRef = useRef(currentSongIndex);
  const currentBlockIndexRef = useRef(currentBlockIndex);
  const currentBackgroundUrlRef = useRef(currentBackgroundUrl);
  const transitionAnimationRef = useRef(transitionAnimation);

  useEffect(() => {
    currentSongIndexRef.current = currentSongIndex;
    currentBlockIndexRef.current = currentBlockIndex;
    currentBackgroundUrlRef.current = currentBackgroundUrl;
    transitionAnimationRef.current = transitionAnimation;
  }, [currentSongIndex, currentBlockIndex, currentBackgroundUrl, transitionAnimation]);

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
          if (msg.backgroundUrl !== undefined) setCurrentBackgroundUrl(msg.backgroundUrl);
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
      }

      if (isLeader && msg.type === 'REQUEST_SYNC' && rehearsal) {
        syncService.publish(channelName, {
          type: 'SYNC_RESPONSE',
          songId: rehearsal.songs[currentSongIndexRef.current].songId,
          blockIndex: currentBlockIndexRef.current,
          backgroundUrl: currentBackgroundUrlRef.current,
          transitionAnimation: transitionAnimationRef.current
        });
      }
    });

    if (!isLeader && !loading && rehearsal) {
        syncService.publish(channelName, { type: 'REQUEST_SYNC' });
    }

    return () => unsubscribe();
  }, [rehearsalId, syncService, isLeader, loading, rehearsal]);

  const currentRS = rehearsal?.songs[currentSongIndex];
  const instrument = user.defaultInstrument || 'General';
  const customVersion = currentRS?.adjustedChords.find(ac => ac.instrument === instrument);
  const fullContent = customVersion?.customChords || currentRS?.songDetails?.lyrics || '';

  const lyricsBlocks = fullContent.split('\n\n').filter(b => b.trim() !== '');
  // Bloques con título al inicio y vacío al final
  const songTitle = currentRS?.songDetails?.title || 'SIN TÍTULO';
  const blocks = [
    songTitle,  // Slide de título
    ...lyricsBlocks,
    '',                   // Slide vacío al final
  ];

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

  // Auto-scroll al bloque actual en modo LECTURA
  useEffect(() => {
    if (viewMode === 'SCROLL') {
      // Delay para asegurar que el DOM del modo LECTURA esté renderizado
      const timer = setTimeout(() => {
        const scrollContainer = document.querySelector('.space-y-12');
        if (scrollContainer) {
          const blockElements = scrollContainer.querySelectorAll(':scope > div');
          if (blockElements[currentBlockIndex]) {
            blockElements[currentBlockIndex].scrollIntoView({
              behavior: 'instant',
              block: 'center',
            });
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentBlockIndex, viewMode]);

  const handleSelectBackground = async (bg: BackgroundAsset) => {
    if (!rehearsalId) return;
    try {
        await rehearsalRepository.setBackground(rehearsalId, bg.id);
        setCurrentBackgroundUrl(bg.publicUrl);
        syncService.publish(`rehearsal-${rehearsalId}`, {
            type: 'CHANGE_BACKGROUND',
            backgroundUrl: bg.publicUrl
        });
        setShowBackgroundManager(false);
    } catch (e) {
        alert("Error al cambiar el fondo.");
    }
  };

  const handleSelectAnimation = (animation: TransitionAnimation) => {
    if (!rehearsalId) return;
    setTransitionAnimation(animation);
    syncService.publish(`rehearsal-${rehearsalId}`, {
      type: 'CHANGE_ANIMATION',
      transitionAnimation: animation
    });
  };

  const changeSong = useCallback((index: number) => {
    if (!rehearsal) return;
    const newIndex = Math.max(0, Math.min(index, rehearsal.songs.length - 1));
    setCurrentSongIndex(newIndex);
    setCurrentBlockIndex(0);
    setIsEditing(false);

    if (isLeader) {
      syncService.publish(`rehearsal-${rehearsalId}`, {
        songId: rehearsal.songs[newIndex].songId,
        blockIndex: 0,
        type: 'CHANGE_SONG',
        backgroundUrl: currentBackgroundUrlRef.current
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

  const handleTranspose = (semitones: number) => {
    const newLyrics = transposeChords(editedLyrics, semitones);
    setEditedLyrics(newLyrics);
  };

  const resetToOriginal = () => {
    if (currentRS?.songDetails?.lyrics) {
      setEditedLyrics(currentRS.songDetails.lyrics);
    }
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
    <div className="h-screen bg-background flex items-center justify-center">
      <div className="text-muted-foreground animate-pulse font-medium tracking-widest uppercase text-xs">Sincronizando sistema...</div>
    </div>
  );

  if (!rehearsal) return (
    <div className="h-screen bg-background flex flex-col items-center justify-center space-y-4 text-foreground">
      <div className="text-red-500 font-bold">Ensayo no encontrado</div>
      <Button variant="outline" onClick={() => navigate('/dashboard')} className="border-border">Volver</Button>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden text-muted-foreground font-sans selection:bg-primary/30 relative">

      {/* Sidebar Colapsable */}
      <aside className={`relative border-r border-border bg-background/95 backdrop-blur-md flex flex-col shadow-2xl z-20 transition-all duration-500 ease-in-out ${isSidebarCollapsed ? 'w-16' : 'w-80'}`}>
        {/* Toggle Button */}
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-4 top-10 h-8 w-8 bg-muted border-border rounded-full flex items-center justify-center shadow-2xl hover:bg-primary transition-all z-30 group"
        >
          {isSidebarCollapsed ? <ChevronRight className="h-3 w-3 text-foreground group-hover:scale-125 transition-transform" /> : <ChevronLeft className="h-3 w-3 text-foreground group-hover:scale-125 transition-transform" />}
        </button>

        <div className={`p-6 border-b border-border flex items-center gap-4 text-left overflow-hidden ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}>
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="hover:bg-accent rounded-full text-muted-foreground shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {!isSidebarCollapsed && (
            <div className="truncate text-left animate-in fade-in slide-in-from-left-4 duration-500">
                <h2 className="font-bold text-foreground truncate text-xs uppercase tracking-widest opacity-70">Panel de Control</h2>
                <div className="flex items-center gap-2 mt-0.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${rehearsal.status === 'IN_PROGRESS' ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]' : rehearsal.status === 'READY' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-muted'}`} />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">{rehearsal.status}</p>
                </div>
            </div>
          )}
        </div>

        {!isEditing ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar overflow-x-hidden">
                {/* Metrónomo Visual */}
                {!isSidebarCollapsed && (
                  <section className="px-2 animate-in zoom-in-95 duration-700">
                    <div className="bg-accent/50 border border-border rounded-2xl p-4 space-y-4 shadow-inner">
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em]">Metrónomo</p>
                        <div className={`h-2 w-2 rounded-full transition-all duration-75 ${isMetronomeActive ? 'bg-primary animate-pulse-fast shadow-[0_0_12px_rgba(var(--primary),0.8)]' : 'bg-muted'}`} />
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-2xl font-black text-foreground font-mono w-12 text-left">{bpm}</span>
                        <input
                          type="range" min="40" max="220" value={bpm}
                          onChange={(e) => setBpm(parseInt(e.target.value))}
                          className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsMetronomeActive(!isMetronomeActive)}
                          className={`h-8 w-8 p-0 rounded-lg transition-all ${isMetronomeActive ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'}`}
                        >
                          <Zap className="h-4 w-4 fill-current" />
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                {/* Fondos de Pantalla */}
                {!isSidebarCollapsed && isLeader && (
                  <section className="px-2 animate-in fade-in duration-500 delay-150">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-3 font-mono">Apariencia</p>
                    <Button
                      variant="outline"
                      onClick={() => setShowBackgroundManager(true)}
                      className="w-full bg-accent/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/50 h-12 rounded-2xl flex justify-between px-4 transition-all group mb-2"
                    >
                      <div className="flex items-center gap-3">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-tight">Cambiar Fondo</span>
                      </div>
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Button>

                    {/* Selector de animación */}
                    <div className="bg-accent/50 border border-border rounded-2xl p-3 space-y-2">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em]">Transición</p>
                      <div className="grid grid-cols-5 gap-1">
                        {(['fade', 'slide-bottom', 'slide-top', 'slide-left', 'zoom'] as TransitionAnimation[]).map((anim) => (
                          <button
                            key={anim}
                            onClick={() => handleSelectAnimation(anim)}
                            className={`p-2 rounded-lg text-[8px] font-black uppercase tracking-tight transition-all ${
                              transitionAnimation === anim
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-primary/20'
                            }`}
                          >
                            {anim === 'fade' && 'Fade'}
                            {anim === 'slide-bottom' && '↓'}
                            {anim === 'slide-top' && '↑'}
                            {anim === 'slide-left' && '←'}
                            {anim === 'zoom' && 'Zoom'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* Repertorio */}
                <section>
                    {!isSidebarCollapsed ? (
                      <div className="flex items-center justify-between px-2 mb-4">
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] font-mono animate-in fade-in duration-500">Repertorio</p>
                        <button
                          onClick={() => setRepertoireExpanded(!repertoireExpanded)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {repertoireExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-center mb-4"><Music2 className="h-4 w-4 text-muted" /></div>
                    )}
                    {repertoireExpanded && (
                      <div className="space-y-2">
                          {rehearsal.songs.map((rs, index) => (
                              <button
                                  key={rs.songId}
                                  onClick={() => isLeader && changeSong(index)}
                                  className={`w-full text-left rounded-xl transition-all border group relative ${
                                      index === currentSongIndex
                                      ? 'bg-muted border-muted-foreground/50 text-foreground shadow-xl'
                                      : 'bg-transparent border-transparent text-muted-foreground hover:bg-accent'
                                  } ${isSidebarCollapsed ? 'p-3 flex justify-center' : 'p-4'}`}
                              >
                                  {isSidebarCollapsed ? (
                                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-black text-[10px] ${index === currentSongIndex ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                                      {index + 1}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-3">
                                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${index === currentSongIndex ? 'bg-primary/20 text-primary' : 'bg-muted text-muted'}`}>
                                        <Music2 className="h-4 w-4" />
                                      </div>
                                      <p className="font-black truncate text-xs uppercase tracking-tight">{rs.songDetails?.title}</p>
                                    </div>
                                  )}
                              </button>
                          ))}
                      </div>
                    )}
                </section>

                {/* Diapositivas */}
                <section>
                    {!isSidebarCollapsed ? (
                      <div className="flex items-center justify-between px-2 mb-4">
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] font-mono animate-in fade-in duration-500">Diapositivas</p>
                        <button
                          onClick={() => setSlidesExpanded(!slidesExpanded)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {slidesExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-center mb-4"><Layout className="h-4 w-4 text-muted" /></div>
                    )}
                    {slidesExpanded && (
                      <div className="space-y-2">
                          {blocks.map((block, idx) => (
                              <button
                                  key={idx}
                                  onClick={() => isLeader && changeBlock(idx)}
                                  className={`w-full text-left rounded-xl transition-all border group relative ${
                                      idx === currentBlockIndex
                                      ? 'bg-primary/20 border-primary text-primary shadow-lg shadow-primary/10'
                                      : 'bg-accent/50 border-transparent text-muted-foreground hover:bg-accent'
                                  } ${isSidebarCollapsed ? 'p-3 flex justify-center' : 'p-3'}`}
                              >
                                  {isSidebarCollapsed ? (
                                    <span className="text-[10px] font-black">{idx + 1}</span>
                                  ) : (
                                    <p className="text-[10px] font-bold line-clamp-2 leading-relaxed">
                                        {block.replace(/\[.*?\]/g, '').trim()}
                                    </p>
                                  )}
                                  {idx === currentBlockIndex && !isSidebarCollapsed && (
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 h-1 w-1 bg-primary rounded-full" />
                                  )}
                              </button>
                          ))}
                      </div>
                    )}
                </section>
            </div>
        ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                <Card className={`border-border bg-accent rounded-2xl overflow-hidden ${isSidebarCollapsed ? 'hidden' : ''}`}>
                    <CardHeader className="py-4 border-b border-border text-left bg-accent/50">
                        <CardTitle className="text-muted-foreground text-[10px] uppercase font-black tracking-widest flex items-center gap-2">
                           <Edit3 className="h-3 w-3" /> Transposición Global
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 grid grid-cols-2 gap-3">
                        <Button
                          variant="outline"
                          onClick={() => handleTranspose(-2)}
                          className="bg-accent border-border text-foreground hover:bg-red-500/20 hover:border-red-500/50 h-12 font-bold text-[10px]"
                        >
                          <ArrowDownCircle className="h-3 w-3 mr-1" /> -1 Tono
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleTranspose(2)}
                          className="bg-accent border-border text-foreground hover:bg-primary/20 hover:border-primary/50 h-12 font-bold text-[10px]"
                        >
                          <ArrowUpCircle className="h-3 w-3 mr-1" /> +1 Tono
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleTranspose(-1)}
                          className="bg-accent border-border text-foreground hover:bg-red-500/20 hover:border-red-500/50 h-12 font-bold text-[10px]"
                        >
                          <ArrowDownCircle className="h-3 w-3 mr-1" /> -1 Sem.
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleTranspose(1)}
                          className="bg-accent border-border text-foreground hover:bg-primary/20 hover:border-primary/50 h-12 font-bold text-[10px]"
                        >
                          <ArrowUpCircle className="h-3 w-3 mr-1" /> +1 Sem.
                        </Button>
                    </CardContent>
                    <div className="px-4 pb-4">
                        <Button
                          variant="ghost"
                          onClick={resetToOriginal}
                          className="w-full text-muted-foreground hover:text-foreground hover:bg-accent h-10 text-[10px] font-bold uppercase tracking-widest"
                        >
                          <RotateCcw className="h-3 w-3 mr-2" /> Restablecer Original
                        </Button>
                    </div>
                </Card>

                <Card className={`border-primary/20 bg-primary/5 rounded-2xl ${isSidebarCollapsed ? 'hidden' : ''}`}>
                    <CardHeader className="py-4 border-b border-border text-left">
                        <CardTitle className="text-primary text-[10px] uppercase font-black tracking-widest">Selector de Acordes</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 grid grid-cols-4 gap-2">
                        {COMMON_CHORDS.map(chord => (
                            <Button key={chord} size="sm" variant="outline" onClick={() => insertChord(chord)} className="bg-accent border-border text-foreground hover:bg-primary h-10 font-bold font-mono text-xs">{chord}</Button>
                        ))}
                    </CardContent>
                </Card>

                {isSidebarCollapsed && (
                  <div className="flex flex-col items-center gap-4 py-8">
                     <Edit3 className="h-5 w-5 text-muted" />
                     <div className="h-px w-8 bg-border" />
                     <RotateCcw className="h-5 w-5 text-muted cursor-pointer hover:text-foreground" onClick={resetToOriginal} />
                  </div>
                )}
            </div>
        )}

        {isLeader && !isEditing && !isSidebarCollapsed && (
          <div className="p-6 bg-accent/50 border-t border-border space-y-4 animate-in fade-in duration-500">
            {rehearsal.status === 'PENDING' || rehearsal.status === 'PAUSED' || rehearsal.status === 'READY' ? (
              <Button onClick={handleStart} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-black h-12 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95">
                <Play className="h-4 w-4 mr-2 fill-current" />
                {rehearsal.status === 'PAUSED' ? 'REANUDAR' : rehearsal.status === 'READY' ? 'INICIAR ALABANZA' : 'EMPEZAR ENSAYO'}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" onClick={() => handleUpdateStatus('PAUSED')} className="border-border text-foreground hover:bg-accent h-12 rounded-xl font-bold"><Pause className="h-4 w-4 mr-2" /> PAUSAR</Button>
                    <Button onClick={() => handleUpdateStatus('READY')} className="bg-primary hover:bg-primary/90 text-primary-foreground font-black h-12 rounded-xl shadow-lg shadow-primary/20"><Zap className="h-4 w-4 mr-2 fill-current" /> LISTO</Button>
                </div>
                <Button variant="ghost" onClick={() => handleUpdateStatus('COMPLETED')} className="text-muted-foreground hover:text-muted-foreground/80 text-[10px] font-black uppercase tracking-widest mt-2 transition-colors"><Archive className="h-3 w-3 mr-2" /> Finalizar y Archivar</Button>
              </div>
            )}
          </div>
        )}

        {isLeader && !isEditing && isSidebarCollapsed && (
          <div className="mt-auto p-4 flex flex-col items-center gap-4 border-t border-border">
            <Button size="icon" onClick={handleStart} className="bg-primary rounded-xl h-10 w-10"><Play className="h-4 w-4 fill-current" /></Button>
          </div>
        )}
      </aside>

      <main className="flex-1 flex flex-col relative">
        <header className="h-24 px-10 flex justify-between items-center bg-background border-b border-border backdrop-blur-xl z-10">
          {/* Progress Bars */}
          <div className="absolute top-0 left-0 w-full flex flex-col">
            <div className="h-1 bg-muted w-full">
              <div
                className="h-full bg-primary/40 transition-all duration-500 ease-out"
                style={{ width: `${((currentSongIndex) / (rehearsal?.songs.length || 1)) * 100}%` }}
              />
            </div>
            <div className="h-0.5 bg-background w-full">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${((currentBlockIndex + 1) / (blocks.length || 1)) * 100}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
               <Music2 className="h-6 w-6 text-primary" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-black text-foreground tracking-tight leading-none mb-1">{currentRS?.songDetails?.title}</h1>
              <div className="flex items-center gap-3">
                   <Badge variant="outline" className="bg-muted text-muted-foreground border-0 text-[10px] tracking-widest uppercase">
                      {customVersion ? `VERSION PERSONALIZADA` : `TONO ORIGINAL: ${currentRS?.songDetails?.baseChords}`}
                   </Badge>
                 <div className="flex gap-1">
                    {rehearsal.songs.map((_, i) => (
                      <div key={i} className={`h-1 w-3 rounded-full transition-all ${i === currentSongIndex ? 'bg-primary w-6' : 'bg-muted'}`} />
                    ))}
                 </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
             {!isEditing ? (
                <>
                    <div className="flex bg-accent p-1 rounded-xl border border-border mr-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('SLIDES')}
                            className={`rounded-lg h-9 px-4 font-bold transition-all ${viewMode === 'SLIDES' ? 'bg-muted text-foreground shadow-lg' : 'text-muted-foreground'}`}
                        >
                            DIAPOSITIVA
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('SCROLL')}
                            className={`rounded-lg h-9 px-4 font-bold transition-all ${viewMode === 'SCROLL' ? 'bg-muted text-foreground shadow-lg' : 'text-muted-foreground'}`}
                        >
                            LECTURA
                        </Button>
                    </div>
                    <Button variant="outline" onClick={startEditing} className="rounded-xl h-11 px-5 font-bold border-border bg-accent text-muted-foreground hover:text-foreground transition-all hover:border-primary/50"><Edit3 className="h-4 w-4 mr-2 text-primary" /> AJUSTAR ACORDES</Button>
                </>
             ) : (
                <div className="flex gap-2">
                    <Button onClick={saveMyChords} disabled={savingChords} className="bg-green-600 hover:bg-green-500 text-white rounded-xl h-11 px-5 font-bold shadow-lg shadow-green-900/20"><Save className="h-4 w-4 mr-2" /> GUARDAR CAMBIOS</Button>
                    <Button variant="ghost" onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-foreground h-11 w-11 p-0 rounded-full hover:bg-accent"><X className="h-5 w-5" /></Button>
                </div>
             )}

             {isLeader && !isEditing && (
               <Button variant="outline" onClick={handleOpenProjection} className="rounded-xl h-11 px-5 font-bold border-border bg-accent text-muted-foreground hover:text-foreground hover:border-primary/50"><MonitorPlay className="h-4 w-4 mr-2 text-primary" /> PROYECTAR</Button>
             )}

             {!isEditing && (
                <Button variant="outline" size="sm" onClick={() => setShowChords(!showChords)} className={`rounded-xl h-11 px-5 font-bold border-border transition-all ${showChords ? 'bg-primary/20 text-primary border-primary/50' : 'bg-accent text-muted-foreground hover:text-foreground'}`}><Type className="h-4 w-4 mr-2" /> ACORDES</Button>
             )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 md:px-12 md:py-8 scrollbar-hide select-none flex flex-col items-center min-h-0 relative">
          {/* Fondo dinámico detrás de las letras */}
          {currentBackgroundUrl && (
            <div className="absolute inset-0 z-0 pointer-events-none">
              <img
                src={currentBackgroundUrl}
                alt="Background"
                className="w-full h-full object-cover opacity-30 blur-[2px]"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/20 to-background/60" />
            </div>
          )}
          {isEditing ? (
            <div className="max-w-4xl mx-auto w-full h-full flex flex-col space-y-4 animate-in fade-in duration-300">
                <Textarea
                    ref={textareaRef}
                    value={editedLyrics}
                    onChange={(e) => setEditedLyrics(e.target.value)}
                    onClick={handleTextareaClick}
                    className="flex-1 min-h-[500px] bg-accent/50 border-border text-foreground p-8 font-mono text-xl leading-relaxed rounded-3xl focus:ring-1 focus:ring-primary/30 custom-scrollbar"
                />
            </div>
          ) : (
            <div className={`w-full max-w-[90vw] flex flex-col ${viewMode === 'SLIDES' ? 'items-center justify-center min-h-full' : ''}`}>
                {viewMode === 'SLIDES' ? (
                    <div key={`${currentSongIndex}-${currentBlockIndex}`} className={`${getAnimationClass(transitionAnimation)} flex justify-center w-full`}>
                        <ChordSheet content={blocks[currentBlockIndex] || ''} showChords={showChords} />
                    </div>
                ) : (
                    <div className="space-y-12 w-full py-12">
                        {blocks.map((block, i) => (
                           <div 
                             key={i} 
                             className={`transition-all duration-700 ${i === currentBlockIndex ? 'opacity-100 scale-105' : 'opacity-20 scale-95 blur-[1px]'}`}
                           >
                             <ChordSheet content={block} showChords={showChords} />
                           </div>
                        ))}
                    </div>
                )}
            </div>
          )}
        </div>

        {!isEditing && (
            <footer className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-muted/60 backdrop-blur-3xl px-8 py-3 rounded-[2rem] border border-border shadow-2xl ring-1 ring-border z-30">
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={currentSongIndex === 0 && currentBlockIndex === 0}
                    onClick={() => currentBlockIndex > 0 ? changeBlock(currentBlockIndex - 1) : changeSong(currentSongIndex - 1)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-2xl h-12 w-12 transition-all disabled:opacity-20"
                >
                    <ChevronLeft className="h-8 w-8" />
                </Button>

                <div className="flex items-center gap-4 px-4 border-x border-border">
                    <div className="flex flex-col items-center min-w-[80px]">
                        <span className="text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] mb-0.5">Canción</span>
                        <span className="text-sm font-black text-foreground font-mono">
                            {String(currentSongIndex + 1).padStart(2, '0')} <span className="text-muted">/</span> {String(rehearsal.songs.length).padStart(2, '0')}
                        </span>
                    </div>
                    <div className="flex flex-col items-center min-w-[80px]">
                        <span className="text-[9px] text-primary font-black uppercase tracking-[0.2em] mb-0.5">Slide</span>
                        <span className="text-sm font-black text-foreground font-mono">
                            {String(currentBlockIndex + 1).padStart(2, '0')} <span className="text-muted">/</span> {String(blocks.length).padStart(2, '0')}
                        </span>
                    </div>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    disabled={currentSongIndex === (rehearsal?.songs.length || 0) - 1 && currentBlockIndex === blocks.length - 1}
                    onClick={() => currentBlockIndex < blocks.length - 1 ? changeBlock(currentBlockIndex + 1) : changeSong(currentSongIndex + 1)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-2xl h-12 w-12 transition-all disabled:opacity-20"
                >
                    <ChevronRight className="h-8 w-8" />
                </Button>
            </footer>
        )}
      </main>

      {/* Selector de Fondos */}
      {showBackgroundManager && (
          <BackgroundManager
            onClose={() => setShowBackgroundManager(false)}
            onSelect={handleSelectBackground}
          />
      )}
    </div>
  );
};
