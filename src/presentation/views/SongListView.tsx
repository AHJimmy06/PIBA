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
import { Music, Search, Plus, Filter, ArrowLeft, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SongDetailsDialog } from '../components/repertoire/SongDetailsDialog';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';

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

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSongs.execute();
      setSongs(data);
      setFilteredSongs(data);
    } catch (error) {
      console.error('Error fetching songs:', error);
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
    if (!songToDelete) return;
    try {
      await deleteSong.execute(songToDelete.id);
      await fetchSongs();
      setSongToDelete(null);
    } catch (error) {
      alert("Error al eliminar la canción.");
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
                        <span className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-mono font-bold group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                          {song.baseChords}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-xl"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSongToDelete(song);
                                }}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
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

      {/* MODAL DE DETALLE */}
      {selectedSong && (
        <SongDetailsDialog
            song={selectedSong}
            onClose={() => setSelectedSong(null)}
        />
      )}

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN */}
      <ConfirmationModal
        isOpen={!!songToDelete}
        title="¿Eliminar canción?"
        description={`Estás a punto de borrar "${songToDelete?.title}" del catálogo base. Esta acción es irreversible y la canción desaparecerá de todos los ensayos.`}
        confirmText="ELIMINAR AHORA"
        cancelText="CANCELAR"
        onConfirm={confirmDelete}
        onCancel={() => setSongToDelete(null)}
      />
    </div>
  );
};
