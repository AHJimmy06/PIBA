import React, { useEffect, useState, useCallback } from 'react';
import { useDependencies } from '../context/DependenciesProvider';
import type { Song } from '@/core/domain/entities/Song';
import {
  Card,
  CardContent,
  CardHeader
} from '@/presentation/components/ui/card';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Music, Search, Plus, Filter, ArrowLeft, Eye, Trash2, Music2, Type, User as UserIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/presentation/components/ui/alert-dialog';
import { Badge } from '@/presentation/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/presentation/components/ui/dialog';
import { ChordSheet } from '@/presentation/components/rehearsal/ChordSheet';

export const SongListView: React.FC = () => {
  const { getSongs, deleteSong } = useDependencies();
  const navigate = useNavigate();

  const [songs, setSongs] = useState<Song[]>([]);
  const [filteredSongs, setFilteredSongs] = useState<Song[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Estados para Modales
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [songToDelete, setSongToDelete] = useState<Song | null>(null);
  const [songDeleting, setSongDeleting] = useState(false);

  const fetchSongs = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const data = await getSongs.execute();
      setSongs(data);
      setFilteredSongs(data);
      return true;
    } catch (error) {
      console.error('Error fetching songs:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [getSongs]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  useEffect(() => {
    const results = songs.filter(song =>
      song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.author.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSongs(results);
  }, [searchTerm, songs]);

  const confirmDelete = async () => {
    if (!songToDelete || songDeleting) return;
    setSongDeleting(true);
    try {
      await deleteSong.execute(songToDelete.id);
      setSongToDelete(null);
      const refreshed = await fetchSongs();
      if (!refreshed) {
        alert("La canción se eliminó, pero no se pudo actualizar la lista.");
      }
    } catch {
      alert("Error al eliminar la canción.");
    } finally {
      setSongDeleting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 md:p-10 space-y-10 selection:bg-primary/30 text-left">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="text-muted-foreground hover:text-foreground rounded-2xl bg-accent h-12 w-12"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div className="text-left">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Repertorio Base</h1>
            <p className="text-muted-foreground text-lg font-medium">Biblioteca central de alabanza</p>
          </div>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90 flex items-center gap-3 text-primary-foreground font-black h-14 px-8 rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
          onClick={() => navigate('/songs/new')}
        >
          <Plus className="h-6 w-6" />
          AGREGAR CANCIÓN
        </Button>
      </header>

      <Card className="border-border bg-accent backdrop-blur-md rounded-[2rem] overflow-hidden shadow-2xl">
        <CardHeader className="bg-accent/50 border-b border-border p-8">
          <div className="flex flex-col md:flex-row gap-6 justify-between">
            <div className="relative w-full md:max-w-md text-left">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Buscar por título o artista..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 h-14 border-border bg-input text-foreground placeholder:text-muted-foreground rounded-2xl focus:ring-primary focus:border-primary"
              />
            </div>
            <Button variant="outline" className="h-14 px-6 border-border bg-accent hover:bg-accent/80 text-muted-foreground hover:text-foreground rounded-2xl flex items-center gap-3 font-bold">
              <Filter className="h-5 w-5" />
              FILTRAR CATÁLOGO
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-[10px] font-black uppercase tracking-[0.2em] bg-accent/30">
                  <th className="px-8 py-5 text-left font-mono">Información de Canción</th>
                  <th className="px-8 py-5 text-left font-mono">Tono Base</th>
                  <th className="px-8 py-5 text-right font-mono">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={3} className="py-20 text-center text-muted-foreground animate-pulse font-medium uppercase tracking-widest text-xs">Sincronizando biblioteca...</td>
                  </tr>
                ) : filteredSongs.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-32 text-center text-left">
                      <div className="h-20 w-20 bg-accent rounded-full flex items-center justify-center mx-auto mb-6">
                        <Music className="h-10 w-10 text-muted" />
                      </div>
                      <p className="text-muted-foreground font-bold text-xl">No se encontraron canciones</p>
                    </td>
                  </tr>
                ) : (
                  filteredSongs.map((song) => (
                    <tr
                        key={song.id}
                        className="group hover:bg-accent/50 transition-all cursor-pointer"
                        onClick={() => setSelectedSong(song)}
                    >
                      <td className="px-8 py-6 text-left">
                        <div className="flex items-center gap-5">
                          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-black shadow-inner group-hover:scale-110 transition-transform">
                            {song.title.charAt(0).toUpperCase()}
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-foreground text-lg leading-none mb-1.5 group-hover:text-primary transition-colors">{song.title}</p>
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{song.author}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-left">
                        <Badge variant="outline" className="bg-muted text-muted-foreground border-0 font-mono group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          {song.baseChords}
                        </Badge>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl font-bold"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/songs/edit/${song.id}`);
                                }}
                            >
                                EDITAR
                            </Button>
                            <AlertDialog open={songToDelete?.id === song.id} onOpenChange={(open) => { if (!open && !songDeleting) setSongToDelete(null); }}>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Eliminar canción"
                                  className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-xl"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSongToDelete(song);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent
                                onClick={(event) => event.stopPropagation()}
                                className="bg-[#0f0f1a] border-white/10 max-w-md rounded-[2rem] gap-0 p-0"
                              >
                                <div className="flex flex-col items-center text-center p-10 pb-6 gap-6">
                                  <div className="size-20 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20"><Trash2 className="text-red-500" /></div>
                                  <AlertDialogHeader className="gap-3">
                                    <AlertDialogTitle className="text-2xl font-black text-white tracking-tight">¿Eliminar canción?</AlertDialogTitle>
                                    <AlertDialogDescription className="text-zinc-500 text-sm leading-relaxed">Estás a punto de borrar &quot;{song.title}&quot; del catálogo base. Esta acción es irreversible y la canción desaparecerá de todos los ensayos.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                </div>
                                <AlertDialogFooter className="p-6 pt-0 flex gap-4 sm:space-x-0">
                                  <AlertDialogCancel disabled={songDeleting} className="flex-1 h-14 rounded-2xl text-zinc-500 hover:text-white hover:bg-white/5 font-bold border-0 mt-0">CANCELAR</AlertDialogCancel>
                                  <AlertDialogAction
                                    disabled={songDeleting}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      void confirmDelete();
                                    }}
                                    className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black shadow-xl shadow-red-900/20"
                                  >
                                    {songDeleting ? 'ELIMINANDO...' : 'ELIMINAR AHORA'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <Button
                                variant="outline"
                                size="sm"
                                className="border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground rounded-xl font-bold ml-2"
                            >
                                <Eye className="h-4 w-4 mr-2" /> VER
                            </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSong} onOpenChange={(open) => { if (!open) setSelectedSong(null); }}>
        {selectedSong && (
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border rounded-3xl p-0 gap-0">
            <DialogHeader className="p-6 border-b border-white/5 bg-white/[0.02] text-left">
              <div className="flex items-center gap-5 pr-10">
                <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <Music2 className="text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-3xl font-black text-white tracking-tight leading-tight">{selectedSong.title}</DialogTitle>
                  <p className="mt-1 flex items-center gap-2 text-zinc-400 font-medium"><UserIcon /> {selectedSong.author}</p>
                </div>
              </div>
            </DialogHeader>
            <div className="bg-[#09090b] p-10 md:p-16">
              <div className="max-w-3xl mx-auto">
                <div className="mb-8 flex items-center gap-3 text-zinc-600 uppercase text-[10px] font-black tracking-[0.3em]">
                  <Type /> Vista previa del repertorio
                </div>
                <ChordSheet content={selectedSong.lyrics} showChords size="compact" />
              </div>
            </div>
            <footer className="flex justify-between items-center p-6 border-t border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Tono Base:</span>
                <Badge variant="outline" className="bg-zinc-800 text-primary border-0 font-mono">{selectedSong.baseChords}</Badge>
              </div>
              <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-tighter">PIBA - Plataforma de Alabanza</p>
            </footer>
          </DialogContent>
        )}
      </Dialog>

    </div>
  );
};
