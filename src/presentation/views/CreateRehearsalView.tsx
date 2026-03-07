import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import type { User } from '@/core/domain/entities/User';
import type { Song } from '@/core/domain/entities/Song';
import { 
  ArrowLeft, 
  Calendar, 
  Users, 
  Music, 
  Save, 
  CheckCircle2, 
  XCircle 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';

export const CreateRehearsalView: React.FC = () => {
  const navigate = useNavigate();
  const { getUsers, getSongs, rehearsalRepository } = useDependencies();

  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [availableSongs, setAvailableSongs] = useState<Song[]>([]);
  
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [users, songs] = await Promise.all([
          getUsers.execute(),
          getSongs.execute()
        ]);
        setAvailableUsers(users);
        setAvailableSongs(songs);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [getUsers, getSongs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) return;

    setSaving(true);
    try {
      // Combinamos fecha y hora
      const dateTime = new Date(`${date}T${time}`);
      
      await rehearsalRepository.create({
        date: dateTime,
        status: 'PENDING',
        leaderId: 'd1111111-1111-1111-1111-111111111111', // Líder por defecto (Simulado)
        assignedUsers: availableUsers.filter(u => selectedUserIds.includes(u.id)),
        songs: selectedSongIds.map(id => ({ 
          songId: id, 
          adjustedChords: [] 
        }))
      });

      navigate('/dashboard');
    } catch (error) {
      console.error("Error creating rehearsal:", error);
      alert("Error al guardar el ensayo. Verifica la conexión.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (id: string, list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (list.includes(id)) {
      setList(list.filter(item => item !== id));
    } else {
      setList([...list, id]);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
      <div className="text-zinc-500 animate-pulse font-medium">Preparando catálogo de alabanza...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0f1a] p-6 md:p-10 selection:bg-primary/30">
      <div className="max-w-4xl mx-auto space-y-10">
        <header className="flex items-center gap-6">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/dashboard')}
            className="text-zinc-400 hover:text-white rounded-2xl bg-white/5 h-12 w-12"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">Nuevo Ensayo</h1>
            <p className="text-zinc-500 text-lg">Organiza el tiempo, el equipo y las canciones.</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Configuración de Fecha y Equipo */}
          <div className="space-y-10">
            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
              <CardHeader className="bg-white/[0.02] border-b border-white/5">
                <CardTitle className="text-white flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  Programación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6 text-left">
                <div className="space-y-3">
                  <Label className="text-zinc-400 font-bold ml-1">¿Qué día es el ensayo?</Label>
                  <Input 
                    type="date" 
                    required 
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-3 text-left">
                  <Label className="text-zinc-400 font-bold ml-1">¿A qué hora empieza?</Label>
                  <Input 
                    type="time" 
                    required 
                    className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
              <CardHeader className="bg-white/[0.02] border-b border-white/5">
                <CardTitle className="text-white flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  Convocar Equipo
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-2 max-h-72 overflow-y-auto pr-2 custom-scrollbar text-left">
                  {availableUsers.map(user => (
                    <div 
                      key={user.id}
                      onClick={() => toggleSelection(user.id, selectedUserIds, setSelectedUserIds)}
                      className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                        selectedUserIds.includes(user.id) 
                        ? 'bg-primary/10 border-primary text-white shadow-inner' 
                        : 'bg-white/5 border-transparent text-zinc-500 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold">{user.name}</span>
                        <span className="text-[10px] uppercase opacity-50 tracking-tighter">{user.defaultInstrument || 'General'}</span>
                      </div>
                      {selectedUserIds.includes(user.id) 
                        ? <CheckCircle2 className="h-5 w-5 text-primary" /> 
                        : <XCircle className="h-5 w-5 opacity-10" />
                      }
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Selección de Repertorio */}
          <div className="space-y-10 flex flex-col">
            <Card className="border-white/5 bg-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl flex-1">
              <CardHeader className="bg-white/[0.02] border-b border-white/5">
                <CardTitle className="text-white flex items-center gap-3">
                   <div className="p-2 bg-primary/20 rounded-lg">
                    <Music className="h-5 w-5 text-primary" />
                  </div>
                  Armar Repertorio
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar text-left">
                  {availableSongs.map(song => (
                    <div 
                      key={song.id}
                      onClick={() => toggleSelection(song.id, selectedSongIds, setSelectedSongIds)}
                      className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                        selectedSongIds.includes(song.id) 
                        ? 'bg-primary/10 border-primary text-white shadow-inner' 
                        : 'bg-white/5 border-transparent text-zinc-500 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold">{song.title}</span>
                        <span className="text-[10px] uppercase opacity-40 font-mono tracking-widest">{song.baseChords}</span>
                      </div>
                      {selectedSongIds.includes(song.id) 
                        ? <CheckCircle2 className="h-5 w-5 text-primary" /> 
                        : <XCircle className="h-5 w-5 opacity-10" />
                      }
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            <Button 
              type="submit" 
              disabled={saving || !date || !time || selectedSongIds.length === 0}
              className="w-full h-16 bg-primary hover:bg-primary/90 text-white font-black text-xl rounded-2xl shadow-2xl shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="h-6 w-6 mr-3" /> {saving ? 'Sincronizando...' : 'Publicar Ensayo'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
