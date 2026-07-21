import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { Music2 } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { user, revocationWarning, login } = useAuth();
  const { userRepository } = useDependencies();
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [navigate, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input = userId.trim();
    if (!input) {
      setError('Por favor ingresa tu código de acceso.');
      return;
    }

    setLoading(true);

    try {
      const user = await userRepository.login(input);

      if (user) {
        login(user);
        navigate('/dashboard');
      } else {
        setError('No se pudo iniciar sesión. Verifica el código e intenta nuevamente.');
      }
    } catch {
      setError('No se pudo iniciar sesión. Verifica el código e intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1e1e2e] to-[#12121a] p-4">
      <Card className="w-full max-w-md border-border bg-accent backdrop-blur-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
            <Music2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground">PIBA</CardTitle>
          <CardDescription className="text-muted-foreground">
            Gestión de Alabanza
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revocationWarning && (
            <div role="alert" className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p className="font-semibold">No pudimos confirmar el cierre de sesión en el servidor.</p>
              <p>La sesión continúa activa. Revisá la conexión e intentá cerrar sesión nuevamente.</p>
              {revocationWarning.requestId && <p className="mt-1 font-mono text-xs">Solicitud: {revocationWarning.requestId}</p>}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2 text-left">
              <Label htmlFor="userId" className="text-muted-foreground">
                Código de Acceso
              </Label>
              <Input
                id="userId"
                type="text"
                placeholder="Ej: 123johdoe"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                disabled={loading}
                className="border-border bg-accent text-foreground placeholder:text-muted-foreground focus:border-primary h-12 rounded-xl"
              />
            </div>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full font-bold h-12 rounded-xl shadow-lg shadow-primary/20"
              disabled={loading}
            >
              {loading ? 'Verificando...' : 'ENTRAR AL PANEL'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border pt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Solicita tu código al líder de alabanza si no lo tienes.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};
