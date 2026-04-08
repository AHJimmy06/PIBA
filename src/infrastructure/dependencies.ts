import { SupabaseUserRepository } from "./repositories/SupabaseUserRepository";
import { SupabaseSongRepository } from "./repositories/SupabaseSongRepository";
import { SupabaseRehearsalRepository } from "./repositories/SupabaseRehearsalRepository";
import { SupabaseRealtimeService } from "./services/SupabaseRealtimeService";
import { BrowserWindowService } from "./services/BrowserWindowService";

// Casos de Uso
import { GetPendingRehearsalsUseCase } from "../core/use-cases/GetPendingRehearsalsUseCase";
import { StartRehearsalUseCase } from "../core/use-cases/StartRehearsalUseCase";
import { UpdateCustomChordsUseCase } from "../core/use-cases/UpdateCustomChordsUseCase";
import { GetSongsUseCase } from "../core/use-cases/GetSongsUseCase";
import { GetUsersUseCase } from "../core/use-cases/GetUsersUseCase";
import { CreateUserUseCase } from "../core/use-cases/CreateUserUseCase";
import { SaveSongUseCase } from "../core/use-cases/SaveSongUseCase";
import { UpdateRehearsalStatusUseCase } from "../core/use-cases/UpdateRehearsalStatusUseCase";
import { DeleteSongUseCase } from "../core/use-cases/DeleteSongUseCase";
import { DeleteRehearsalUseCase } from "../core/use-cases/DeleteRehearsalUseCase";
import { UpdateUserProfileUseCase } from "../core/use-cases/UpdateUserProfileUseCase";
import { GetSongByIdUseCase } from "../core/use-cases/GetSongByIdUseCase";

// 1. Instanciamos la Infraestructura (Singletons)
const userRepository = new SupabaseUserRepository();
const songRepository = new SupabaseSongRepository();
const rehearsalRepository = new SupabaseRehearsalRepository();

const syncService = new SupabaseRealtimeService();
const windowService = new BrowserWindowService();

// 2. Instanciamos los Casos de Uso
export const dependencies = {
  getPendingRehearsals: new GetPendingRehearsalsUseCase(rehearsalRepository),
  startRehearsal: new StartRehearsalUseCase(rehearsalRepository, userRepository),
  updateCustomChords: new UpdateCustomChordsUseCase(rehearsalRepository),
  getSongs: new GetSongsUseCase(songRepository),
  getSongById: new GetSongByIdUseCase(songRepository),
  getUsers: new GetUsersUseCase(userRepository),
  createUser: new CreateUserUseCase(userRepository),
  saveSong: new SaveSongUseCase(songRepository),
  updateRehearsalStatus: new UpdateRehearsalStatusUseCase(rehearsalRepository, userRepository),
  deleteSong: new DeleteSongUseCase(songRepository),
  deleteRehearsal: new DeleteRehearsalUseCase(rehearsalRepository),
  updateUserProfile: new UpdateUserProfileUseCase(userRepository),

  // Servicios
  syncService,
  windowService,
  
  // Repositorios
  rehearsalRepository,
  songRepository,
  userRepository
};

export type Dependencies = typeof dependencies;
