import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { 
  ArrowLeft, 
  Save, 
  Music2, 
  Type,
  Pointer,
  Keyboard
} from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Textarea } from '@/presentation/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';

const COMMON_CHORDS = ["C", "D", "E", "F", "G", "A", "B", "Cm", "Dm", "Em", "Am", "Bm", "Bb", "Eb", "F#", "G#", "C7", "D7", "G7"];

export const EditSongView: React.FC = () => {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const { saveSong, getSongById } = useDependencies();

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [baseChords, setBaseChords] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editMode, setEditMode] = useState<'TEXT' | 'CHORDS'>('TEXT');
  const [activeCursorPos, setActiveCursorPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (songId) {
      const fetchSong = async () => {
        setLoading(true);
        try {
          const song = await getSongById.execute(songId);
          if (song) {
            setTitle(song.title);
            setAuthor(song.author);
            setLyrics(song.lyrics);
            setBaseChords(song.baseChords);
          }
        } catch (e) {
          console.error("Error loading song", e);
        } finally {
          setLoading(false);
        }
      };
      fetchSong();
    }
  }, [songId, getSongById]);
  const insertChord = (chord: string) => {
    if (activeCursorPos === null) return;
    const before = lyrics.substring(0, activeCursorPos);
    const after = lyrics.substring(activeCursorPos);
    setLyrics(`${before}[${chord}]${after}`);
    setActiveCursorPos(null);
    
    setTimeout(() => {
        textareaRef.current?.focus();
    }, 10);
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (editMode === 'CHORDS') {
      const pos = e.currentTarget.selectionStart;
      setActiveCursorPos(pos);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // CORRECCIÓN: Si hay songId, lo pasamos para que el Repo haga UPSERT en el mismo registro
      const songData = { title, author, lyrics, baseChords };
      await saveSong.execute(songId ? { ...songData, id: songId } : songData);
      navigate('/songs');
    } catch (error) {
      alert("Error al guardar la canción.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
      <div className="text-zinc-500 animate-pulse font-medium">Abriendo libro de cánticos...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0f1a] p-6 md:p-10 selection:bg-primary/30">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6 text-left">
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate('/songs')}
                className="text-zinc-400 hover:text-white rounded-2xl bg-white/5 h-12 w-12"
            >
                <ArrowLeft className="h-6 w-6" />
            </Button>
            <div>
                <h1 className="text-4xl font-extrabold text-white tracking-tight">{songId ? 'Editar Canción' : 'Nueva Canción'}</h1>
                <p className="text-zinc-500 text-lg">Define el autor y añade los acordes con precisión.</p>
            </div>
          </div>

          <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5">
             <Button 
                variant={editMode === 'TEXT' ? 'secondary' : 'ghost'} 
                onClick={() => setEditMode('TEXT')}
                className={`rounded-xl px-6 ${editMode === 'TEXT' ? 'bg-white/10 text-white shadow-lg' : 'text-zinc-500'}`}
             >
                <Keyboard className="h-4 w-4 mr-2" /> Texto
             </Button>
             <Button 
                variant={editMode === 'CHORDS' ? 'secondary' : 'ghost'} 
                onClick={() => setEditMode('CHORDS')}
                className={`rounded-xl px-6 ${editMode === 'CHORDS' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-zinc-500'}`}
             >
                <Pointer className="h-4 w-4 mr-2" /> Acordes
             </Button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1 space-y-8 text-left">
            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl shadow-2xl">
              <CardHeader className="bg-white/[0.02] border-b border-white/5">
                <CardTitle className="text-white flex items-center gap-3 text-xs uppercase tracking-widest font-black">
                  <Music2 className="h-4 w-4 text-primary" /> Información
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Título</Label>
                  <Input 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Cuán Grande es Él"
                    required
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Autor / Artista</Label>
                  <Input 
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Ej: Miel San Marcos"
                    required
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-400 font-bold ml-1">Tono Base</Label>
                  <Input 
                    value={baseChords}
                    onChange={(e) => setBaseChords(e.target.value)}
                    placeholder="Ej: G"
                    required
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl font-mono focus:ring-primary focus:border-primary"
                  />
                </div>
              </CardContent>
            </Card>

            {editMode === 'CHORDS' && activeCursorPos !== null && (
                <Card className="border-primary/30 bg-primary/5 backdrop-blur-md rounded-3xl shadow-2xl animate-in zoom-in-95">
                    <CardHeader className="py-4 border-b border-primary/10">
                        <CardTitle className="text-primary text-[10px] uppercase font-black tracking-widest text-left">
                            Insertar Acorde
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 grid grid-cols-4 gap-2">
                        {COMMON_CHORDS.map(chord => (
                            <Button 
                                key={chord} 
                                type="button"
                                size="sm" 
                                variant="outline" 
                                onClick={() => insertChord(chord)}
                                className="bg-white/5 border-white/10 text-white hover:bg-primary hover:text-white h-10 font-bold font-mono text-xs"
                            >
                                {chord}
                            </Button>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Button 
              type="submit" 
              disabled={saving || !title || !author || !lyrics}
              className="w-full h-16 bg-primary hover:bg-primary/90 text-white font-black text-xl rounded-2xl shadow-2xl shadow-primary/20 transition-all active:scale-95"
            >
              <Save className="h-6 w-6 mr-3" /> {saving ? 'Guardando...' : 'Publicar'}
            </Button>
          </div>

          <div className="lg:col-span-3 text-left">
            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl shadow-2xl h-full min-h-[600px] flex flex-col">
              <CardHeader className="bg-white/[0.02] border-b border-white/5 flex flex-row items-center justify-between">
                <CardTitle className="text-white flex items-center gap-3 text-xs uppercase tracking-widest font-black">
                  <Type className="h-4 w-4 text-primary" /> 
                  {editMode === 'TEXT' ? 'Editor de Letra' : 'Editor de Acordes (Haz clic en la letra)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 relative">
                <Textarea 
                  ref={textareaRef}
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  onClick={handleTextareaClick}
                  placeholder="Escribe la letra aquí..."
                  required
                  className={`w-full h-full min-h-[600px] bg-transparent border-none text-white p-8 font-sans text-xl md:text-2xl leading-relaxed custom-scrollbar focus-visible:ring-0 resize-none ${editMode === 'CHORDS' ? 'cursor-crosshair caret-primary' : ''}`}
                />
              </CardContent>
            </Card>
          </div>
        </form>
      </div>
    </div>
  );
};
