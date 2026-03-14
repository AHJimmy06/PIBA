import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDependencies } from '../context/DependenciesProvider';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/presentation/components/ui/button';
import { Input } from '@/presentation/components/ui/input';
import { Label } from '@/presentation/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/presentation/components/ui/card';
import { Music2 } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { userRepository } = useDependencies();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      // Intentar login ÚNICAMENTE con Access Code
      const user = await userRepository.getByAccessCode(input);

      if (user) {
        login(user);
        navigate('/dashboard');
      } else {
        setError('Código de acceso incorrecto. Verifica e intenta de nuevo.');
      }
    } catch (err) {
      setError('Error de conexión con la base de datos.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1e2e] bg-gradient-to-br from-[#1e1e2e] to-[#12121a] p-4">
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
            <Music2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-white">PIBA</CardTitle>
          <CardDescription className="text-zinc-400">
            Gestión de Alabanza
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2 text-left">
              <Label htmlFor="userId" className="text-zinc-400">
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
                className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus:border-primary h-12 rounded-xl"
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
        <CardFooter className="flex justify-center border-t border-white/5 pt-6 text-center">
          <p className="text-xs text-zinc-500">
            Solicita tu código al líder de alabanza si no lo tienes.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};
