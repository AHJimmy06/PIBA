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
  Edit,
  Save,
  ShieldCheck,
  AlertTriangle,
  User as UserIcon
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/presentation/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/presentation/components/ui/dialog';
import { Badge } from '@/presentation/components/ui/badge';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui/select';

export const DashboardView: React.FC = () => {
  const { getPendingRehearsals, deleteRehearsal, updateUserProfile } = useDependencies();
  const { user, login, logout, revocationWarning } = useAuth();
  const navigate = useNavigate();

  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [loading, setLoading] = useState(true);

  const [rehearsalToDelete, setRehearsalToDelete] = useState<Rehearsal | null>(null);
  const [rehearsalDeleting, setRehearsalDeleting] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [profileStep, setProfileStep] = useState<'form' | 'code'>('form');
  const [profileFirstName, setProfileFirstName] = useState(user?.firstName || '');
  const [profileLastName, setProfileLastName] = useState(user?.lastName || '');
  const [profileInstrument, setProfileInstrument] = useState(user?.defaultInstrument || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileUpdatedCode, setProfileUpdatedCode] = useState<string | null>(null);

  const fetchRehearsals = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    setLoading(true);
    try {
      const data = await getPendingRehearsals.execute(user.id);
      setRehearsals(data);
      return true;
    } catch (error) {
      console.error('Error loading rehearsals:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [getPendingRehearsals, user]);

  useEffect(() => {
    fetchRehearsals();
  }, [fetchRehearsals]);

  const handleLogout = async () => {
    if (await logout()) navigate('/');
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const result = await updateUserProfile.execute({
        ...user,
        firstName: profileFirstName,
        lastName: profileLastName,
        defaultInstrument: profileInstrument || undefined,
      } as User);
      login(result);
      if (result.accessCode !== user?.accessCode) {
        setProfileUpdatedCode(result.accessCode || null);
        setProfileStep('code');
      } else {
        handleProfileClose(true);
      }
    } catch {
      alert("Error al actualizar el perfil.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleProfileClose = (saveCompleted = false) => {
    if (profileSaving && !saveCompleted) return;
    setIsProfileOpen(false);
    setProfileStep('form');
    setProfileUpdatedCode(null);
  };

  const handleProfileOpen = () => {
    setProfileFirstName(user?.firstName || '');
    setProfileLastName(user?.lastName || '');
    setProfileInstrument(user?.defaultInstrument || '');
    setProfileUpdatedCode(null);
    setProfileStep('form');
    setIsProfileOpen(true);
  };

  const confirmDelete = async () => {
    if (!rehearsalToDelete || !user || rehearsalDeleting) return;
    setRehearsalDeleting(true);
    try {
      await deleteRehearsal.execute(rehearsalToDelete.id, user.id);
      setRehearsalToDelete(null);
      const refreshed = await fetchRehearsals();
      if (!refreshed) {
        alert("El ensayo se eliminó, pero no se pudo actualizar la lista.");
      }
    } catch {
      alert("Error al eliminar el ensayo.");
    } finally {
      setRehearsalDeleting(false);
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
          <div className="flex gap-2 focus-within:[&>button]:opacity-100">
            {user?.role === 'LIDER_REPASO' && rehearsal.leaderId === user.id && (
                <>
                  <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar ensayo"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/rehearsal/edit/${rehearsal.id}`);
                      }}
                  >
                      <Edit className="h-4 w-4" />
                  </Button>
                  <AlertDialog open={rehearsalToDelete?.id === rehearsal.id} onOpenChange={(open) => { if (!open && !rehearsalDeleting) setRehearsalToDelete(null); }}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Eliminar ensayo"
                        className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRehearsalToDelete(rehearsal);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-[#0f0f1a] border-white/10 max-w-md rounded-[2rem] gap-0 p-0">
                      <div className="flex flex-col items-center text-center p-10 pb-6 gap-6">
                        <div className="size-20 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20">
                          <AlertTriangle className="text-red-500" />
                        </div>
                        <AlertDialogHeader className="gap-3">
                          <AlertDialogTitle className="text-2xl font-black text-white tracking-tight">¿Cancelar este ensayo?</AlertDialogTitle>
                          <AlertDialogDescription className="text-zinc-500 text-sm leading-relaxed">Se eliminará toda la planificación de este ensayo. Esta acción no se puede deshacer.</AlertDialogDescription>
                        </AlertDialogHeader>
                      </div>
                      <AlertDialogFooter className="p-6 pt-0 flex gap-4 sm:space-x-0">
                        <AlertDialogCancel disabled={rehearsalDeleting} className="flex-1 h-14 rounded-2xl text-zinc-500 hover:text-white hover:bg-white/5 font-bold border-0 mt-0">MANTENER</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={rehearsalDeleting}
                          onClick={(event) => {
                            event.preventDefault();
                            void confirmDelete();
                          }}
                          className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black shadow-xl shadow-red-900/20"
                        >
                          {rehearsalDeleting ? 'ELIMINANDO...' : 'CANCELAR ENSAYO'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
            )}
            <Badge variant={
                rehearsal.status === 'IN_PROGRESS' ? 'destructive' :
                rehearsal.status === 'READY' ? 'default' : 'secondary'
            } className={`${
                rehearsal.status === 'IN_PROGRESS'
                    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                    : rehearsal.status === 'READY'
                    ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                    : 'bg-muted text-muted-foreground ring-1 ring-border'
            }`}>
                {rehearsal.status === 'IN_PROGRESS' ? '● En Vivo' : rehearsal.status === 'READY' ? '✨ Listo' : rehearsal.status}
            </Badge>
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
             <button
                type="button"
                className="hidden md:flex flex-col text-right cursor-pointer hover:opacity-80 transition-opacity"
                onClick={handleProfileOpen}
             >
                <span className="text-sm font-semibold text-foreground flex items-center justify-end gap-2">
                    {user.firstName} {user.lastName} <Settings className="h-3 w-3 text-muted-foreground" />
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    {user.role === 'LIDER_REPASO' ? 'Líder' : (user.defaultInstrument || 'Integrante')}
                </span>
             </button>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
                </Button>
                </div>
                </div>
      </nav>

      {revocationWarning && (
        <div role="alert" className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-center text-sm text-amber-100">
          No pudimos confirmar el cierre de sesión. Tu sesión sigue activa; revisá la conexión e intentá salir nuevamente.
          {revocationWarning.requestId && <span className="ml-2 font-mono text-xs">Solicitud: {revocationWarning.requestId}</span>}
        </div>
      )}

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

      <Dialog open={isProfileOpen} onOpenChange={(open) => { if (!open && !profileSaving) handleProfileClose(); }}>
        <DialogContent
          closeDisabled={profileSaving}
          onEscapeKeyDown={(event) => { if (profileSaving) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (profileSaving) event.preventDefault(); }}
          className="bg-card border-border max-w-md rounded-[2rem] gap-0 p-0"
        >
          <DialogHeader className="p-6 border-b border-white/5 bg-white/[0.02] flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <UserIcon className="h-5 w-5 text-primary" />
              </div>
              <DialogTitle className="text-xl font-bold text-white uppercase tracking-tight m-0">
                {profileStep === 'code' ? 'Perfil Actualizado' : 'Editar Perfil'}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="p-8">
            {profileStep === 'code' ? (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-3 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                  <p className="font-bold text-lg">¡Tus datos han cambiado!</p>
                </div>

                <div className="bg-primary/5 border border-primary/20 p-5 rounded-2xl space-y-3">
                  <p className="text-zinc-400 text-sm">Tu nuevo código de acceso es:</p>
                  <div className="bg-black/40 p-4 rounded-xl border border-white/5 text-center">
                    <span className="text-3xl font-mono font-black text-white tracking-widest">{profileUpdatedCode}</span>
                  </div>
                  <p className="text-zinc-500 text-[10px] uppercase leading-relaxed font-medium">
                    IMPORTANTE: Usa este nuevo código la próxima vez que inicies sesión.
                  </p>
                </div>

                <Button
                  onClick={() => handleProfileClose()}
                  className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black rounded-2xl"
                >
                  ENTENDIDO
                </Button>
              </div>
            ) : (
              <form onSubmit={handleProfileSave} className="space-y-6 text-left">
                  <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-first-name" className="text-zinc-400 font-bold ml-1">Nombre</Label>
                    <Input
                      id="profile-first-name"
                      value={profileFirstName}
                      onChange={(e) => setProfileFirstName(e.target.value)}
                      required
                      className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-last-name" className="text-zinc-400 font-bold ml-1">Apellido</Label>
                    <Input
                      id="profile-last-name"
                      value={profileLastName}
                      onChange={(e) => setProfileLastName(e.target.value)}
                      required
                      className="bg-zinc-900/50 border-white/10 text-white h-12 rounded-xl focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-instrument" className="text-zinc-400 font-bold ml-1">Instrumento por Defecto</Label>
                    <Select
                      value={profileInstrument}
                      onValueChange={setProfileInstrument}
                    >
                      <SelectTrigger id="profile-instrument" className="h-12 border-white/10 bg-zinc-900/50 text-white">
                        <SelectValue placeholder="General / Otro" />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-[#0f0f1a] text-white">
                        <SelectGroup>
                          {[
                            "Piano",
                            "Guitarra Acústica",
                            "Guitarra Eléctrica",
                            "Violín",
                            "Batería",
                            "Batería Eléctrica",
                            "Bajo",
                            "Saxofón",
                            "Voz",
                          ].map((instrument) => (
                            <SelectItem key={instrument} value={instrument}>{instrument}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={profileSaving || !profileFirstName.trim() || !profileLastName.trim()}
                  className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
                >
                  <Save className="h-5 w-5 mr-2" /> {profileSaving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
                </Button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};
