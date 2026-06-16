import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import type { User } from '@/core/domain/entities/User';
import type { Song } from '@/core/domain/entities/Song';
import {
  ArrowLeft,
  Calendar,
  Users,
  Music,
  Save,
  CheckCircle2,
  XCircle,
  Edit
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';

export const CreateRehearsalView: React.FC = () => {
  const { rehearsalId } = useParams<{ rehearsalId: string }>();
  const navigate = useNavigate();
  const { getUsers, getSongs, rehearsalRepository } = useDependencies();
  const { user: currentUser } = useAuth();

  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [availableSongs, setAvailableSongs] = useState<Song[]>([]);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [songSearchTerm, setSongSearchTerm] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isEditMode = !!rehearsalId;
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [users, songs] = await Promise.all([
          getUsers.execute(),
          getSongs.execute()
        ]);
        setAvailableUsers(users);
        setAvailableSongs(songs);

        if (isEditMode && rehearsalId) {
          const rehearsal = await rehearsalRepository.getById(rehearsalId);
          if (rehearsal) {
            const d = new Date(rehearsal.date);
            setDate(d.toISOString().split('T')[0]);
            setTime(d.toTimeString().split(' ')[0].substring(0, 5));
            setSelectedUserIds(rehearsal.assignedUsers.map(u => u.id));
            setSelectedSongIds(rehearsal.songs.map(s => s.songId));
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [getUsers, getSongs, isEditMode, rehearsalId, rehearsalRepository]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) return;

    const selectedDateTime = new Date(`${date}T${time}`);
    if (!isEditMode && selectedDateTime < new Date()) {
      alert("No puedes programar un ensayo en el pasado.");
      return;
    }

    setSaving(true);
    try {
      const rehearsalData = {
        date: selectedDateTime,
        status: 'PENDING' as const,
        leaderId: currentUser?.id || '',
        assignedUsers: availableUsers.filter(u => selectedUserIds.includes(u.id)),
        songs: selectedSongIds.map(id => ({
          songId: id,
          adjustedChords: []
        }))
      };

      if (isEditMode && rehearsalId) {
        await rehearsalRepository.update({ ...rehearsalData, id: rehearsalId });
      } else {
        await rehearsalRepository.create(rehearsalData);
      }

      navigate('/dashboard');
    } catch (error) {
      console.error("Error saving rehearsal:", error);
      alert("Error al guardar el ensayo.");
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
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-muted-foreground animate-pulse font-medium">Sincronizando datos...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 selection:bg-primary/30">
      <div className="max-w-4xl mx-auto space-y-10">
        <header className="flex items-center gap-6 text-left">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="text-muted-foreground hover:text-foreground rounded-2xl bg-accent h-12 w-12"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
              {isEditMode ? 'Editar Ensayo' : 'Nuevo Ensayo'}
            </h1>
            <p className="text-muted-foreground text-lg">
              {isEditMode ? 'Ajusta la programación y el equipo del ensayo.' : 'Organiza el tiempo, el equipo y las canciones.'}
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-10">
            <Card className="border-border bg-accent backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
              <CardHeader className="bg-accent/50 border-b border-border">
                <CardTitle className="text-foreground flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  Programación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6 text-left">
                <div className="space-y-3">
                  <Label className="text-muted-foreground font-bold ml-1">¿Qué día es el ensayo?</Label>
                  <Input
                    type="date"
                    required
                    min={today}
                    className="bg-input border-border text-foreground h-12 rounded-xl focus:ring-primary focus:border-primary"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-3 text-left">
                  <Label className="text-muted-foreground font-bold ml-1">¿A qué hora empieza?</Label>
                  <Input
                    type="time"
                    required
                    className="bg-input border-border text-foreground h-12 rounded-xl focus:ring-primary focus:border-primary"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-accent backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl">
              <CardHeader className="bg-accent/50 border-b border-border">
                <CardTitle className="text-foreground flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  Convocar Equipo
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <Input
                  placeholder="Buscar músico por nombre..."
                  className="bg-input border-border text-sm h-10 rounded-xl"
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                />
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                  {availableUsers
                    .filter(u => u.id !== currentUser?.id)
                    .filter(u =>
                      `${u.firstName} ${u.lastName}`.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                      u.defaultInstrument?.toLowerCase().includes(userSearchTerm.toLowerCase())
                    )
                    .map(user => (
                    <div
                      key={user.id}
                      onClick={() => toggleSelection(user.id, selectedUserIds, setSelectedUserIds)}
                      className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                        selectedUserIds.includes(user.id)
                        ? 'bg-primary/10 border-primary text-foreground shadow-inner'
                        : 'bg-accent border-transparent text-muted-foreground hover:bg-accent/80'
                      }`}
                    >
                      <div className="flex flex-col text-left">
                          <span className="font-bold">{user.firstName} {user.lastName}</span>
                          <span className="text-[10px] uppercase opacity-50 tracking-tighter">
                            {user.role === 'LIDER_REPASO' ? 'Líder • ' : ''}
                            {user.defaultInstrument || 'General'}
                          </span>
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

          <div className="space-y-10 flex flex-col">
            <Card className="border-border bg-accent backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl flex-1">
              <CardHeader className="bg-accent/50 border-b border-border">
                <CardTitle className="text-foreground flex items-center gap-3">
                   <div className="p-2 bg-primary/20 rounded-lg">
                     <Music className="h-5 w-5 text-primary" />
                   </div>
                   Armar Repertorio
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <Input
                  placeholder="Buscar canción por título o tono..."
                  className="bg-input border-border text-sm h-10 rounded-xl"
                  value={songSearchTerm}
                  onChange={(e) => setSongSearchTerm(e.target.value)}
                />
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
                  {availableSongs
                    .filter(s =>
                      s.title.toLowerCase().includes(songSearchTerm.toLowerCase()) ||
                      s.baseChords.toLowerCase().includes(songSearchTerm.toLowerCase())
                    )
                    .map(song => (
                    <div
                      key={song.id}
                      onClick={() => toggleSelection(song.id, selectedSongIds, setSelectedSongIds)}
                      className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                        selectedSongIds.includes(song.id)
                        ? 'bg-primary/10 border-primary text-foreground shadow-inner'
                        : 'bg-accent border-transparent text-muted-foreground hover:bg-accent/80'
                      }`}
                    >
                      <div className="flex flex-col text-left">
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
              className="w-full h-16 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-xl rounded-2xl shadow-2xl shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
            >
              {isEditMode ? <Edit className="h-6 w-6 mr-3" /> : <Save className="h-6 w-6 mr-3" />}
              {saving ? 'Sincronizando...' : (isEditMode ? 'GUARDAR CAMBIOS' : 'PUBLICAR ENSAYO')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
