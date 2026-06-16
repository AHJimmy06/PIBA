import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import type { Rehearsal } from '@/core/domain/entities/Rehearsal';
import type { User } from '@/core/domain/entities/User';
import {
  Calendar,
  Clock,
  Music,
  Users,
  Library,
  Plus,
  LogOut,
  ChevronRight,
  Monitor,
  Zap,
  Activity,
  Trash2,
  Settings,
  UserPlus,
  Edit
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/presentation/components/ui/card';
import { Button } from '@/presentation/components/ui/button';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { ProfileEditModal } from '../components/ui/ProfileEditModal';

export const DashboardView: React.FC = () => {
  const { getPendingRehearsals, deleteRehearsal, updateUserProfile } = useDependencies();
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();

  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [loading, setLoading] = useState(true);

  const [rehearsalToDelete, setRehearsalToDelete] = useState<Rehearsal | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const fetchRehearsals = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getPendingRehearsals.execute(user.id);
      setRehearsals(data);
    } catch (error) {
      console.error('Error loading rehearsals:', error);
    } finally {
      setLoading(false);
    }
  }, [getPendingRehearsals, user]);

  useEffect(() => {
    fetchRehearsals();
  }, [fetchRehearsals]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleUpdateProfile = async (updatedUser: User): Promise<User> => {
    try {
      const result = await updateUserProfile.execute(updatedUser);
      login(result);
      return result;
    } catch (error) {
      console.error("Error updating profile:", error);
      throw error;
    }
  };

  const confirmDelete = async () => {
    if (!rehearsalToDelete || !user) return;
    try {
      await deleteRehearsal.execute(rehearsalToDelete.id, user.id);
      await fetchRehearsals();
      setRehearsalToDelete(null);
    } catch (error) {
      alert("Error al eliminar el ensayo.");
    }
  };

  if (!user) return <Navigate to="/" replace />;

  const readyForService = rehearsals.filter(r => r.status === 'READY');
  const upcomingRehearsals = rehearsals.filter(r => r.status !== 'READY');

  const RehearsalCard = ({ rehearsal }: { rehearsal: Rehearsal }) => (
    <Card
      key={rehearsal.id}
      className={`group border-border bg-accent hover:bg-accent/80 transition-all duration-300 hover:scale-[1.02] cursor-pointer ring-1 ring-border ${rehearsal.status === 'READY' ? 'border-primary/20 bg-primary/5' : ''}`}
      onClick={() => navigate(`/rehearsal/${rehearsal.id}`)}
    >
      <CardHeader className="pb-4 text-left">
        <div className="flex justify-between items-start mb-4 text-left">
          <div className={`p-3 rounded-2xl group-hover:scale-110 transition-transform ${rehearsal.status === 'READY' ? 'bg-primary/20' : 'bg-accent'}`}>
            <Calendar className={`h-6 w-6 ${rehearsal.status === 'READY' ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex gap-2">
            {user?.role === 'LIDER_REPASO' && rehearsal.leaderId === user.id && (
                <>
                  <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/rehearsal/edit/${rehearsal.id}`);
                      }}
                  >
                      <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                          e.stopPropagation();
                          setRehearsalToDelete(rehearsal);
                      }}
                  >
                      <Trash2 className="h-4 w-4" />
                  </Button>
                </>
            )}
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg ${
                rehearsal.status === 'IN_PROGRESS'
                    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                    : rehearsal.status === 'READY'
                    ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                    : 'bg-muted text-muted-foreground ring-1 ring-border'
            }`}>
                {rehearsal.status === 'IN_PROGRESS' ? '● En Vivo' : rehearsal.status === 'READY' ? '✨ Listo' : rehearsal.status}
            </span>
          </div>
        </div>
        <CardTitle className="text-2xl text-foreground group-hover:text-primary transition-colors font-bold text-left">
          {new Date(rehearsal.date).toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'short'
          })}
        </CardTitle>
        <CardDescription className="flex items-center gap-2 font-medium text-muted-foreground mt-1">
          <Clock className="h-4 w-4" />
          {new Date(rehearsal.date).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
          })}hs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-8 pt-2 text-left">
        <div className="flex items-center gap-4 text-sm text-muted-foreground group-hover:text-muted-foreground/80 transition-colors">
          <Music className="h-4 w-4" />
          <span className="font-medium">{rehearsal.songs.length} canciones</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground group-hover:text-muted-foreground/80 transition-colors">
          <Users className="h-4 w-4" />
          <span className="font-medium">{rehearsal.assignedUsers.length} músicos asignados</span>
        </div>
      </CardContent>
      <CardFooter className="pt-0 flex items-center justify-between text-primary text-sm font-bold opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
         {rehearsal.status === 'READY' ? 'Iniciar Alabanza' : 'Acceder al Ensayo'} <ChevronRight className="h-4 w-4" />
      </CardFooter>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background text-muted-foreground font-sans selection:bg-primary/30">
      <nav className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/dashboard')}>
            <div className="bg-primary h-9 w-9 rounded-xl flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                <Music className="h-5 w-5" />
            </div>
            <span className="font-bold text-xl text-foreground tracking-tight leading-none">PIBA</span>
          </div>

          <div className="flex items-center gap-4">
             <div
                className="hidden md:flex flex-col text-right cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setIsProfileOpen(true)}
             >
                <span className="text-sm font-semibold text-foreground flex items-center justify-end gap-2">
                    {user.firstName} {user.lastName} <Settings className="h-3 w-3 text-muted-foreground" />
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    {user.role === 'LIDER_REPASO' ? 'Líder' : (user.defaultInstrument || 'Integrante')}
                </span>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
                </Button>
                </div>
                </div>
                </nav>

                <main className="container mx-auto p-6 md:p-10 space-y-12">
                <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 text-left">
                <div className="space-y-2">
                <h1 className="text-4xl md:text-5xl font-extrabold text-foreground tracking-tight leading-none">Hola, {user.firstName}</h1>
                <p className="text-muted-foreground text-lg">Panel de control de alabanza y ensayos.</p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            {user.role === 'LIDER_REPASO' && (
              <Button variant="outline" className="flex-1 md:flex-none border-border bg-accent text-foreground hover:bg-accent/80 h-14 px-8 rounded-2xl font-bold" onClick={() => navigate('/users/new')}>
                <UserPlus className="h-4 w-4 mr-2" /> Equipo
              </Button>
            )}
            <Button variant="outline" className="flex-1 md:flex-none border-border bg-accent text-foreground hover:bg-accent/80 h-14 px-8 rounded-2xl font-bold" onClick={() => navigate('/songs')}>
              <Library className="h-4 w-4 mr-2" /> Repertorio
            </Button>
            {user.role === 'LIDER_REPASO' && (
              <Button className="flex-1 md:flex-none bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-black h-14 px-8 rounded-2xl" onClick={() => navigate('/rehearsal/new')}>
                <Plus className="h-4 w-4 mr-2" /> CREAR ENSAYO
              </Button>
            )}
          </div>
        </section>

        {readyForService.length > 0 && (
            <section className="space-y-6 text-left animate-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/20 rounded-lg">
                        <Zap className="h-5 w-5 text-primary fill-primary" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Listos para el Servicio</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {readyForService.map(r => <RehearsalCard key={r.id} rehearsal={r} />)}
                </div>
            </section>
        )}

        <section className="space-y-6 text-left">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Activity className="h-5 w-5 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-bold text-foreground tracking-tight">Próximos Ensayos</h2>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? (
                Array.from({length: 3}).map((_, i) => (
                    <div key={i} className="h-64 rounded-2xl bg-accent animate-pulse border border-border" />
                ))
            ) : upcomingRehearsals.length === 0 && readyForService.length === 0 ? (
              <Card className="col-span-full border-dashed border-border bg-transparent py-20 border-2">
                <CardContent className="flex flex-col items-center justify-center text-center space-y-6">
                  <Monitor className="h-14 w-14 text-muted" />
                  <div className="space-y-2">
                    <CardTitle className="text-2xl text-foreground font-bold">Sin actividad pendiente</CardTitle>
                    <CardDescription className="text-lg text-muted-foreground">No hay ensayos ni servicios programados.</CardDescription>
                  </div>
                </CardContent>
              </Card>
            ) : (
              upcomingRehearsals.map((rehearsal) => (
                <RehearsalCard key={rehearsal.id} rehearsal={rehearsal} />
              ))
            )}
           </div>
        </section>
      </main>

      <ProfileEditModal
        isOpen={isProfileOpen}
        user={user}
        onClose={() => setIsProfileOpen(false)}
        onSave={handleUpdateProfile}
      />

      <ConfirmationModal
        isOpen={!!rehearsalToDelete}
        title="¿Cancelar este ensayo?"
        description={`Se eliminará toda la planificación de este ensayo. Esta acción no se puede deshacer.`}
        confirmText="CANCELAR ENSAYO"
        cancelText="MANTENER"
        onConfirm={confirmDelete}
        onCancel={() => setRehearsalToDelete(null)}
      />
    </div>
  );
};
